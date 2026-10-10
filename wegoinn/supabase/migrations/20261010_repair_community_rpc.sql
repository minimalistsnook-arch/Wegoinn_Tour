-- Run diagnose_community_rpc.sql first. This repair never replaces an existing function.
-- Run this file as one script in the project's Supabase SQL Editor.
begin;
do $repair$
declare
 target oid := to_regprocedure('public.create_community_v2(text,jsonb)');
 arg_names text[];
 result_type oid;
begin
 if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'create_community_v2'
              and (target is null or p.oid <> target)) then
  raise exception 'Unexpected create_community_v2 overload: inspect diagnose_community_rpc.sql before changing anything';
 end if;
 if target is not null then
  select proargnames, prorettype into arg_names, result_type from pg_proc where oid = target;
  if arg_names is distinct from array['p_reservation_number', 'p_details']::text[]
     or result_type <> 'uuid'::regtype then
   raise exception 'Existing create_community_v2 signature differs: inspect it before changing anything';
  end if;
  raise notice 'Existing compatible create_community_v2 preserved; refreshing privileges and cache only';
 else
  if to_regprocedure('public.current_profile_id()') is null
     or to_regprocedure('public.create_community(text,text,text,text,text,date,time without time zone,integer,integer)') is null
     or to_regclass('public.communities') is null
     or to_regclass('public.community_reservations') is null then
   raise exception 'Base community schema is missing; apply the base schema before this repair';
  end if;
  alter table public.communities add column if not exists meeting_place text not null default '' check (char_length(meeting_place) <= 200);
  alter table public.communities add column if not exists map_url text not null default '' check (map_url = '' or map_url ~ '^https://[^[:space:]]+$');
  execute $definition$
create function public.create_community_v2(p_reservation_number text, p_details jsonb)
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
   map_url = btrim(coalesce(p_details->>'map_url', '')) where id = v_id;
  return v_id;
 end if;
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
 return v_id;
end $$;

  $definition$;
 end if;
end $repair$;
revoke all on function public.create_community_v2(text,jsonb) from public, anon;
grant execute on function public.create_community_v2(text,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
