-- Run this in the existing project's Supabase SQL Editor.
-- Standalone creation repair: does not require the lifecycle migration first.
begin;
alter table public.communities add column if not exists meeting_place text not null default '' check (char_length(meeting_place) <= 200);
alter table public.communities add column if not exists map_url text not null default '' check (map_url = '' or map_url ~ '^https://[^[:space:]]+$');

-- Keep the existing RPC signature so existing installations can upgrade in place.
-- Reservation numbers are optional; absent numbers never produce a fake reservation.
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
 insert into public.communities (
  creator_id, title, activity, preferred_participants, schedule,
  community_date, community_time, max_participants, participation_fee, meeting_place, map_url
 ) values (
  v_me, btrim(p_details->>'title'), btrim(p_details->>'activity'),
  btrim(p_details->>'preferred_participants'), btrim(p_details->>'schedule'),
  v_date, v_time, (p_details->>'max_participants')::int,
  coalesce((p_details->>'participation_fee')::int, 0),
  btrim(p_details->>'meeting_place'), btrim(coalesce(p_details->>'map_url', ''))
 ) returning id into v_id;
 if coalesce(btrim(p_reservation_number), '') <> '' then
  insert into public.community_reservations (community_id, reservation_number)
  values (v_id, btrim(p_reservation_number));
 end if;
 return v_id;
end $$;

revoke all on function public.create_community_v2(text,jsonb) from public, anon;
grant execute on function public.create_community_v2(text,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
