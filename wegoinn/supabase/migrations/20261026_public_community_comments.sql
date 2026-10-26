-- All registered guests may ask questions without joining the community.
alter table public.community_comments add column if not exists parent_id uuid;
alter table public.community_comments add constraint community_comments_id_community_unique unique(id,community_id);
alter table public.community_comments add constraint community_comments_parent_fk
 foreign key(parent_id,community_id) references public.community_comments(id,community_id) on delete cascade;
alter table public.community_comments add constraint community_comments_not_self check(parent_id is distinct from id);
create index if not exists community_comments_parent_idx on public.community_comments(parent_id);
grant insert(parent_id) on public.community_comments to authenticated;
drop policy if exists community_comments_insert on public.community_comments;
create policy community_comments_insert on public.community_comments for insert to authenticated with check (
 author_id=(select public.current_profile_id()) and is_operator=(select public.is_admin())
);

-- Keep replies one level deep and prevent replies to a different community.
create or replace function public.validate_community_comment_reply() returns trigger language plpgsql set search_path=public as $$
begin
 if new.parent_id is not null and not exists (
  select 1 from public.community_comments where id=new.parent_id and community_id=new.community_id and parent_id is null
 ) then raise exception 'Reply target must be a top-level comment in this community'; end if;
 return new;
end $$;
revoke all on function public.validate_community_comment_reply() from public,anon,authenticated;
create trigger validate_community_comment_reply before insert on public.community_comments
 for each row execute function public.validate_community_comment_reply();

create or replace function public.notify_community_comment() returns trigger language plpgsql security definer set search_path=public as $$
declare c public.communities%rowtype;
begin
 select * into c from public.communities where id=new.community_id;
 insert into public.notifications(recipient_id,community_id,kind,community_title)
 select p.id,c.id,'comment',c.title from public.profiles p
 where p.id<>new.author_id and (
  p.id=c.creator_id or (not new.is_operator and p.role='admin')
  or p.id=(select author_id from public.community_comments where id=new.parent_id)
 );
 return new;
end $$;
