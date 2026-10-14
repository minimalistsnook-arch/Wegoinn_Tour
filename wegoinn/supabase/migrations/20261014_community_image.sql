-- Run in the Supabase SQL Editor to let hosts add a cover photo to a community.
-- The photo itself lives in the public "post-images" bucket (same upload rules as
-- guestbook photos); only its https URL is stored here.
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
