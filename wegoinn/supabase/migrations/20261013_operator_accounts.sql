-- Operator account management and per-device recent activity. Run after operator moderation.
begin;
create table if not exists public.guest_activity (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 last_seen_at timestamptz not null default now(), signed_out_at timestamptz
);
alter table public.guest_activity enable row level security;
revoke all on public.guest_activity from anon, authenticated;
create or replace function public.touch_guest_session(p_sign_out boolean default false) returns void
language plpgsql security definer set search_path=public as $$
declare v_id uuid:=public.current_profile_id();
begin
 if v_id is null then raise exception 'Not signed in'; end if;
 insert into public.guest_activity(auth_user_id,profile_id,last_seen_at,signed_out_at)
 values(auth.uid(),v_id,now(),case when p_sign_out then now() else null end)
 on conflict(auth_user_id) do update set profile_id=excluded.profile_id,last_seen_at=excluded.last_seen_at,signed_out_at=excluded.signed_out_at;
end $$;
create or replace function public.admin_account_roster()
returns table(id uuid,nickname text,role text,check_in text,check_out text,room_number text,last_seen_at timestamptz,is_online boolean,stay_active boolean)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Admin only'; end if;
 return query select p.id,p.nickname,p.role,
 case when p.reservation_number='operator:999222' then '999222' else p.check_in::text end,
 case when p.reservation_number='operator:999222' then '999222' else p.check_out::text end,p.room_number,
 a.seen,coalesce(a.online,false) and public.stay_is_active(p),public.stay_is_active(p)
 from public.profiles p left join lateral (
 select max(g.last_seen_at) seen,bool_or(g.signed_out_at is null and g.last_seen_at>now()-interval '90 seconds') online
 from public.guest_activity g where g.profile_id=p.id
 ) a on true order by coalesce(a.online,false) desc,a.seen desc nulls last,p.created_at desc;
end $$;
create or replace function public.admin_delete_account(p_profile_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Admin only'; end if;
 if p_profile_id=public.current_profile_id() then raise exception '현재 로그인한 운영자 계정은 삭제할 수 없습니다.'; end if;
 delete from public.profiles where profiles.id=p_profile_id;
 if not found then raise exception '계정이 이미 삭제되었거나 존재하지 않습니다.'; end if;
end $$;
revoke all on function public.touch_guest_session(boolean),public.admin_account_roster(),public.admin_delete_account(uuid) from public,anon;
grant execute on function public.touch_guest_session(boolean),public.admin_account_roster(),public.admin_delete_account(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
