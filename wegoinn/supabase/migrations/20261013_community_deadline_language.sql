-- Run in the Supabase SQL Editor to add an application deadline and a community language.
-- Includes the minimum-participants change, so it is safe to run with or without
-- 20261013_community_min_participants.sql having been applied first.
begin;
alter table public.communities add column if not exists min_participants int not null default 1;
alter table public.communities drop constraint if exists communities_min_participants_check;
alter table public.communities add constraint communities_min_participants_check check (min_participants between 1 and max_participants);

-- Korea (KST) wall-clock time, like community_date + community_time. Null = until the start time.
alter table public.communities add column if not exists application_deadline timestamp;
alter table public.communities drop constraint if exists communities_application_deadline_check;
alter table public.communities add constraint communities_application_deadline_check
 check (application_deadline is null or application_deadline <= community_date + community_time);

-- ISO 639-1 code of the language the community is held in. '' = not specified (older communities).
alter table public.communities add column if not exists language text not null default '';
alter table public.communities drop constraint if exists communities_language_check;
alter table public.communities add constraint communities_language_check
 check (language in ('', 'en','ko','ja','zh','es','fr','de','ru','pt','ar','hi','vi','th','id','it'));

create or replace function public.guard_application_lifecycle() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.communities%rowtype;
begin
 select * into c from public.communities where id = new.community_id for update;
 if not found or c.status <> 'active' or (c.community_date + c.community_time) <= (clock_timestamp() at time zone 'Asia/Seoul') then
  raise exception 'This community is read-only';
 end if;
 if tg_op = 'INSERT' and c.application_deadline is not null and c.application_deadline <= (clock_timestamp() at time zone 'Asia/Seoul') then
  raise exception 'Applications are closed';
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
 min_participants = coalesce((p_details->>'min_participants')::int, 1),
 application_deadline = nullif(p_details->>'application_deadline', '')::timestamp,
 language = coalesce(p_details->>'language', c.language),
 meeting_place = btrim(coalesce(p_details->>'meeting_place','')), map_url = btrim(coalesce(p_details->>'map_url',''))
 where id = c.id;
end $$;

create or replace function public.create_community_v2(p_reservation_number text, p_details jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
 v_me uuid := public.current_profile_id();
 v_id uuid;
 v_date date := (p_details->>'community_date')::date;
 v_time time := (p_details->>'community_time')::time;
 v_deadline timestamp := nullif(p_details->>'application_deadline', '')::timestamp;
begin
 if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
 if v_date is null or v_time is null or (v_date + v_time) <= (clock_timestamp() at time zone 'Asia/Seoul') then
  raise exception 'Choose a future start time (KST)';
 end if;
 if v_deadline is not null and v_deadline <= (clock_timestamp() at time zone 'Asia/Seoul') then
  raise exception 'Choose a future application deadline (KST)';
 end if;
 if coalesce(btrim(p_details->>'meeting_place'), '') = '' then raise exception 'Meeting place is required'; end if;
 -- Preserve the original reservation-backed creation path and its side effects.
 if coalesce(btrim(p_reservation_number), '') <> '' then
  v_id := public.create_community(p_reservation_number, p_details->>'title', p_details->>'activity',
   p_details->>'preferred_participants', p_details->>'schedule', v_date, v_time,
   (p_details->>'max_participants')::int, coalesce((p_details->>'participation_fee')::int, 0));
  update public.communities set meeting_place = btrim(p_details->>'meeting_place'),
   map_url = btrim(coalesce(p_details->>'map_url', '')),
   min_participants = coalesce((p_details->>'min_participants')::int, 1),
   application_deadline = v_deadline, language = coalesce(p_details->>'language', '') where id = v_id;
  return v_id;
 end if;
 insert into public.communities (
  creator_id, title, activity, preferred_participants, schedule,
  community_date, community_time, max_participants, min_participants, participation_fee, meeting_place, map_url,
  application_deadline, language
 ) values (
  v_me, btrim(p_details->>'title'), btrim(p_details->>'activity'),
  btrim(p_details->>'preferred_participants'), btrim(p_details->>'schedule'),
  v_date, v_time, (p_details->>'max_participants')::int,
  coalesce((p_details->>'min_participants')::int, 1),
  coalesce((p_details->>'participation_fee')::int, 0),
  btrim(p_details->>'meeting_place'), btrim(coalesce(p_details->>'map_url', '')),
  v_deadline, coalesce(p_details->>'language', '')
 ) returning id into v_id;
 return v_id;
end $$;

create or replace function public.notify_community_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
 if (new.title,new.activity,new.preferred_participants,new.schedule,new.community_date,new.community_time,new.max_participants,new.min_participants,new.participation_fee,new.meeting_place,new.map_url,new.status,new.application_deadline,new.language)
 is distinct from (old.title,old.activity,old.preferred_participants,old.schedule,old.community_date,old.community_time,old.max_participants,old.min_participants,old.participation_fee,old.meeting_place,old.map_url,old.status,old.application_deadline,old.language) then
 insert into public.notifications(recipient_id,community_id,kind,community_title)
 select applicant_id,new.id,case when new.status = 'cancelled' then 'cancelled' else 'updated' end,new.title
 from public.community_applications where community_id = new.id and status in ('pending','approved');
 end if;
 return new;
end $$;

notify pgrst, 'reload schema';
commit;
