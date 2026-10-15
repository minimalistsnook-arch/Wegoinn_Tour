-- The host always attends: they take one seat in approved_count from the moment
-- the community is created, so "3 / 8 people" now includes the host.

-- Existing communities: add the host's seat once (skipped if this already ran).
-- A community that was already full gets one more seat so nobody is pushed out.
do $$
begin
 if not exists (select 1 from pg_trigger where tgname = 'count_host_seat') then
  update public.communities
  set max_participants = greatest(max_participants, approved_count + 1),
      approved_count = approved_count + 1
  where approved_count < 30;
 end if;
end $$;

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

notify pgrst, 'reload schema';
