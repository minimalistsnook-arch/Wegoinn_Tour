-- =====================================================================
-- WEGOINN Guestbook & Community — Supabase schema + RLS
-- Run once in Supabase Dashboard → SQL Editor.
--
-- Security model
--   * Every guest is a Supabase *anonymous* auth user (role "authenticated").
--   * profiles.role ('guest' | 'admin') is the only source of admin rights.
--     Clients can never write `role`; it is changed only from the SQL Editor.
--   * Reservation numbers are never selectable by guests:
--       - profiles.reservation_number  → column-level SELECT is not granted
--       - community reservation number → separate table with no grants
--     Admins read them only through SECURITY DEFINER RPCs that check is_admin().
--   * Writes that need multi-row consistency (create community, approve /
--     decline) go through RPCs that lock rows, so the 30-person cap can't be
--     exceeded by concurrent approvals.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id                 uuid primary key default gen_random_uuid(),
  auth_user_id       uuid not null unique references auth.users (id) on delete cascade,
  reservation_number text not null check (char_length(btrim(reservation_number)) between 1 and 64),
  nickname           text not null check (nickname ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,19}$'),
  role               text not null default 'guest' check (role in ('guest', 'admin')),
  created_at         timestamptz not null default now()
);

-- Helper functions are SECURITY DEFINER so policies can call them without
-- recursing into profiles' own RLS.
create or replace function public.current_profile_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select p.id from public.profiles p where p.auth_user_id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.auth_user_id = auth.uid() and p.role = 'admin'
  )
$$;

