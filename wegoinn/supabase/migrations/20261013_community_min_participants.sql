-- Run in the Supabase SQL Editor to let hosts set a minimum number of participants.
-- A community whose approved count is below the minimum at its start time does not go ahead.
begin;
alter table public.communities add column if not exists min_participants int not null default 1;
alter table public.communities drop constraint if exists communities_min_participants_check;
alter table public.communities add constraint communities_min_participants_check check (min_participants between 1 and max_participants);

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
begin
 if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
 if v_date is null or v_time is null or (v_date + v_time) <= (clock_timestamp() at time zone 'Asia/Seoul') then
  raise exception 'Choose a future start time (KST)';
 end if;
 if coalesce(btrim(p_details->>'meeting_place'), '') = '' then raise exception 'Meeting place is required'; end if;
 -- Preserve the original reservation-backed creation path and its side effects.
 if coalesce(btrim(p_reservation_number), '') <> '' then
  v_id := public.create_community(p_reservation_number, p_details->>'title', p_details->>'activity',
   p_details->>'preferred_participants', p_details->>'schedule', v_date, v_time,
   (p_details->>'max_participants')::int, coalesce((p_details->>'participation_fee')::int, 0));
  update public.communities set meeting_place = btrim(p_details->>'meeting_place'),
   map_url = btrim(coalesce(p_details->>'map_url', '')),
   min_participants = coalesce((p_details->>'min_participants')::int, 1) where id = v_id;
  return v_id;
 end if;
 insert into public.communities (
  creator_id, title, activity, preferred_participants, schedule,
  community_date, community_time, max_participants, min_participants, participation_fee, meeting_place, map_url
 ) values (
  v_me, btrim(p_details->>'title'), btrim(p_details->>'activity'),
  btrim(p_details->>'preferred_participants'), btrim(p_details->>'schedule'),
  v_date, v_time, (p_details->>'max_participants')::int,
  coalesce((p_details->>'min_participants')::int, 1),
  coalesce((p_details->>'participation_fee')::int, 0),
  btrim(p_details->>'meeting_place'), btrim(coalesce(p_details->>'map_url', ''))
 ) returning id into v_id;
 return v_id;
end $$;

create or replace function public.notify_community_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
 if (new.title,new.activity,new.preferred_participants,new.schedule,new.community_date,new.community_time,new.max_participants,new.min_participants,new.participation_fee,new.meeting_place,new.map_url,new.status)
 is distinct from (old.title,old.activity,old.preferred_participants,old.schedule,old.community_date,old.community_time,old.max_participants,old.min_participants,old.participation_fee,old.meeting_place,old.map_url,old.status) then
 insert into public.notifications(recipient_id,community_id,kind,community_title)
 select applicant_id,new.id,case when new.status = 'cancelled' then 'cancelled' else 'updated' end,new.title
 from public.community_applications where community_id = new.id and status in ('pending','approved');
 end if;
 return new;
end $$;

notify pgrst, 'reload schema';
commit;
