-- Run in the Supabase SQL Editor: guests are signed out once their stay is over.
-- A stay ends when the Korean date passes the check-out date, or when staff mark the guest's
-- row in the Guest Log sheet with "x" in column M (the site then calls end_my_stay()).
-- Ended stays lose all access (current_profile_id() returns null) and cannot log in again.
begin;
alter table public.profiles add column if not exists stay_ended_at timestamptz;

create or replace function public.stay_is_active(p public.profiles) returns boolean
language sql stable set search_path=public as $$
 select p.role='admin' or (p.stay_ended_at is null and (p.check_out is null or p.check_out>=(now() at time zone 'Asia/Seoul')::date))
$$;

-- Every RLS policy and RPC goes through this, so an ended stay can no longer read or write anything.
create or replace function public.current_profile_id() returns uuid language sql stable security definer set search_path=public as $$
 select p.id from public.profiles p
 where p.id=coalesce((select profile_id from public.guest_sessions where auth_user_id=auth.uid()),(select id from public.profiles where auth_user_id=auth.uid()))
   and public.stay_is_active(p)
$$;

create or replace function public.register_stay_guest(p_check_in text,p_check_out text,p_room_number text,p_nickname text)
returns table(id uuid,nickname text,role text) language plpgsql security definer set search_path=public as $$
declare
 v_id uuid; v_in date; v_out date; v_capacity integer; v_peak integer;
 v_name text:=btrim(p_nickname); v_room text:=btrim(p_room_number);
 v_admin boolean:=coalesce(p_check_in='999222' and p_check_out='999222',false);
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 if coalesce(char_length(v_name),0) not between 1 and 20 then raise exception '닉네임은 1~20자로 입력하세요.'; end if;
 if v_admin then
  perform pg_advisory_xact_lock(hashtextextended('stay-admin',0));
  select p.id into v_id from public.profiles p where p.reservation_number='operator:999222' and p.role='admin' and p.nickname=v_name limit 1;
 else
  if coalesce(p_check_in,'') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_check_out,'') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '올바른 날짜를 입력하세요.'; end if;
  v_in:=p_check_in::date; v_out:=p_check_out::date;
  if v_out<=v_in then raise exception '체크아웃은 체크인 이후여야 합니다.'; end if;
  if v_out<(now() at time zone 'Asia/Seoul')::date then raise exception '체크아웃 날짜가 지나 로그인할 수 없습니다.'; end if;
  select capacity into v_capacity from public.hostel_rooms where room_number=v_room for update;
  if v_capacity is null then raise exception '등록된 객실 번호를 입력하세요.'; end if;
  select p.id into v_id from public.profiles p where p.check_in=v_in and p.check_out=v_out and p.room_number=v_room and p.nickname=v_name;
  if v_id is not null and exists(select 1 from public.profiles p where p.id=v_id and p.stay_ended_at is not null) then
   raise exception '체크아웃 처리된 손님은 다시 로그인할 수 없습니다.';
  end if;
  if v_id is null then
   -- Count the peak simultaneous occupancy, not all intersecting bookings.
   select coalesce(max(occupied),0) into v_peak from (
    select (select count(*) from public.profiles p where p.room_number=v_room and p.check_in<=d.stay_day and p.check_out>d.stay_day) occupied
    from (select v_in as stay_day union select check_in from public.profiles where room_number=v_room and check_in>=v_in and check_in<v_out) d
   ) counts;
   if v_peak>=v_capacity then raise exception '해당 숙박 기간의 객실 수용 인원이 마감되었습니다.'; end if;
  end if;
 end if;
 if v_id is null then
  -- Existing anonymous sessions can switch accounts without overwriting a profile.
  if exists(select 1 from public.profiles where auth_user_id=auth.uid()) then raise exception '새 로그인 세션이 필요합니다.'; end if;
  insert into public.profiles(auth_user_id,reservation_number,nickname,role,check_in,check_out,room_number)
  values(auth.uid(),case when v_admin then 'operator:999222' else 'stay:'||v_room end,v_name,case when v_admin then 'admin' else 'guest' end,v_in,v_out,case when v_admin then null else v_room end) returning profiles.id into v_id;
 end if;
 insert into public.guest_sessions values(auth.uid(),v_id) on conflict(auth_user_id) do update set profile_id=excluded.profile_id;
 return query select p.id,p.nickname,p.role from public.profiles p where p.id=v_id;
end $$;

-- Called (with the guest's own token) by /api/stay-status when the Guest Log sheet marks the guest "x".
create or replace function public.end_my_stay() returns void language plpgsql security definer set search_path=public as $$
declare v_id uuid:=public.current_profile_id();
begin
 if v_id is null then return; end if;
 update public.profiles set stay_ended_at=now() where id=v_id and role<>'admin';
end $$;

revoke all on function public.end_my_stay(), public.stay_is_active(public.profiles) from public,anon;
grant execute on function public.end_my_stay() to authenticated;
notify pgrst,'reload schema';
commit;
