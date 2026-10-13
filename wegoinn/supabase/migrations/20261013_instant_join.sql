-- Run in the Supabase SQL Editor: JOIN takes a guest straight into a community (no host approval).
-- Guests who withdrew, or whose request is still pending from before, can join again the same way.
begin;
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

-- A guest joining (insert, or rejoining after withdrawing) notifies the host, not the guest.
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

revoke all on function public.join_community(uuid) from public, anon;
grant execute on function public.join_community(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
