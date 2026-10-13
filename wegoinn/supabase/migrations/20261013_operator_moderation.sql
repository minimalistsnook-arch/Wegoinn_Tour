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