create table if not exists public.posts (
  id                uuid primary key default gen_random_uuid(),
  author_id         uuid not null default public.current_profile_id()
                    references public.profiles (id) on delete cascade,
  content           text not null default '' check (char_length(content) <= 1000),
  original_language text check (original_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  image_url         text check (image_url ~ '^https://'),
  created_at        timestamptz not null default now(),
  constraint posts_has_body check (char_length(btrim(content)) > 0 or image_url is not null)
);
create index if not exists posts_created_at_idx on public.posts (created_at desc);

create table if not exists public.comments (
  id                uuid primary key default gen_random_uuid(),
  post_id           uuid not null references public.posts (id) on delete cascade,
  author_id         uuid not null default public.current_profile_id()
                    references public.profiles (id) on delete cascade,
  parent_comment_id uuid references public.comments (id) on delete cascade,
  content           text not null check (char_length(btrim(content)) between 1 and 500),
  original_language text check (original_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  created_at        timestamptz not null default now()
);
create index if not exists comments_post_idx   on public.comments (post_id, created_at);
create index if not exists comments_parent_idx on public.comments (parent_comment_id);

create table if not exists public.communities (
  id                     uuid primary key default gen_random_uuid(),
  creator_id             uuid not null references public.profiles (id) on delete cascade,
  title                  text not null check (char_length(btrim(title)) between 1 and 60),
  activity               text not null check (char_length(btrim(activity)) between 1 and 500),
  preferred_participants text not null check (char_length(btrim(preferred_participants)) between 1 and 500),
  schedule               text not null check (char_length(btrim(schedule)) between 1 and 1000),
  community_date         date not null,
  community_time         time not null,
  max_participants       int  not null check (max_participants between 1 and 30),
  participation_fee      int  not null default 0 check (participation_fee between 0 and 10000000), -- KRW, 0 = FREE
  -- Denormalised count of APPROVED applications. Maintained only by
  -- review_application(); the CHECK is the last line of defence against overfill.
  approved_count         int  not null default 0,
  created_at             timestamptz not null default now(),
  constraint communities_not_overfilled check (approved_count between 0 and max_participants)
);
create index if not exists communities_date_idx on public.communities (community_date, community_time);

-- Reservation number of the community creator. Kept out of `communities`
-- so that Realtime payloads and REST selects of communities can never carry it.
create table if not exists public.community_reservations (
  community_id       uuid primary key references public.communities (id) on delete cascade,
  reservation_number text not null check (char_length(btrim(reservation_number)) between 1 and 64),
  created_at         timestamptz not null default now()
);

create table if not exists public.community_applications (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  applicant_id uuid not null default public.current_profile_id()
               references public.profiles (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  unique (community_id, applicant_id)
);
create index if not exists applications_community_idx on public.community_applications (community_id, status);
create index if not exists applications_applicant_idx on public.community_applications (applicant_id);

-- ---------------------------------------------------------------------
-- 2. INTEGRITY TRIGGERS
-- ---------------------------------------------------------------------

-- Comments: POST → COMMENT → REPLY only. A reply's parent must be a
-- top-level comment on the same post.
create or replace function public.comments_enforce_depth()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_parent public.comments%rowtype;
begin
  if new.parent_comment_id is null then
    return new;
  end if;
  select * into v_parent from public.comments where id = new.parent_comment_id;
  if not found then
    raise exception 'Parent comment not found';
  end if;
  if v_parent.post_id <> new.post_id then
    raise exception 'Reply must belong to the same post';
  end if;
  if v_parent.parent_comment_id is not null then
    raise exception 'Replies can only be one level deep';
  end if;
  return new;
end;
$$;

drop trigger if exists comments_enforce_depth on public.comments;
create trigger comments_enforce_depth
  before insert on public.comments
  for each row execute function public.comments_enforce_depth();

-- ---------------------------------------------------------------------
-- 3. PRIVILEGES  (what each role may touch at all — RLS then filters rows)
-- ---------------------------------------------------------------------

revoke all on public.profiles, public.posts, public.comments, public.communities,
              public.community_reservations, public.community_applications
  from anon, authenticated;

-- profiles: other guests may only ever see id + nickname. No direct writes.
grant select (id, nickname, created_at) on public.profiles to authenticated;

-- posts / comments: author_id is filled by its column default, so clients
-- cannot even send it.
grant select, delete on public.posts to authenticated;
grant insert (content, original_language, image_url) on public.posts to authenticated;

grant select, delete on public.comments to authenticated;
grant insert (post_id, parent_comment_id, content, original_language) on public.comments to authenticated;

-- communities: read-only via REST; created through create_community().
grant select on public.communities to authenticated;

-- community_reservations: no grants at all (admin RPC only).

-- applications: a guest may only insert the community_id; applicant_id and
-- status come from defaults. Status changes only through review_application().
grant select on public.community_applications to authenticated;
grant insert (community_id) on public.community_applications to authenticated;

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.profiles               enable row level security;
alter table public.posts                  enable row level security;
alter table public.comments               enable row level security;
alter table public.communities            enable row level security;
alter table public.community_reservations enable row level security;
alter table public.community_applications enable row level security;

-- profiles ------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using ((select public.current_profile_id()) is not null);

-- posts ---------------------------------------------------------------
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts
  for select to authenticated
  using ((select public.current_profile_id()) is not null);

drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts
  for insert to authenticated
  with check (author_id = (select public.current_profile_id()));

drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts
  for delete to authenticated
  using (author_id = (select public.current_profile_id()) or (select public.is_admin()));

-- comments ------------------------------------------------------------
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
  for select to authenticated
  using ((select public.current_profile_id()) is not null);

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
  for insert to authenticated
  with check (author_id = (select public.current_profile_id()));

drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments
  for delete to authenticated
  using (author_id = (select public.current_profile_id()) or (select public.is_admin()));

-- communities ---------------------------------------------------------
drop policy if exists communities_select on public.communities;
create policy communities_select on public.communities
  for select to authenticated
  using ((select public.current_profile_id()) is not null);

-- community_reservations: RLS on, no policies → nobody via REST.

-- community_applications ---------------------------------------------
-- Visible to: the applicant, the community's creator, admins.
drop policy if exists applications_select on public.community_applications;
create policy applications_select on public.community_applications
  for select to authenticated
  using (
    applicant_id = (select public.current_profile_id())
    or exists (
      select 1 from public.communities c
      where c.id = community_id and c.creator_id = (select public.current_profile_id())
    )
    or (select public.is_admin())
  );

drop policy if exists applications_insert on public.community_applications;
create policy applications_insert on public.community_applications
  for insert to authenticated
  with check (
    applicant_id = (select public.current_profile_id())
    and status = 'pending'
    and reviewed_at is null
    and exists (
      select 1 from public.communities c
      where c.id = community_id
        and c.creator_id <> (select public.current_profile_id())   -- can't join your own
        and c.approved_count < c.max_participants                  -- not FULL
    )
  );

-- ---------------------------------------------------------------------
-- 5. RPC FUNCTIONS
-- ---------------------------------------------------------------------

-- Called right after signInAnonymously(). Creates/updates the caller's own
-- guest profile. Never sets or changes `role`, and never touches admins.
create or replace function public.register_guest(p_reservation_number text, p_nickname text)
returns table (id uuid, nickname text, role text)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reservation_number), '') = '' or coalesce(btrim(p_nickname), '') = '' then
    raise exception 'Reservation number and nickname are required';
  end if;

  -- TODO: Connect reservation verification API
  -- The real check must run server-side (e.g. an Edge Function that calls the
  -- booking system and marks the reservation as verified) — never trust the browser.

  insert into public.profiles as p (auth_user_id, reservation_number, nickname, role)
  values (auth.uid(), btrim(p_reservation_number), btrim(p_nickname), 'guest')
  on conflict (auth_user_id) do update
    set reservation_number = excluded.reservation_number,
        nickname           = excluded.nickname
    where p.role = 'guest';

  return query
    select p.id, p.nickname, p.role from public.profiles p where p.auth_user_id = auth.uid();
end;
$$;

-- The caller's own profile (role included). Never returns reservation_number.
create or replace function public.get_my_profile()
returns table (id uuid, nickname text, role text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.nickname, p.role from public.profiles p where p.auth_user_id = auth.uid()
$$;

-- Creates a community and stores the creator's reservation number in the
-- private table, atomically.
create or replace function public.create_community(
  p_reservation_number     text,
  p_title                  text,
  p_activity               text,
  p_preferred_participants text,
  p_schedule               text,
  p_community_date         date,
  p_community_time         time,
  p_max_participants       int,
  p_participation_fee      int
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := public.current_profile_id();
  v_id uuid;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reservation_number), '') = '' then
    raise exception 'Reservation number is required';
  end if;
  if p_max_participants is null or p_max_participants not between 1 and 30 then
    raise exception 'Maximum participants must be between 1 and 30';
  end if;
  if p_community_date < (now() at time zone 'Asia/Seoul')::date then
    raise exception 'Date cannot be in the past';
  end if;

  insert into public.communities (
    creator_id, title, activity, preferred_participants, schedule,
    community_date, community_time, max_participants, participation_fee
  ) values (
    v_me, btrim(p_title), btrim(p_activity), btrim(p_preferred_participants), btrim(p_schedule),
    p_community_date, p_community_time, p_max_participants, coalesce(p_participation_fee, 0)
  )
  returning communities.id into v_id;

  insert into public.community_reservations (community_id, reservation_number)
  values (v_id, btrim(p_reservation_number));

  return v_id;
end;
$$;

-- APPROVE / DECLINE. Only the community creator. Locks the community row so
-- concurrent approvals are serialised and can never exceed max_participants.
create or replace function public.review_application(p_application_id uuid, p_decision text)
returns table (status text, approved_count int, max_participants int)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_me           uuid := public.current_profile_id();
  v_community_id uuid;
  v_comm         public.communities%rowtype;
  v_app          public.community_applications%rowtype;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'declined') then
    raise exception 'Invalid decision';
  end if;

  select a.community_id into v_community_id
    from public.community_applications a where a.id = p_application_id;
  if not found then
    raise exception 'Application not found';
  end if;

  -- Lock order: community first, then application.
  select * into v_comm from public.communities c where c.id = v_community_id for update;
  if v_comm.creator_id <> v_me then
    raise exception 'Only the community creator can review applications' using errcode = '42501';
  end if;

  select * into v_app from public.community_applications a where a.id = p_application_id for update;
  if v_app.status <> 'pending' then
    raise exception 'This application has already been reviewed';
  end if;

  if p_decision = 'approved' then
    if v_comm.approved_count >= v_comm.max_participants then
      raise exception 'FULL: this community has reached its maximum participants';
    end if;
    update public.communities c set approved_count = c.approved_count + 1 where c.id = v_comm.id;
  end if;

  update public.community_applications a
     set status = p_decision, reviewed_at = now()
   where a.id = p_application_id;

  return query
    select p_decision, c.approved_count, c.max_participants
      from public.communities c where c.id = v_comm.id;
