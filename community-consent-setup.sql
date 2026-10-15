begin;
-- Authentication and stay checks remain available before community consent.
create or replace function public.session_profile_id() returns uuid
language sql stable security definer set search_path=public as $$
 select p.id from public.profiles p
 where p.id=coalesce((select profile_id from public.guest_sessions where auth_user_id=auth.uid()),
                    (select id from public.profiles where auth_user_id=auth.uid()))
 and public.stay_is_active(p)
$$;
revoke all on function public.session_profile_id() from public,anon;
grant execute on function public.session_profile_id() to authenticated;

create table if not exists public.community_terms_versions (
 version bigint generated always as identity primary key,
 body text not null check(char_length(body) between 100 and 30000),
 published_at timestamptz not null default now(),
 published_by uuid references public.profiles(id) on delete set null
);
create table if not exists public.community_terms_acceptances (
 profile_id uuid not null references public.profiles(id) on delete cascade,
 version bigint not null references public.community_terms_versions(version),
 accepted_at timestamptz not null default now(),
 primary key(profile_id,version)
);
alter table public.community_terms_versions enable row level security;
alter table public.community_terms_acceptances enable row level security;
revoke all on public.community_terms_versions,public.community_terms_acceptances from anon,authenticated;

insert into public.community_terms_versions(body) select '# Welcome to WEGO INN Community! 🎉
### 위고인 커뮤니티에 오신 것을 진심으로 환영합니다.

위고인 커뮤니티는 투숙객 여러분이 자유롭게 소통하고, 새로운 친구를 만나며, 즐거운 추억을 나눌 수 있도록 마련된 공간입니다.

모두가 안전하고 즐겁게 커뮤니티를 이용할 수 있도록 아래 안내사항을 꼭 확인해 주세요.

### 1. 커뮤니티 운영 안내
위고인 커뮤니티는 투숙객 간의 자율적인 소통과 교류를 위한 공간으로, 위고인호스텔의 공식 숙박 서비스와는 별도로 운영됩니다.

### 2. 커뮤니티 이용 목적
본 커뮤니티는 자유로운 대화, 정보 공유 및 다양한 모임을 통해 투숙객 간의 교류를 돕기 위해 마련되었습니다.

### 3. 이용자 간 분쟁 및 책임
커뮤니티 내에서 이용자 간 발생하는 갈등, 불쾌한 경험, 금전 거래 및 기타 개인적인 분쟁에 대해서는 원칙적으로 해당 이용자 간에 해결해야 합니다.

위고인호스텔은 관련 법령에 따라 부담하는 책임을 제외하고, 이용자 간의 개인적인 활동이나 거래에서 발생하는 문제에 대해 책임을 지지 않습니다.

### 4. 모임 참여 및 비용 안내
커뮤니티에서 진행되는 일부 모임 및 활동에는 참가비가 발생할 수 있습니다.

모임 참여 전 반드시 주최자, 참가비, 일정 및 세부 내용을 확인해 주세요.

**위고인호스텔이 직접 주최하는 공식 모임은 별도로 표시됩니다.** 공식 표시가 없는 모임은 이용자가 자율적으로 주최하는 활동입니다.

### 5. 숙박 관련 문의 및 요청
객실 이용 중 불편사항, 서비스 요청, 숙박 관련 문의는 아래 공식 연락처를 이용해 주세요.

- **1층 리셉션:** 09:00 ~ 22:00
- **이메일:** Wegoinnteam@gmail.com

커뮤니티에서는 숙박 관련 민원이나 서비스 요청을 접수·처리하지 않으므로 양해 부탁드립니다.

### 6. 커뮤니티 이용 에티켓
모든 이용자가 편안하게 소통할 수 있도록 서로를 존중하고 배려해 주세요.

타인에게 불쾌감이나 혐오감을 유발하는 발언, 사진, 행동을 비롯하여 욕설, 비방, 차별, 성희롱, 괴롭힘 등의 행위는 금지됩니다.

운영자는 커뮤니티의 안전과 건전한 이용 환경을 위해 운영 정책에 위반되는 게시글 및 댓글을 삭제하거나 해당 계정의 이용을 제한할 수 있습니다.

---

### 이용 동의 안내

위 안내사항을 충분히 확인하고 동의하시는 경우, 아래 **''동의하고 시작하기''** 버튼을 눌러 커뮤니티를 이용해 주세요.

여러분의 배려와 참여로 더욱 따뜻하고 즐거운 위고인 커뮤니티가 만들어지길 바랍니다.

**감사합니다.**

WEGO INN HOSTEL' where not exists(select 1 from public.community_terms_versions);

create or replace function public.has_community_consent() returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.community_terms_acceptances a
 where a.profile_id=public.session_profile_id()
 and a.version=(select max(version) from public.community_terms_versions))
