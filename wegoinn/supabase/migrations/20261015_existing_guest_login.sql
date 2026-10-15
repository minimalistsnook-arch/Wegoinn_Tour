-- Returning guests must match an existing stay; never create a profile on this path.
begin;
create or replace function public.login_stay_guest(p_check_in text,p_check_out text,p_room_number text,p_nickname text)
returns table(id uuid,nickname text,role text)
language plpgsql security definer set search_path=public as $$
declare
 v_profile public.profiles;
 v_in date;
 v_out date;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 if coalesce(p_check_in,'') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_check_out,'') !~ '^\d{4}-\d{2}-\d{2}$' then
  raise exception '체크인·체크아웃 날짜와 ID, 객실 번호를 확인해 주세요.';
 end if;
 v_in:=p_check_in::date; v_out:=p_check_out::date;
 select p.* into v_profile from public.profiles p
 where p.role='guest' and p.check_in=v_in and p.check_out=v_out
 and p.nickname=btrim(p_nickname) and p.room_number=btrim(p_room_number);
 if not found then
  raise exception '체크인·체크아웃 날짜와 ID, 객실 번호가 기존 계정과 일치하지 않습니다. 처음 가입하는 경우 사진을 추가해 주세요.';
 end if;
 if not public.stay_is_active(v_profile) then
  raise exception '체크아웃 처리되었거나 숙박 기간이 종료되어 로그인할 수 없습니다.';
 end if;
 insert into public.guest_sessions(auth_user_id,profile_id) values(auth.uid(),v_profile.id)
 on conflict(auth_user_id) do update set profile_id=excluded.profile_id;
 return query select v_profile.id,v_profile.nickname,v_profile.role;
end $$;
revoke all on function public.login_stay_guest(text,text,text,text) from public,anon;
grant execute on function public.login_stay_guest(text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
