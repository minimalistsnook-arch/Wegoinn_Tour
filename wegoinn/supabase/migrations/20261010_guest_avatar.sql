-- Round profile photos for guests. Run in the Supabase SQL Editor.
-- Photos live in the existing post-images bucket under <auth uid>/ (see 20261010_post_images_storage.sql).
begin;

alter table public.profiles add column if not exists avatar_url text
  check (avatar_url is null or avatar_url ~ '^https://[^[:space:]]+$');

-- Other guests may see the photo next to the nickname.
grant select (avatar_url) on public.profiles to authenticated;

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
commit;