$$;
create or replace function public.current_profile_id() returns uuid
language sql stable security definer set search_path=public as $$
 select p.id from public.profiles p where p.id=public.session_profile_id()
 and (p.role='admin' or public.has_community_consent())
$$;
-- Only the signed-in guest's own profile is readable before consent (for their avatar).
drop policy if exists profiles_select_own_before_consent on public.profiles;
create policy profiles_select_own_before_consent on public.profiles for select to authenticated
using(id=(select public.session_profile_id()));

create or replace function public.get_my_profile() returns table(id uuid,nickname text,role text)
language sql stable security definer set search_path=public as $$
 select p.id,p.nickname,p.role from public.profiles p where p.id=public.session_profile_id()
$$;
create or replace function public.get_my_stay()
returns table(id uuid,nickname text,role text,check_in text,check_out text,room_number text,room_type text,capacity integer,avatar_url text)
language sql stable security definer set search_path=public as $$
 select p.id,p.nickname,p.role,
 case when p.reservation_number='operator:999222' then '999222' else p.check_in::text end,
 case when p.reservation_number='operator:999222' then '999222' else p.check_out::text end,
 p.room_number,r.room_type,r.capacity,p.avatar_url
 from public.profiles p left join public.hostel_rooms r using(room_number)
 where p.id=public.session_profile_id()
$$;
create or replace function public.set_my_avatar(p_avatar_url text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if public.session_profile_id() is null then raise exception 'Not signed in'; end if;
 if p_avatar_url is not null and position('/storage/v1/object/public/post-images/'||auth.uid()::text||'/' in p_avatar_url)=0 then raise exception 'Invalid profile photo'; end if;
 update public.profiles set avatar_url=nullif(btrim(p_avatar_url),'') where id=public.session_profile_id();
end $$;
create or replace function public.end_my_stay() returns void
language plpgsql security definer set search_path=public as $$
begin
 update public.profiles set stay_ended_at=now() where id=public.session_profile_id() and role<>'admin';
end $$;
-- New guests can upload their registration photo before seeing the agreement.
drop policy if exists post_images_insert_own on storage.objects;
create policy post_images_insert_own on storage.objects for insert to authenticated
with check(bucket_id='post-images' and (storage.foldername(name))[1]=(select auth.uid())::text
 and (select public.session_profile_id()) is not null);

create or replace function public.get_community_terms() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v public.community_terms_versions; v_id uuid:=public.session_profile_id();
begin
 if v_id is null then raise exception 'Not signed in'; end if;
 select * into v from public.community_terms_versions order by version desc limit 1;
 return jsonb_build_object('version',v.version,'body',v.body,'accepted',exists(
 select 1 from public.community_terms_acceptances a where a.profile_id=v_id and a.version=v.version));
end $$;
create or replace function public.accept_community_terms(p_version bigint) returns void
language plpgsql security definer set search_path=public as $$
declare v_id uuid:=public.session_profile_id(); v_version bigint;
begin
 if v_id is null then raise exception 'Not signed in'; end if;
 perform pg_advisory_xact_lock(hashtextextended('community-terms',0));
 select max(version) into v_version from public.community_terms_versions;
 if p_version is null or p_version is distinct from v_version then raise exception '안내 내용이 변경되었습니다. 최신 내용을 확인하고 다시 동의해 주세요.'; end if;
 insert into public.community_terms_acceptances(profile_id,version) values(v_id,p_version) on conflict do nothing;
end $$;
create or replace function public.publish_community_terms(p_body text,p_expected_version bigint) returns bigint
language plpgsql security definer set search_path=public as $$
declare v_version bigint;
begin
 if not public.is_admin() then raise exception '운영자만 안내 내용을 변경할 수 있습니다.' using errcode='42501'; end if;
 if coalesce(char_length(btrim(p_body)),0) not between 100 and 30000 then raise exception '안내 내용은 100~30000자로 입력해 주세요.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('community-terms',0));
 select max(version) into v_version from public.community_terms_versions;
 if p_expected_version is null or p_expected_version is distinct from v_version then raise exception '다른 운영자가 내용을 수정했습니다. 새로고침 후 다시 저장해 주세요.'; end if;
 if exists(select 1 from public.community_terms_versions where version=v_version and body=btrim(p_body)) then return v_version; end if;
 insert into public.community_terms_versions(body,published_by) values(btrim(p_body),public.session_profile_id()) returning version into v_version;
 return v_version;
end $$;
revoke all on function public.has_community_consent(),public.get_community_terms(),public.accept_community_terms(bigint),public.publish_community_terms(text,bigint) from public,anon;
grant execute on function public.has_community_consent(),public.get_community_terms(),public.accept_community_terms(bigint),public.publish_community_terms(text,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
