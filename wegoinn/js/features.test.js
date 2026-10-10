import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), posts: [], communities: [], applications: [], notifications: [] }));
vi.mock('./supabase.js', () => ({ supabase: { from: mock.from, rpc: mock.rpc, auth: { getSession: vi.fn(async () => ({ data: { session: { access_token:'test' } } })) } }, errorMessage: err => err.message }));
import { koreaToday, communityIsLocked, formatDateTime, safeMapUrl } from './utils.js';
import { initCommunity } from './community.js';
import { initGuestbook } from './guestbook.js';
import { initNotifications } from './notifications.js';
import { initSiteLanguage } from './i18n.js';
const html = readFileSync(`${process.cwd()}/wegoinn/index.html`, 'utf8');
const me = { id: '00000000-0000-0000-0000-000000000001', nickname: 'Host', role:'guest' };
const community = (overrides={}) => ({ id:'00000000-0000-0000-0000-000000000011', creator_id:me.id, title:'Walk', activity:'Explore', preferred_participants:'Everyone', schedule:'Lobby', community_date:'2099-01-01', community_time:'19:00:00', max_participants:8, participation_fee:0, approved_count:1, created_at:'2026-01-01T00:00:00Z', creator:{nickname:'Host'}, status:'active', meeting_place:'Lobby', map_url:'https://maps.google.com/', ...overrides });
const settle = async () => { await new Promise(resolve=>setTimeout(resolve,30)); };
beforeEach(() => {
  document.documentElement.innerHTML = html.replace(/<!DOCTYPE html>/i,'').replace(/<\/?html[^>]*>/g,'');
  localStorage.clear();
  mock.posts=[]; mock.communities=[]; mock.applications=[]; mock.notifications=[];
  mock.rpc.mockReset(); mock.rpc.mockResolvedValue({data:{approved_count:1},error:null});
  mock.from.mockImplementation(table => {
    let limit = Infinity;
    const result=()=>({data:({posts:mock.posts,communities:mock.communities,community_applications:mock.applications,notifications:mock.notifications}[table] || []).slice(0,limit),error:null});
    const chain={};
    for (const op of ['select','gte','lte','order','eq','or','insert','delete']) chain[op]=vi.fn(()=>chain);
    chain.limit=vi.fn(n=>{limit=n;return chain;});
    chain.then=(resolve,reject)=>Promise.resolve(result()).then(resolve,reject);
    return chain;
  });
  vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterEach(()=>vi.restoreAllMocks());
describe('Korean time and map safety',()=>{
 it('uses Korean calendar date across the UTC day boundary',()=>{
   expect(koreaToday(new Date('2026-10-08T16:00:00Z'))).toBe('2026-10-09');
   expect(formatDateTime('2026-10-08T16:00:00Z')).toContain('01:00 KST');
 });
 it('locks exactly at start time and locks cancelled future communities',()=>{
   const c=community({community_date:'2026-10-09',community_time:'01:00:00'});
   expect(communityIsLocked(c,Date.parse('2026-10-08T15:59:59Z'))).toBe(false);
   expect(communityIsLocked(c,Date.parse('2026-10-08T16:00:00Z'))).toBe(true);
   expect(communityIsLocked(community({status:'cancelled'}))).toBe(true);
 });
 it('rejects executable and credential-bearing map URLs',()=>{
   expect(safeMapUrl('javascript:alert(1)')).toBe('');
   expect(safeMapUrl('https://user:secret@example.com')).toBe('');
   expect(safeMapUrl('https://maps.google.com/')).toBe('https://maps.google.com/');
 });
});
describe('community workflows',()=>{
 it('loads registered communities from a schema without lifecycle columns',async()=>{
   const legacy=community();
   delete legacy.status;
   mock.communities=[legacy];
   const original=mock.from.getMockImplementation();
   mock.from.mockImplementation(table=>{
     const chain=original(table);
     if(table==='communities') chain.select.mockImplementation(columns=>{
       if(/\bstatus\b|\bavatar_url\b/.test(columns)) chain.then=(resolve,reject)=>Promise.resolve({data:null,error:{message:'column does not exist'}}).then(resolve,reject);
       return chain;
     });
     return chain;
   });
   await initCommunity(me);
   expect(document.querySelector('#myCommunityList').textContent).toContain('Walk');
   document.querySelector('#myCommunityList [data-action=view]').click(); await settle();
   expect(document.querySelector('#communityDetail').textContent).toContain('Walk');
   expect(document.body.textContent).not.toContain('column communities.status does not exist');
 });
 it('shows historical hosted communities but offers no mutations',async()=>{
   mock.communities=[community({community_date:'2000-01-01'})];
   mock.applications=[{id:'application',status:'pending',applicant:{nickname:'Guest'}}];
   await initCommunity(me);
   document.querySelector('#myCommunityList [data-action=view]').click(); await settle();
   expect(document.querySelector('#communityDetail').textContent).toContain('History is read-only');
   expect(document.querySelector('#communityDetail [data-action=edit]')).toBeNull();
   expect(document.querySelector('#communityDetail [data-review]')).toBeNull();
   expect(document.querySelector('#communityDetail a').href).toBe('https://maps.google.com/');
 });
 it('opens edit form with original fields and sends an atomic update',async()=>{
   mock.communities=[community()]; await initCommunity(me);
   document.querySelector('#myCommunityList [data-action=view]').click(); await settle();
   document.querySelector('#communityDetail [data-action=edit]').click();
   const form=document.querySelector('#communityForm');
   expect(form.elements.title.value).toBe('Walk');
   expect(form.elements.reservation_number.required).toBe(false);
   form.elements.title.value='New walk';
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await settle();
   expect(mock.rpc).toHaveBeenCalledWith('update_community',expect.objectContaining({p_community_id:community().id,p_details:expect.objectContaining({title:'New walk',meeting_place:'Lobby'})}));
 });
 it('creates a community without entering a reservation number',async()=>{
   await initCommunity(me);
   document.querySelector('#openCreateCommunity').click();
   const form=document.querySelector('#communityForm');
   expect(document.querySelector('#communityReservationField').hidden).toBe(true);
   expect(form.elements.reservation_number.required).toBe(false);
   for (const [key,value] of Object.entries({title:'Walk',activity:'Explore',preferred_participants:'Everyone',schedule:'Lobby',community_date:'2099-01-01',community_time:'19:00',max_participants:'8',meeting_place:'Lobby'})) form.elements[key].value=value;
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await settle();
   expect(mock.rpc).toHaveBeenCalledWith('create_community_v2',expect.objectContaining({p_reservation_number:null,p_details:expect.objectContaining({title:'Walk',meeting_place:'Lobby'})}));
 });
 it('keeps the draft and avoids duplicate creation when the RPC is missing',async()=>{
   await initCommunity(me);
   document.querySelector('#openCreateCommunity').click();
   const form=document.querySelector('#communityForm');
   for (const [key,value] of Object.entries({title:'Walk',activity:'Explore',preferred_participants:'Everyone',schedule:'Lobby',community_date:'2099-01-01',community_time:'19:00',max_participants:'8',meeting_place:'Lobby'})) form.elements[key].value=value;
   mock.rpc.mockResolvedValueOnce({data:null,error:{code:'PGRST202',message:'Could not find the function public.create_community_v2 in the schema cache'}});
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await settle();
   expect(mock.rpc).toHaveBeenCalledTimes(1);
   expect(form.elements.title.value).toBe('Walk');
   expect(form.querySelector('[type=submit]').disabled).toBe(false);
   expect(document.body.textContent).toContain('Community creation is temporarily unavailable');
 });
 it('lets a participant withdraw an approved application',async()=>{
   mock.communities=[community({creator_id:'00000000-0000-0000-0000-000000000002'})];
   mock.applications=[{community_id:community().id,status:'approved'}];
   await initCommunity(me); document.querySelector('#myCommunityList [data-action=view]').click(); await settle();
   document.querySelector('[data-action=withdraw]').click(); await settle();
   expect(mock.rpc).toHaveBeenCalledWith('withdraw_application',{p_community_id:community().id});
 });
});
it('loads older guestbook posts and retains the expanded range on refresh',async()=>{
 mock.posts=Array.from({length:25},(_,i)=>({id:String(i),content:`Post ${i}`,author_id:me.id,author:{nickname:'Host'},created_at:'2026-10-08T00:00:00Z',comments:[]}));
 await initGuestbook(me);
 expect(document.querySelectorAll('[data-post-id]')).toHaveLength(20);
 expect(document.querySelector('#loadMorePosts').hidden).toBe(false);
 document.querySelector('#loadMorePosts').click(); await settle();
 expect(document.querySelectorAll('[data-post-id]')).toHaveLength(25);
 expect(document.querySelector('#loadMorePosts').hidden).toBe(true);
});
it('shows unread notifications and marks only displayed unread IDs',async()=>{
 mock.notifications=[{id:'notice',kind:'approved',community_title:'Walk',created_at:'2026-10-08T00:00:00Z',read_at:null}];
 await initNotifications();
 expect(document.querySelector('#notificationCount').textContent).toBe('1');
 document.querySelector('#markNotificationsRead').click(); await settle();
 expect(mock.rpc).toHaveBeenCalledWith('mark_notifications_read',{p_ids:['notice']});
});
it('switches interface language in both directions without translating nicknames',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({configured:false})})));
 document.querySelector('#headerNickname').textContent='Language';
 initSiteLanguage(); await settle();
 const select=document.querySelector('#siteLanguage');
 select.value='ko';select.dispatchEvent(new Event('change'));
 expect(document.querySelector('#logoutBtn').textContent).toBe('로그아웃');
 expect(document.querySelector('#headerNickname').textContent).toBe('Language');
 select.value='ja';select.dispatchEvent(new Event('change'));
 expect(document.querySelector('#logoutBtn').textContent).toBe('ログアウト');
 select.value='zh';select.dispatchEvent(new Event('change'));
 expect(document.querySelector('#logoutBtn').textContent).toBe('退出登录');
 select.value='en';select.dispatchEvent(new Event('change'));
 expect(document.querySelector('#logoutBtn').textContent).toBe('Log out');
 vi.unstubAllGlobals();
});
