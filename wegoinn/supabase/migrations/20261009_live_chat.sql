-- Live chat: one Global Chat for every registered guest, plus one chat room
-- per community for its host and approved members.
-- Apply in Supabase Dashboard → SQL Editor (after schema.sql and earlier migrations).
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

-- Make the REST API see the new table right away.
notify pgrst, 'reload schema';
