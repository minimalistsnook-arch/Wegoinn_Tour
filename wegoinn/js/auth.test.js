import { describe, expect, it, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ getSession:vi.fn(), signOut:vi.fn(), signInAnonymously:vi.fn(), rpc:vi.fn(), from:vi.fn() }));
vi.mock('./supabase.js', () => ({ supabase: {auth:mocks,rpc:mocks.rpc,from:mocks.from} }));
vi.mock('./image-upload.js', () => ({ uploadImage:vi.fn() }));
import { normalizeStayDate, signInGuest, validateNickname } from './auth.js';
beforeEach(() => {
 vi.clearAllMocks();
 mocks.getSession.mockResolvedValue({data:{session:null}});
 mocks.signInAnonymously.mockResolvedValue({error:null});
 mocks.rpc.mockReturnValue({single:async()=>({data:{id:'existing-profile',nickname:'손님',role:'guest'},error:null})});
 mocks.from.mockReturnValue({select:()=>({eq:()=>({maybeSingle:async()=>({data:{avatar_url:null}})})})});
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:200})));
});
describe('stay login',()=>{
 it('normalizes dates and rejects impossible dates',()=>{
  expect(normalizeStayDate('26.10.13')).toBe('2026-10-13');
  expect(normalizeStayDate('2026/2/3')).toBe('2026-02-03');
  expect(()=>normalizeStayDate('2026-02-30')).toThrow();
  expect(normalizeStayDate('999222')).toBe('999222');
 });
 it('supports Korean nicknames',()=>expect(validateNickname('손님')).toBe(true));
 it('uses the returned existing profile and logs without trusting browser stay fields',async()=>{
  const profile=await signInGuest('26.10.13','26.10.25','701','손님');
  expect(profile.id).toBe('existing-profile');
  expect(mocks.rpc).toHaveBeenCalledWith('register_stay_guest',{p_check_in:'2026-10-13',p_check_out:'2026-10-25',p_room_number:'701',p_nickname:'손님'});
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({avatarUrl:''});
 });
 it('preserves the database error code and identifies the failing step',async()=>{
  mocks.rpc.mockReturnValue({single:async()=>({data:null,error:{code:'PGRST202',message:'Could not find the function public.register_stay_guest in the schema cache'}})});
  await expect(signInGuest('26.10.13','26.10.25','701','손님')).rejects.toMatchObject({code:'PGRST202',loginStage:'profile'});
 });
 it('allows operator dates with no room',async()=>{
  await signInGuest('999222','999222','','운영자');
  expect(mocks.rpc).toHaveBeenCalledWith('register_stay_guest',expect.objectContaining({p_check_in:'999222',p_check_out:'999222',p_room_number:''}));
 });
 it('rejects reversed dates and a single operator date before making auth calls',async()=>{
  await expect(signInGuest('26.10.25','26.10.13','701','손님')).rejects.toThrow();
  await expect(signInGuest('999222','26.10.25','701','손님')).rejects.toThrow();
  expect(mocks.signInAnonymously).not.toHaveBeenCalled();
 });
});
