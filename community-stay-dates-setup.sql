-- Guest-hosted communities must fall within the host's stay (inclusive dates).
begin;
create or replace function public.enforce_community_stay_dates()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_host public.profiles;
begin
 if public.is_admin() then return new; end if;
 if tg_op='UPDATE' then
  if new.community_date is not distinct from old.community_date
     and new.creator_id is not distinct from old.creator_id then return new; end if;
 end if;
 select p.* into v_host from public.profiles p where p.id=new.creator_id;
 if not found then raise exception '주최자 계정을 확인할 수 없습니다.'; end if;
 if v_host.role='admin' then return new; end if;
 if v_host.check_in is null or v_host.check_out is null
    or new.community_date is null
    or new.community_date < v_host.check_in
    or new.community_date > v_host.check_out then
  raise exception '모임 날짜는 주최자의 체크인일부터 체크아웃일까지의 숙박 기간 안에서 선택해 주세요.';
 end if;
 return new;
end $$;
revoke all on function public.enforce_community_stay_dates() from public,anon,authenticated;
drop trigger if exists communities_stay_dates on public.communities;
create trigger communities_stay_dates before insert or update of community_date,creator_id
on public.communities for each row execute function public.enforce_community_stay_dates();
notify pgrst,'reload schema';
commit;
