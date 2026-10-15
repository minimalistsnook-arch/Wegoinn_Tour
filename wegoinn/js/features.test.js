import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), posts: [], communities: [], applications: [], notifications: [] }));
vi.mock('./image-upload.js', () => ({ isImageUploadConfigured: () => true, compressImage: vi.fn(async file => file), uploadImage: vi.fn(async () => 'https://x.supabase.co/storage/v1/object/public/post-images/u/cover.webp') }));
vi.mock('./supabase.js', () => ({ supabase: { from: mock.from, rpc: mock.rpc, auth: { getSession: vi.fn(async () => ({ data: { session: { access_token:'test' } } })) } }, errorMessage: err => err.message }));
import { koreaToday, communityIsLocked, formatDateTime, safeMapUrl } from './utils.js';
import { initCommunity } from './community.js';
import { initGuestbook, loadFeed } from './guestbook.js';
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
    chain.range=vi.fn((start,end)=>{
      chain.then=(resolve,reject)=>Promise.resolve({ ...result(), data:result().data.slice(start,end+1) }).then(resolve,reject);
      return chain;
    });
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
 it('shows upcoming communities beyond the displayed month and returns to a selected date',async()=>{
   mock.communities=[
     community({id:'future-one',title:'Future walk',community_date:'2099-01-01'}),
     community({id:'future-two',title:'Future dinner',community_date:'2099-04-01'}),
     community({id:'past-one',title:'Past event',community_date:'2000-01-01'}),
     community({id:'cancelled',title:'Cancelled event',community_date:'2099-05-01',status:'cancelled'}),
   ];
   await initCommunity(me);
   const button=document.querySelector('#viewAllCommunities');
   button.click(); await settle();
   const list=document.querySelector('#communityList');
   expect(button.getAttribute('aria-pressed')).toBe('true');
   expect(document.querySelector('#selectedDateTitle').textContent).toBe('Upcoming communities');
   expect(list.textContent).toContain('Future walk');
   expect(list.textContent).toContain('Future dinner');
   expect(list.textContent).not.toContain('Past event');
   expect(list.textContent).not.toContain('Cancelled event');
   expect(list.textContent).toContain('2099');
   list.querySelector('[data-action=view]').click(); await settle();
   expect(document.querySelector('#communitySheetTitle').textContent).toBe('Future walk');
   document.querySelector('#calendarGrid [data-date]').click(); await settle();
   expect(button.getAttribute('aria-pressed')).toBe('false');
   expect(document.querySelector('#selectedDateTitle').textContent).not.toBe('Upcoming communities');
 });
 it('shows an empty message when there are no future communities',async()=>{
   mock.communities=[community({community_date:'2000-01-01'})];
   await initCommunity(me);
   document.querySelector('#viewAllCommunities').click(); await settle();
   expect(document.querySelector('#communityList').textContent).toContain('No upcoming communities yet.');
 });
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
   form.elements.language.value='en';
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await settle();
   expect(mock.rpc).toHaveBeenCalledWith('update_community',expect.objectContaining({p_community_id:community().id,p_details:expect.objectContaining({title:'New walk',meeting_place:'Lobby'})}));
 });
 it('creates a community without entering a reservation number',async()=>{
   await initCommunity(me);
   document.querySelector('#openCreateCommunity').click();
   const form=document.querySelector('#communityForm');
   expect(document.querySelector('#communityReservationField').hidden).toBe(true);
   expect(form.elements.reservation_number.required).toBe(false);
   for (const [key,value] of Object.entries({title:'Walk',about:'Explore',community_date:'2099-01-01',community_time:'19:00',deadline_date:'2099-01-01',deadline_time:'12:00',language:'ko',max_participants:'8',meeting_place:'Lobby'})) form.elements[key].value=value;
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await settle();
   expect(mock.rpc).toHaveBeenCalledWith('create_community_v2',expect.objectContaining({p_reservation_number:null,p_details:expect.objectContaining({title:'Walk',meeting_place:'Lobby'})}));
 });
 it('sends the minimum participants and rejects a minimum above the maximum',async()=>{
   await initCommunity(me);
   document.querySelector('#openCreateCommunity').click();
   const form=document.querySelector('#communityForm');
   for (const [key,value] of Object.entries({title:'Walk',about:'Explore',community_date:'2099-01-01',community_time:'19:00',deadline_date:'2099-01-01',deadline_time:'12:00',language:'ko',max_participants:'8',min_participants:'9',meeting_place:'Lobby'})) form.elements[key].value=value;
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await settle();
   expect(mock.rpc).not.toHaveBeenCalled();
   form.elements.min_participants.value='3';
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await settle();
   expect(mock.rpc).toHaveBeenCalledWith('create_community_v2',expect.objectContaining({p_details:expect.objectContaining({max_participants:8,min_participants:3})}));
 });
 it('marks communities below the minimum as unconfirmed, then not held once started',async()=>{
   mock.communities=[community({min_participants:3})];
   await initCommunity(me);
   expect(document.querySelector('#myCommunityList').textContent).toContain('Not confirmed');
   mock.communities=[community({min_participants:3,community_date:'2000-01-01'})];
   await initCommunity(me);
   expect(document.querySelector('#myCommunityList').textContent).toContain('Not held');
   document.querySelector('#myCommunityList [data-action=view]').click(); await settle();
   expect(document.querySelector('#communityDetail').textContent).toContain("won't go ahead");
 });
 it('sends the deadline and language, and rejects a deadline after the start',async()=>{
   await initCommunity(me);
   document.querySelector('#openCreateCommunity').click();
   const form=document.querySelector('#communityForm');
   for (const [key,value] of Object.entries({title:'Walk',about:'Explore',community_date:'2099-01-01',community_time:'19:00',deadline_date:'2099-01-01',deadline_time:'20:00',language:'ja',max_participants:'8',min_participants:'1',meeting_place:'Lobby'})) form.elements[key].value=value;
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await settle();
   expect(mock.rpc).not.toHaveBeenCalled();
   form.elements.deadline_time.value='18:00';
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await settle();
   expect(mock.rpc).toHaveBeenCalledWith('create_community_v2',expect.objectContaining({p_details:expect.objectContaining({application_deadline:'2099-01-01T18:00',language:'ja'})}));
 });
 it('shows the language and closes join requests after the deadline',async()=>{
   const other={...me,id:'00000000-0000-0000-0000-000000000002'};
   mock.communities=[community({language:'ko',application_deadline:'2000-01-01T00:00:00'})];
   await initCommunity(other);
   const list=document.querySelector('#communityList');
   expect(list.textContent).toContain('Applications closed');
   expect(list.querySelector('[data-action=join]')).toBeNull();
   expect(list.textContent).toMatch(/Korean|한국어/);
 });
 it('uploads the cover photo after creating and shows it in the list',async()=>{
   URL.createObjectURL=vi.fn(()=>'blob:cover'); URL.revokeObjectURL=vi.fn();
   await initCommunity(me);
   document.querySelector('#openCreateCommunity').click();
   const input=document.querySelector('#communityImageInput');
   Object.defineProperty(input,'files',{value:[new File(['x'],'cover.jpg',{type:'image/jpeg'})],configurable:true});
   input.dispatchEvent(new Event('change')); await settle();
   expect(document.querySelector('#communityImagePreview').hidden).toBe(false);
   const form=document.querySelector('#communityForm');
   for (const [key,value] of Object.entries({title:'Walk',about:'Explore',community_date:'2099-01-01',community_time:'19:00',deadline_date:'2099-01-01',deadline_time:'18:00',language:'ko',max_participants:'8',min_participants:'1',meeting_place:'Lobby'})) form.elements[key].value=value;
   mock.rpc.mockResolvedValueOnce({data:'new-id',error:null});
   const url='https://x.supabase.co/storage/v1/object/public/post-images/u/cover.webp';
   mock.communities=[community({image_url:url})];
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await settle();
   expect(mock.rpc).toHaveBeenCalledWith('set_community_image',{p_community_id:'new-id',p_image_url:url});
   expect(document.querySelector('#communityList .meeting-item__thumb img').getAttribute('src')).toBe(url);
 });
 it('splits the detail into Info, Chat and Members tabs',async()=>{
   const other={...me,id:'00000000-0000-0000-0000-000000000002'};
   mock.communities=[community({min_participants:4,approved_count:1})];
   mock.rpc.mockImplementation(async name=>name==='community_members'
     ? {data:[{nickname:'Host',avatar_url:null,is_host:true,is_me:false},{nickname:'Mina',avatar_url:null,is_host:false,is_me:true}],error:null}
     : {data:null,error:null});
   await initCommunity(other);
   document.querySelector('#communityList [data-action=view]').click(); await settle();
   const detail=document.querySelector('#communityDetail');
   expect(detail.querySelector('#detailPanelInfo').hidden).toBe(false);
   expect(detail.querySelector('#detailPanelMembers').hidden).toBe(true);
   expect(detail.querySelector('.detail-tabs [data-action=chat-locked]')).not.toBeNull();
   detail.querySelector('[data-tab=members]').click(); await settle();
   expect(detail.querySelector('#detailPanelMembers').hidden).toBe(false);
   expect(detail.querySelector('#detailPanelInfo').hidden).toBe(true);
   expect(detail.querySelector('.members-goal').textContent).toContain('3');
   expect([...detail.querySelectorAll('.member__name')].map(n=>n.textContent)).toEqual(['Host','Mina']);
   expect(mock.rpc).toHaveBeenCalledWith('community_members',{p_community_id:community().id});
 });
 it('opens the group chat from the Chat tab for members',async()=>{
   const other={...me,id:'00000000-0000-0000-0000-000000000002'};
   mock.communities=[community()];
   mock.applications=[{community_id:community().id,status:'approved'}];
   await initCommunity(other);
   document.querySelector('#communityList [data-action=view]').click(); await settle();
   expect(document.querySelector('#communityDetail .detail-tabs [data-action=chat]')).not.toBeNull();
 });
 it('joins straight away without waiting for the host',async()=>{
   const other={...me,id:'00000000-0000-0000-0000-000000000002'};
   mock.communities=[community()];
   mock.rpc.mockReturnValueOnce({single:async()=>({data:{status:'approved',approved_count:2,max_participants:8},error:null})});
   await initCommunity(other);
   document.querySelector('#communityList [data-action=join]').click(); await settle();
   expect(mock.rpc).toHaveBeenCalledWith('join_community',{p_community_id:community().id});
   expect(document.querySelector('#communityList').textContent).toMatch(/joined|참여 중/);
   expect(document.querySelector('#communityList [data-action=join]')).toBeNull();
 });
 it('keeps the draft and avoids duplicate creation when the RPC is missing',async()=>{
   await initCommunity(me);
   document.querySelector('#openCreateCommunity').click();
   const form=document.querySelector('#communityForm');
   for (const [key,value] of Object.entries({title:'Walk',about:'Explore',community_date:'2099-01-01',community_time:'19:00',deadline_date:'2099-01-01',deadline_time:'12:00',language:'ko',max_participants:'8',meeting_place:'Lobby'})) form.elements[key].value=value;
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
it('shows a photo beside the text and opens the post with a large photo first',async()=>{
 mock.posts=[{id:'photo-post',content:'A beautiful day',image_url:'https://example.com/day.webp',author_id:me.id,author:{nickname:'Host'},created_at:'2026-10-08T00:00:00Z',comments:[]}];
 await initGuestbook(me);
 const body=document.querySelector('#feed .post__body');
 expect(body.querySelector('.post__text').textContent).toBe('A beautiful day');
 expect(body.lastElementChild.classList.contains('post__thumbnail')).toBe(true);
 expect(body.querySelector('.post__thumbnail img').src).toBe('https://example.com/day.webp');
 expect(document.querySelector('#feed .post__detail-photo')).toBeNull();
 body.querySelector('.post__thumbnail').click(); await settle();
 const detail=document.querySelector('#guestbookDetail');
 expect(document.querySelector('#guestbookSheet').hidden).toBe(false);
 expect(detail.querySelector('article').firstElementChild.classList.contains('post__detail-photo')).toBe(true);
 expect(detail.querySelector('.post__detail-photo img').src).toBe('https://example.com/day.webp');
 expect(detail.querySelector('.post__text').textContent).toBe('A beautiful day');
 detail.querySelector('[data-action=toggle-comments]').click();
 expect(detail.querySelector('.comment-form')).not.toBeNull();
 mock.posts[0].content='Updated post';
 await loadFeed();
 expect(detail.querySelector('.post__text').textContent).toBe('Updated post');
});
it('opens a text-only post without adding an empty photo area',async()=>{
 mock.posts=[{id:'text-post',content:'Hello everyone',author_id:me.id,author:{nickname:'Host'},created_at:'2026-10-08T00:00:00Z',comments:[]}];
 await initGuestbook(me);
 expect(document.querySelector('#feed .post__thumbnail')).toBeNull();
 document.querySelector('#feed [data-action=open-post]').click(); await settle();
 expect(document.querySelector('#guestbookDetail .post__text').textContent).toBe('Hello everyone');
 expect(document.querySelector('#guestbookDetail .post__detail-photo')).toBeNull();
});
it('shows every guestbook post at once and keeps them all on refresh',async()=>{
 mock.posts=Array.from({length:25},(_,i)=>({id:String(i),content:`Post ${i}`,author_id:me.id,author:{nickname:'Host'},created_at:'2026-10-08T00:00:00Z',comments:[]}));
 await initGuestbook(me);
 expect(document.querySelectorAll('[data-post-id]')).toHaveLength(25);
 expect(document.querySelector('#loadMorePosts')).toBeNull();
 expect(document.querySelector('#guestbookComposer').classList.contains('composer--dock')).toBe(true);
 await loadFeed();
 expect(document.querySelectorAll('[data-post-id]')).toHaveLength(25);
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
 const select=document.querySelector('.topbar [data-site-language]');
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


describe('operator moderation',()=>{
 it("can edit another host's historical community and enter its group chat",async()=>{
  const c=community({creator_id:'other-host',community_date:'2000-01-01',application_deadline:'2000-01-01T18:00:00',language:'en'});
  mock.communities=[c];
  await initCommunity({...me,role:'admin'});
  document.querySelector('#myCommunityList [data-action=view]').click();await settle();
  expect(document.querySelector('#communityDetail [data-action=delete-community]')).not.toBeNull();
  expect(document.querySelector('#communityDetail [data-action=chat]')).not.toBeNull();
  document.querySelector('#communityDetail [data-action=edit]').click();
  const form=document.querySelector('#communityForm');
  expect(form.elements.community_date.min).toBe('');
  form.elements.title.value='Corrected history';
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();
  expect(mock.rpc).toHaveBeenCalledWith('update_community',expect.objectContaining({p_community_id:c.id,p_details:expect.objectContaining({title:'Corrected history',community_date:'2000-01-01'})}));
 });
 it('offers post and comment editing to an operator while retaining the author',async()=>{
  mock.posts=[{id:'other-post',author_id:'other',content:'Original',created_at:'2026-01-01T00:00:00Z',author:{nickname:'Guest'},comments:[{id:'comment-id',content:'Hello',author_id:'other',created_at:'2026-01-01T00:00:00Z',author:{nickname:'Guest'}}]}];
  await initGuestbook({...me,role:'admin'});
  document.querySelector('[data-action=toggle-comments]').click();
  expect(document.querySelector('[data-action=edit-comment]')).not.toBeNull();
  document.querySelector('[data-action=edit-post]').click();
  const form=document.querySelector('#moderationForm');
  form.elements.content.value='Corrected';
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();
  expect(mock.rpc).toHaveBeenCalledWith('admin_update_content',expect.objectContaining({p_kind:'post',p_id:'other-post',p_content:'Corrected'}));
  expect(mock.posts[0].author_id).toBe('other');
 });
});
