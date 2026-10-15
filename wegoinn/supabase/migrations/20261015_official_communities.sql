-- Communities created by an operator (profiles.role = 'admin') are official Wegoinn
-- communities: the calendar shows the hug picture on their day.
alter table public.communities add column if not exists is_official boolean not null default false;

-- Set on insert from the creator's role; guests can never mark their own community official.
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

-- Existing communities made by an operator. The lifecycle guard rejects updates to past
-- communities, so it is paused just for this one backfill.
alter table public.communities disable trigger guard_community_lifecycle;
update public.communities c set is_official = true
from public.profiles p
where p.id = c.creator_id and p.role = 'admin' and not c.is_official;
alter table public.communities enable trigger guard_community_lifecycle;

notify pgrst, 'reload schema';