end;
$$;

-- ---- Admin-only RPCs (reservation numbers live here) ---------------

create or replace function public.admin_list_guests()
returns table (id uuid, nickname text, role text, reservation_number text, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  return query
    select p.id, p.nickname, p.role, p.reservation_number, p.created_at
      from public.profiles p
     order by p.created_at desc;
end;
$$;

create or replace function public.admin_list_communities()
returns table (
  id uuid, title text, activity text, preferred_participants text, schedule text,
  community_date date, community_time time, max_participants int, participation_fee int,
  approved_count int, pending_count int, created_at timestamptz,
  creator_id uuid, creator_nickname text, creator_profile_reservation_number text,
  reservation_number text
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  return query
    select c.id, c.title, c.activity, c.preferred_participants, c.schedule,
           c.community_date, c.community_time, c.max_participants, c.participation_fee,
           c.approved_count,
           (select count(*)::int from public.community_applications a
             where a.community_id = c.id and a.status = 'pending'),
           c.created_at,
           p.id, p.nickname, p.reservation_number,
           r.reservation_number
      from public.communities c
      join public.profiles p on p.id = c.creator_id
      left join public.community_reservations r on r.community_id = c.id
     order by c.community_date desc, c.community_time desc;
end;
$$;

revoke all on function
  public.current_profile_id(), public.is_admin(),
  public.register_guest(text, text), public.get_my_profile(),
  public.create_community(text, text, text, text, text, date, time, int, int),
  public.review_application(uuid, text),
  public.admin_list_guests(), public.admin_list_communities()
  from public, anon;

grant execute on function
  public.current_profile_id(), public.is_admin(),
  public.register_guest(text, text), public.get_my_profile(),
  public.create_community(text, text, text, text, text, date, time, int, int),
  public.review_application(uuid, text),
  public.admin_list_guests(), public.admin_list_communities()
  to authenticated;

-- ---------------------------------------------------------------------
-- 6. REALTIME
-- None of these tables contain reservation numbers. Realtime applies the
-- same RLS, so e.g. applications only reach the applicant + creator + admin.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['posts', 'comments', 'communities', 'community_applications'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. ADMIN ACCOUNT  (run manually, once per admin)
-- TODO: Configure real admin authentication
--   1) Dashboard → Authentication → Users → "Add user" (email + password,
--      auto-confirm). Do NOT enable public email sign-up.
--   2) Then run (replace the email):
--
-- insert into public.profiles (auth_user_id, reservation_number, nickname, role)
-- select id, 'STAFF', 'WegoinnAdmin', 'admin' from auth.users where email = 'admin@example.com'
-- on conflict (auth_user_id) do update set role = 'admin';
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 8. STORAGE — guestbook photos (bucket "post-images")
-- Public read (URLs are stored in posts.image_url). Registered guests may
-- upload only into their own <auth uid>/ folder; compressed WebP/JPEG ≤ 1 MB
-- (the browser already shrinks photos to ~150 KB).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "post_images_insert_own" on storage.objects;
create policy "post_images_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.current_profile_id()) is not null
  );

