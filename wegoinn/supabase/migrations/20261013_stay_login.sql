begin;
create table if not exists public.hostel_rooms(room_number text primary key, room_type text not null, capacity integer not null check(capacity>0));
insert into public.hostel_rooms values
('609','Single',1),
('701','Single',1),
('709','Single',1),
('712','Single',1),
('809','Single',1),
('812','Single',1),
('815','Single',1),
('606','Double',2),
('607','Double',2),
('702','Double',2),
('703','Double',2),
('704','Double',2),
('706','Double',2),
('707','Double',2),
('708','Double',2),
('713','Double',2),
('715','Double',2),
('716','Double',2),
('808','Double',2),
('813','Double',2),
('816','Double',2),
('710','Handic',2),
('810','Handic',2),
('601','Twin Bunk',2),
('602','Twin Bunk',2),
('603','Twin Bunk',2),
('604','Twin Bunk',2),
('801','Twin Bunk',2),
('802','Twin Bunk',2),
('803','Twin Bunk',2),
('804','Twin Bunk',2),
('610','Twin',2),
('612','Twin',2),
('714','Twin',2),
('705','Triple',3),
('814','Triple',3),
('605','4 Bunk',4),
('805','4 Bunk',4),
('611','Standard Family',4),
('613','Standard Family',4),
('711','Standard Family',4),
('811','Standard Family',4),
('608','Deluxe',4)
on conflict(room_number) do update set room_type=excluded.room_type, capacity=excluded.capacity;
alter table public.profiles drop constraint if exists profiles_nickname_check;
alter table public.profiles add constraint profiles_nickname_check check(char_length(btrim(nickname)) between 1 and 20);
alter table public.profiles add column if not exists check_in date;
alter table public.profiles add column if not exists check_out date;
alter table public.profiles add column if not exists room_number text references public.hostel_rooms;
create unique index if not exists profiles_stay_identity on public.profiles(check_in,check_out,room_number,nickname);
create table if not exists public.guest_sessions(auth_user_id uuid primary key references auth.users on delete cascade, profile_id uuid not null references public.profiles on delete cascade);
alter table public.guest_sessions enable row level security;
alter table public.hostel_rooms enable row level security;
revoke all on public.guest_sessions,public.hostel_rooms from anon,authenticated;
create or replace function public.current_profile_id() returns uuid language sql stable security definer set search_path=public as $$
 select coalesce((select profile_id from public.guest_sessions where auth_user_id=auth.uid()),(select id from public.profiles where auth_user_id=auth.uid()))
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=public.current_profile_id() and role='admin')
$$;
create or replace function public.get_my_profile() returns table(id uuid,nickname text,role text) language sql stable security definer set search_path=public as $$
 select p.id,p.nickname,p.role from public.profiles p where p.id=public.current_profile_id()
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
  select capacity into v_capacity from public.hostel_rooms where room_number=v_room for update;
  if v_capacity is null then raise exception '등록된 객실 번호를 입력하세요.'; end if;
  select p.id into v_id from public.profiles p where p.check_in=v_in and p.check_out=v_out and p.room_number=v_room and p.nickname=v_name;
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
create or replace function public.get_my_stay() returns table(id uuid,nickname text,role text,check_in text,check_out text,room_number text,room_type text,capacity integer,avatar_url text)
language sql stable security definer set search_path=public as $$
 select p.id,p.nickname,p.role,case when p.reservation_number='operator:999222' then '999222' else p.check_in::text end,case when p.reservation_number='operator:999222' then '999222' else p.check_out::text end,p.room_number,r.room_type,r.capacity,p.avatar_url
 from public.profiles p left join public.hostel_rooms r using(room_number) where p.id=public.current_profile_id()
$$;
-- Retire the old registration path so it cannot bypass room capacity.
revoke execute on function public.register_guest(text,text) from public,anon,authenticated;
revoke all on function public.register_stay_guest(text,text,text,text),public.get_my_stay() from public,anon;
grant execute on function public.register_stay_guest(text,text,text,text),public.get_my_stay() to authenticated;
create or replace function public.set_my_avatar(p_avatar_url text) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or public.current_profile_id() is null then raise exception 'Not signed in'; end if;
 if p_avatar_url is not null and position('/storage/v1/object/public/post-images/'||auth.uid()::text||'/' in p_avatar_url)=0 then raise exception 'Invalid profile photo'; end if;
 update public.profiles set avatar_url=nullif(btrim(p_avatar_url),'') where id=public.current_profile_id();
end $$;
notify pgrst,'reload schema';
commit;
