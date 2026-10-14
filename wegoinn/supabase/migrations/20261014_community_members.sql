-- Run in the Supabase SQL Editor so every signed-in guest can see who joined a community
-- (Members tab in the community detail). Only nickname and profile photo are returned —
-- the same details already shown next to guestbook posts. Applications themselves stay
-- readable only by the applicant, the host and admins (applications_select policy).
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