drop policy if exists "post_images_delete_own" on storage.objects;
create policy "post_images_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'post-images'
    and ((storage.foldername(name))[1] = (select auth.uid())::text
         or (select public.is_admin()))
  );
-- Apply to the existing Supabase project before using the updated frontend.
begin;
alter table public.communities add column if not exists status text not null default 'active' check (status in ('active','cancelled'));
alter table public.communities add column if not exists meeting_place text not null default '' check (char_length(meeting_place) <= 200);
alter table public.communities add column if not exists map_url text not null default '' check (map_url = '' or map_url ~ '^https://[^[:space:]]+$');
alter table public.communities add column if not exists updated_at timestamptz not null default now();
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

-- Keep the existing RPC signature so existing installations can upgrade in place.
-- Reservation numbers are optional; absent numbers never produce a fake reservation.
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

-- JOIN goes straight in (no host approval); withdrawn or old pending requests can join again.
create or replace function public.join_community(p_community_id uuid)
returns table (status text, approved_count int, max_participants int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
 v_me uuid := public.current_profile_id();
 c public.communities%rowtype;
 a public.community_applications%rowtype;
begin
 if v_me is null then raise exception 'Not signed in' using errcode = '42501'; end if;
 -- Lock order: community first, then application (same as review/withdraw).
 select * into c from public.communities where id = p_community_id for update;
 if not found then raise exception 'Community not found'; end if;
 if c.creator_id = v_me then raise exception 'You are hosting this community'; end if;
 if c.status <> 'active' or (c.community_date + c.community_time) <= (clock_timestamp() at time zone 'Asia/Seoul') then
  raise exception 'This community is read-only';
 end if;
 if c.application_deadline is not null and c.application_deadline <= (clock_timestamp() at time zone 'Asia/Seoul') then
  raise exception 'Applications are closed';
 end if;
 select * into a from public.community_applications where community_id = c.id and applicant_id = v_me for update;
 if found and a.status = 'approved' then raise exception 'You have already joined this community'; end if;
 if found and a.status = 'declined' then raise exception 'The host declined your request'; end if;
 if c.approved_count >= c.max_participants then raise exception 'FULL: this community has reached its maximum participants'; end if;
 if found then
  update public.community_applications set status = 'approved', reviewed_at = now() where id = a.id;
 else
  insert into public.community_applications (community_id, applicant_id, status, reviewed_at)
  values (c.id, v_me, 'approved', now());
 end if;
 update public.communities set approved_count = approved_count + 1 where id = c.id;
 return query select 'approved'::text, x.approved_count, x.max_participants from public.communities x where x.id = c.id;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
 update public.notifications set read_at = now() where id = any(p_ids) and recipient_id = public.current_profile_id() and read_at is null;
$$;

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
drop trigger if exists notify_community_changes on public.communities;
create trigger notify_community_changes after update on public.communities for each row execute function public.notify_community_changes();

create or replace function public.notify_application_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.communities%rowtype; recipient uuid; event_kind text;
begin
 select * into c from public.communities where id = new.community_id;
 if tg_op = 'INSERT' then recipient := c.creator_id; event_kind := 'application';
 elsif new.status is distinct from old.status then
  if new.status = 'approved' and new.applicant_id = public.current_profile_id() then recipient := c.creator_id; event_kind := 'application';
  elsif new.status = 'withdrawn' then recipient := c.creator_id; event_kind := new.status;
  else recipient := new.applicant_id; event_kind := new.status;
  end if;
 else return new;
 end if;
 insert into public.notifications(recipient_id,community_id,kind,community_title) values(recipient,c.id,event_kind,c.title);
 return new;
end $$;
drop trigger if exists notify_application_changes on public.community_applications;
create trigger notify_application_changes after insert or update on public.community_applications for each row execute function public.notify_application_changes();

revoke all on function public.update_community(uuid,jsonb), public.create_community_v2(text,jsonb), public.cancel_community(uuid), public.withdraw_application(uuid), public.join_community(uuid), public.mark_notifications_read(uuid[]), public.guard_community_lifecycle(), public.guard_application_lifecycle(), public.notify_community_changes(), public.notify_application_changes() from public, anon;
grant execute on function public.update_community(uuid,jsonb), public.create_community_v2(text,jsonb), public.cancel_community(uuid), public.withdraw_application(uuid), public.join_community(uuid), public.mark_notifications_read(uuid[]) to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
 alter publication supabase_realtime add table public.notifications;
 end if;
end $$;
commit;

-- ---------------------------------------------------------------------
-- 9. LIVE CHAT (same as migrations/20261009_live_chat.sql)
begin;

create table if not exists public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  community_id      uuid references public.communities (id) on delete cascade, -- null = Global Chat
  author_id         uuid not null default public.current_profile_id()
                    references public.profiles (id) on delete cascade,
  content           text not null check (char_length(btrim(content)) between 1 and 500),
  original_language text check (original_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  created_at        timestamptz not null default now()
);
create index if not exists chat_messages_room_idx on public.chat_messages (community_id, created_at desc);
create index if not exists chat_messages_author_idx on public.chat_messages (author_id, created_at desc);

-- Global Chat: any registered guest. Community room: host, approved members, admins.
create or replace function public.can_access_chat_room(p_community_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_profile_id() is not null and (
    p_community_id is null
    or public.is_admin()
    or exists (select 1 from public.communities c
               where c.id = p_community_id and c.creator_id = public.current_profile_id())
    or exists (select 1 from public.community_applications a
               where a.community_id = p_community_id
                 and a.applicant_id = public.current_profile_id()
                 and a.status = 'approved')
  )
$$;

-- Flood guard: at most 5 messages per 10 seconds per guest.
create or replace function public.chat_rate_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select count(*) from public.chat_messages
      where author_id = new.author_id and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'SLOW_DOWN: too many messages';
  end if;
  return new;
end $$;
drop trigger if exists chat_rate_limit on public.chat_messages;
create trigger chat_rate_limit before insert on public.chat_messages
  for each row execute function public.chat_rate_limit();

-- Privileges: author_id comes from its column default only.
revoke all on public.chat_messages from anon, authenticated;
grant select, delete on public.chat_messages to authenticated;
grant insert (community_id, content, original_language) on public.chat_messages to authenticated;

alter table public.chat_messages enable row level security;

drop policy if exists chat_select on public.chat_messages;
create policy chat_select on public.chat_messages
  for select to authenticated
  using ((select public.can_access_chat_room(community_id)));

drop policy if exists chat_insert on public.chat_messages;
create policy chat_insert on public.chat_messages
  for insert to authenticated
  with check (author_id = (select public.current_profile_id())
              and (select public.can_access_chat_room(community_id)));

drop policy if exists chat_delete on public.chat_messages;
create policy chat_delete on public.chat_messages
  for delete to authenticated
  using (author_id = (select public.current_profile_id()) or (select public.is_admin()));

revoke all on function public.can_access_chat_room(uuid), public.chat_rate_limit() from public, anon;
grant execute on function public.can_access_chat_room(uuid) to authenticated;

-- Realtime: INSERT events are checked against chat_select per subscriber,
-- so community-room messages only reach that room's members.
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
commit;

-- ---------------------------------------------------------------------
-- Guest profile photos (same as migrations/20261010_guest_avatar.sql)
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_url text
  check (avatar_url is null or avatar_url ~ '^https://[^[:space:]]+$');

-- Other guests may see the photo next to the nickname.
grant select (avatar_url) on public.profiles to authenticated;

-- Chat shows operator messages as notices (same as migrations/20261024_operator_chat_notice.sql).
grant select (role) on public.profiles to authenticated;

-- The only write path: a guest may point avatar_url at a file in their own storage folder.
create or replace function public.set_my_avatar(p_avatar_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
 if auth.uid() is null or public.current_profile_id() is null then
  raise exception 'Not signed in' using errcode = '42501';
 end if;
 if p_avatar_url is not null
    and position('/storage/v1/object/public/post-images/' || auth.uid()::text || '/' in p_avatar_url) = 0 then
  raise exception 'Invalid profile photo';
 end if;
 update public.profiles set avatar_url = nullif(btrim(p_avatar_url), '') where auth_user_id = auth.uid();
end $$;

revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;
notify pgrst, 'reload schema';

-- Stay login and room capacity
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
('608','Deluxe',4),
('806','Dormitory',6),
('807','Dormitory',6)
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
create or replace function public.get_my_stay() returns table(id uuid,nickname text,role text,check_in text,check_out text,room_number text,room_type text,capacity integer,avatar_url text)
language sql stable security definer set search_path=public as $$
 select p.id,p.nickname,p.role,case when p.reservation_number='operator:999222' then '999222' else p.check_in::text end,case when p.reservation_number='operator:999222' then '999222' else p.check_out::text end,p.room_number,r.room_type,r.capacity,p.avatar_url
 from public.profiles p left join public.hostel_rooms r using(room_number) where p.id=public.current_profile_id()
$$;
-- Retire the old registration path so it cannot bypass room capacity.
revoke execute on function public.register_guest(text,text) from public,anon,authenticated;
revoke all on function public.register_stay_guest(text,text,text,text),public.get_my_stay() from public,anon;
grant execute on function public.register_stay_guest(text,text,text,text),public.get_my_stay() to authenticated;
-- Called (with the guest's own token) by /api/stay-status when the Guest Log sheet marks the guest "x".
create or replace function public.end_my_stay() returns void language plpgsql security definer set search_path=public as $$
declare v_id uuid:=public.current_profile_id();
begin
 if v_id is null then return; end if;
 update public.profiles set stay_ended_at=now() where id=v_id and role<>'admin';
end $$;

revoke all on function public.end_my_stay(), public.stay_is_active(public.profiles) from public,anon;
grant execute on function public.end_my_stay() to authenticated;
create or replace function public.set_my_avatar(p_avatar_url text) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or public.current_profile_id() is null then raise exception 'Not signed in'; end if;
 if p_avatar_url is not null and position('/storage/v1/object/public/post-images/'||auth.uid()::text||'/' in p_avatar_url)=0 then raise exception 'Invalid profile photo'; end if;
 update public.profiles set avatar_url=nullif(btrim(p_avatar_url),'') where id=public.current_profile_id();
end $$;
notify pgrst,'reload schema';
commit;

-- Operator moderation
-- Operator moderation. Run after 20261013_stay_login.sql in the Supabase SQL Editor.
begin;
create or replace function public.guard_community_lifecycle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
 if public.is_admin() then
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
 end if;
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

create or replace function public.update_community(p_community_id uuid, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare c public.communities%rowtype;
begin
 select * into c from public.communities where id = p_community_id for update;
 if not found then raise exception 'Community not found'; end if;
 if c.creator_id is distinct from public.current_profile_id() and not public.is_admin() then raise exception 'Only the host can edit this community' using errcode = '42501'; end if;
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

grant delete on public.communities to authenticated;
drop policy if exists communities_admin_delete on public.communities;
create policy communities_admin_delete on public.communities for delete to authenticated using ((select public.is_admin()));

create table if not exists public.community_comments (
 id uuid primary key default gen_random_uuid(),
 community_id uuid not null references public.communities(id) on delete cascade,
 author_id uuid not null default public.current_profile_id() references public.profiles(id) on delete cascade,
 content text not null check(char_length(btrim(content)) between 1 and 500),
 is_operator boolean not null default public.is_admin(),
 created_at timestamptz not null default now()
);
create index if not exists community_comments_thread_idx on public.community_comments(community_id,created_at);
alter table public.community_comments enable row level security;
revoke all on public.community_comments from public,anon,authenticated;
grant select,delete on public.community_comments to authenticated;
grant insert(community_id,content) on public.community_comments to authenticated;

drop policy if exists community_comments_select on public.community_comments;
create policy community_comments_select on public.community_comments for select to authenticated using ((select public.current_profile_id()) is not null);
drop policy if exists community_comments_insert on public.community_comments;
create policy community_comments_insert on public.community_comments for insert to authenticated with check (
 author_id=(select public.current_profile_id()) and is_operator=(select public.is_admin())
 and (is_operator or exists(select 1 from public.communities c where c.id=community_id and c.creator_id=(select public.current_profile_id())))
);
drop policy if exists community_comments_delete on public.community_comments;
create policy community_comments_delete on public.community_comments for delete to authenticated using (author_id=(select public.current_profile_id()) or (select public.is_admin()));

create or replace function public.admin_update_content(p_kind text,p_id uuid,p_content text,p_original_language text default null,p_remove_image boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Admin only' using errcode='42501'; end if;
 case p_kind
 when 'post' then
  update public.posts set content=btrim(p_content),original_language=p_original_language,image_url=case when p_remove_image then null else image_url end where id=p_id;
 when 'comment' then
  update public.comments set content=btrim(p_content),original_language=p_original_language where id=p_id;
 when 'chat' then
  update public.chat_messages set content=btrim(p_content),original_language=p_original_language where id=p_id;
 when 'community_comment' then
  update public.community_comments set content=btrim(p_content) where id=p_id;
 else raise exception 'Unsupported content type';
 end case;
 if not found then raise exception 'Content not found'; end if;
end $$;
revoke all on function public.admin_update_content(text,uuid,text,text,boolean) from public,anon;
grant execute on function public.admin_update_content(text,uuid,text,text,boolean) to authenticated;

-- Notify the community's author of an operator comment; notify operators when the host replies.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in ('application','approved','declined','withdrawn','updated','cancelled','comment'));
create or replace function public.notify_community_comment() returns trigger language plpgsql security definer set search_path=public as $$
declare c public.communities%rowtype;
begin
 select * into c from public.communities where id=new.community_id;
 insert into public.notifications(recipient_id,community_id,kind,community_title)
 select p.id,c.id,'comment',c.title from public.profiles p
 where p.id<>new.author_id and ((new.is_operator and p.id=c.creator_id) or (not new.is_operator and p.role='admin'));
 return new;
end $$;
revoke all on function public.notify_community_comment() from public,anon,authenticated;
drop trigger if exists notify_community_comment on public.community_comments;
create trigger notify_community_comment after insert on public.community_comments for each row execute function public.notify_community_comment();

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='community_comments') then
  alter publication supabase_realtime add table public.community_comments;
 end if;
end $$;
notify pgrst,'reload schema';
commit;

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

-- Community cover photos (20261014_community_image.sql)
begin;
alter table public.communities add column if not exists image_url text;
alter table public.communities drop constraint if exists communities_image_url_check;
alter table public.communities add constraint communities_image_url_check
  check (image_url is null or image_url ~ '^https://[^ ]+/storage/v1/object/public/post-images/');

-- Host (or admin) sets or clears the cover photo. The lifecycle trigger still
-- keeps cancelled and started communities read-only.
create or replace function public.set_community_image(p_community_id uuid, p_image_url text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.communities%rowtype;
begin
 select * into c from public.communities where id = p_community_id for update;
 if not found then raise exception 'Community not found'; end if;
 if c.creator_id is distinct from public.current_profile_id() and not public.is_admin() then
  raise exception 'Only the host can change the photo' using errcode = '42501';
 end if;
 update public.communities set image_url = nullif(btrim(coalesce(p_image_url, '')), '') where id = c.id;
end $$;

revoke all on function public.set_community_image(uuid, text) from public, anon;
grant execute on function public.set_community_image(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;

-- Community member list (20261014_community_members.sql)
begin;
create or replace function public.community_members(p_community_id uuid)
returns table(nickname text, avatar_url text, is_host boolean, is_me boolean, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
 select m.nickname, m.avatar_url, m.is_host, m.id = public.current_profile_id(), m.joined_at
 from (
  select p.id, p.nickname, p.avatar_url, true as is_host, c.created_at as joined_at
  from public.communities c join public.profiles p on p.id = c.creator_id
  where c.id = p_community_id
  union all
  select p.id, p.nickname, p.avatar_url, false, a.created_at
  from public.community_applications a join public.profiles p on p.id = a.applicant_id
  where a.community_id = p_community_id and a.status = 'approved'
 ) m
 where public.current_profile_id() is not null
 order by m.is_host desc, m.joined_at;
$$;

revoke all on function public.community_members(uuid) from public, anon;
grant execute on function public.community_members(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;

-- ============================================================
-- The host always attends and takes one seat in approved_count.
-- ============================================================
create or replace function public.count_host_seat()
returns trigger language plpgsql set search_path = public as $$
begin
 new.approved_count := 1;
 return new;
end $$;
drop trigger if exists count_host_seat on public.communities;
create trigger count_host_seat before insert on public.communities
for each row execute function public.count_host_seat();
revoke all on function public.count_host_seat() from public, anon, authenticated;

-- ============================================================
-- Official Wegoinn communities: created by an operator (admin).
-- ============================================================
alter table public.communities add column if not exists is_official boolean not null default false;
create or replace function public.mark_official_community()
returns trigger language plpgsql security definer set search_path = public as $$
begin
 new.is_official := exists (select 1 from public.profiles p where p.id = new.creator_id and p.role = 'admin');
 return new;
end $$;
drop trigger if exists mark_official_community on public.communities;
create trigger mark_official_community before insert on public.communities
for each row execute function public.mark_official_community();
revoke all on function public.mark_official_community() from public, anon, authenticated;
