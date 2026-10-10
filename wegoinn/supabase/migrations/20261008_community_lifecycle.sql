-- Apply to the existing Supabase project before using the updated frontend.
begin;
alter table public.communities add column if not exists status text not null default 'active' check (status in ('active','cancelled'));
alter table public.communities add column if not exists meeting_place text not null default '' check (char_length(meeting_place) <= 200);
alter table public.communities add column if not exists map_url text not null default '' check (map_url = '' or map_url ~ '^https://[^[:space:]]+$');
alter table public.communities add column if not exists updated_at timestamptz not null default now();
alter table public.community_applications drop constraint if exists community_applications_status_check;
alter table public.community_applications add constraint community_applications_status_check check (status in ('pending','approved','declined','withdrawn'));

create table if not exists public.notifications (
 id uuid primary key default gen_random_uuid(),
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 community_id uuid not null references public.communities(id) on delete cascade,
 kind text not null check (kind in ('application','approved','declined','withdrawn','updated','cancelled')),
 community_title text not null,
 created_at timestamptz not null default now(),
 read_at timestamptz
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (recipient_id = public.current_profile_id());

-- These guards also protect the original create/review RPCs and direct inserts.
create or replace function public.guard_community_lifecycle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
 if tg_op = 'DELETE' then raise exception 'Community history cannot be deleted'; end if;
 if tg_op = 'UPDATE' then
  if old.status = 'cancelled' or (old.community_date + old.community_time) <= (clock_timestamp() at time zone 'Asia/Seoul') then
   raise exception 'This community is read-only';
  end if;
 end if;
 if (new.community_date + new.community_time) <= (clock_timestamp() at time zone 'Asia/Seoul') then
  raise exception 'Choose a future start time (KST)';
 end if;
 new.updated_at := now();
 return new;
end $$;
drop trigger if exists guard_community_lifecycle on public.communities;
create trigger guard_community_lifecycle before insert or update or delete on public.communities for each row execute function public.guard_community_lifecycle();

create or replace function public.guard_application_lifecycle() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.communities%rowtype;
begin
 select * into c from public.communities where id = new.community_id for update;
 if not found or c.status <> 'active' or (c.community_date + c.community_time) <= (clock_timestamp() at time zone 'Asia/Seoul') then
  raise exception 'This community is read-only';
 end if;
 if tg_op = 'INSERT' and c.approved_count >= c.max_participants then raise exception 'FULL'; end if;
 return new;
end $$;
drop trigger if exists guard_application_lifecycle on public.community_applications;
create trigger guard_application_lifecycle before insert or update on public.community_applications for each row execute function public.guard_application_lifecycle();

create or replace function public.update_community(p_community_id uuid, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare c public.communities%rowtype;
begin
 select * into c from public.communities where id = p_community_id for update;
 if not found or c.creator_id is distinct from public.current_profile_id() then raise exception 'Only the host can edit this community' using errcode = '42501'; end if;
 update public.communities set
 title = btrim(p_details->>'title'), activity = btrim(p_details->>'activity'),
 preferred_participants = btrim(p_details->>'preferred_participants'), schedule = btrim(p_details->>'schedule'),
 community_date = (p_details->>'community_date')::date, community_time = (p_details->>'community_time')::time,
 max_participants = (p_details->>'max_participants')::int, participation_fee = (p_details->>'participation_fee')::int,
 meeting_place = btrim(coalesce(p_details->>'meeting_place','')), map_url = btrim(coalesce(p_details->>'map_url',''))
 where id = c.id;
end $$;

create or replace function public.create_community_v2(p_reservation_number text, p_details jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
 v_id := public.create_community(p_reservation_number, p_details->>'title', p_details->>'activity',
 p_details->>'preferred_participants', p_details->>'schedule', (p_details->>'community_date')::date,
 (p_details->>'community_time')::time, (p_details->>'max_participants')::int, (p_details->>'participation_fee')::int);
 perform public.update_community(v_id, p_details);
 return v_id;
end $$;

create or replace function public.cancel_community(p_community_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.communities%rowtype;
begin
 select * into c from public.communities where id = p_community_id for update;
 if not found or c.creator_id is distinct from public.current_profile_id() then raise exception 'Only the host can cancel this community' using errcode = '42501'; end if;
 update public.communities set status = 'cancelled' where id = c.id;
end $$;

create or replace function public.withdraw_application(p_community_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.communities%rowtype; a public.community_applications%rowtype;
begin
 -- All multi-row mutations lock community first, then application.
 select * into c from public.communities where id = p_community_id for update;
 if not found or c.status <> 'active' or (c.community_date + c.community_time) <= (clock_timestamp() at time zone 'Asia/Seoul') then raise exception 'This community is read-only'; end if;
 select * into a from public.community_applications where community_id = c.id and applicant_id = public.current_profile_id() for update;
 if not found or a.status not in ('pending','approved') then raise exception 'No active application to withdraw'; end if;
 if a.status = 'approved' then update public.communities set approved_count = approved_count - 1 where id = c.id; end if;
 update public.community_applications set status = 'withdrawn', reviewed_at = now() where id = a.id;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
 update public.notifications set read_at = now() where id = any(p_ids) and recipient_id = public.current_profile_id() and read_at is null;
$$;

create or replace function public.notify_community_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
 if (new.title,new.activity,new.preferred_participants,new.schedule,new.community_date,new.community_time,new.max_participants,new.participation_fee,new.meeting_place,new.map_url,new.status)
 is distinct from (old.title,old.activity,old.preferred_participants,old.schedule,old.community_date,old.community_time,old.max_participants,old.participation_fee,old.meeting_place,old.map_url,old.status) then
 insert into public.notifications(recipient_id,community_id,kind,community_title)
 select applicant_id,new.id,case when new.status = 'cancelled' then 'cancelled' else 'updated' end,new.title
 from public.community_applications where community_id = new.id and status in ('pending','approved');
 end if;
 return new;
end $$;
drop trigger if exists notify_community_changes on public.communities;
create trigger notify_community_changes after update on public.communities for each row execute function public.notify_community_changes();

create or replace function public.notify_application_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.communities%rowtype; recipient uuid; event_kind text;
begin
 select * into c from public.communities where id = new.community_id;
 if tg_op = 'INSERT' then recipient := c.creator_id; event_kind := 'application';
 elsif new.status is distinct from old.status then
  if new.status = 'withdrawn' then recipient := c.creator_id; else recipient := new.applicant_id; end if;
  event_kind := new.status;
 else return new;
 end if;
 insert into public.notifications(recipient_id,community_id,kind,community_title) values(recipient,c.id,event_kind,c.title);
 return new;
end $$;
drop trigger if exists notify_application_changes on public.community_applications;
create trigger notify_application_changes after insert or update on public.community_applications for each row execute function public.notify_application_changes();

revoke all on function public.update_community(uuid,jsonb), public.create_community_v2(text,jsonb), public.cancel_community(uuid), public.withdraw_application(uuid), public.mark_notifications_read(uuid[]), public.guard_community_lifecycle(), public.guard_application_lifecycle(), public.notify_community_changes(), public.notify_application_changes() from public, anon;
grant execute on function public.update_community(uuid,jsonb), public.create_community_v2(text,jsonb), public.cancel_community(uuid), public.withdraw_application(uuid), public.mark_notifications_read(uuid[]) to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
 alter publication supabase_realtime add table public.notifications;
 end if;
end $$;
commit;
