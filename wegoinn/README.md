# Wegoinn Guestbook & Community

Wegoinn Hostel 투숙객 전용 모바일 웹앱 — 방명록(Guestbook)과 날짜별 소모임(Community Calendar).
HTML · CSS · Vanilla JS (ES Modules) + Supabase (Auth / PostgreSQL / RLS / Realtime).

---

## 1. 전체 Architecture

```
┌──────────────── Browser (정적 파일) ────────────────┐
│ index.html  — Guest 모바일 앱                        │
│ admin.html  — Admin 데스크톱 대시보드                │
│ js/*.js     — anon key만 사용 (service_role 절대 X)  │
└───────┬───────────────┬──────────────┬──────────────┘
        │ Supabase JS   │ fetch        │ fetch
        ▼               ▼              ▼
  Supabase           R2 Upload       Translation
  ├ Auth (Anonymous / Admin email)   Worker (TODO)  API (TODO)
  ├ PostgreSQL + RLS + RPC
  └ Realtime (posts, comments, communities, applications)
```

- **Guest 로그인**: `signInAnonymously()` → 익명 auth user UUID 생성 → `register_guest()` RPC가 그 UUID와 profile(예약번호·닉네임)을 연결.
- **권한 판단은 전부 DB**: `profiles.role`이 유일한 Admin 판단 기준. 클라이언트는 `role` 컬럼을 쓸 권한 자체가 없음(컬럼 권한 + RLS).
- **사진**: 브라우저에서 압축(긴 변 ≤1280px, WebP, 장당 ~150KB 목표로 품질·크기 자동 조절) → `uploadImage()` (Supabase Storage `post-images` 버킷) → 공개 https URL만 `posts.image_url`에 저장.
- **번역**: `translateText()` 구조만 존재. API 미연결 시 원문 유지 + 안내 토스트(가짜 번역 없음).

## 2. 화면 구조

**Guest (index.html, Mobile First)**

```
Header (Wegoinn · 내 닉네임)
Section 탭 (Guestbook / Community — 스크롤 위치 표시)
Hello, {Nickname}
01 WEGOINN GUESTBOOK
   ├ Create Post (텍스트 + 사진)
   └ Post Feed (닉네임 · 내용 · 사진 · 날짜/시간 · Translated/Original · 댓글/답글)
02 COMMUNITY CALENDAR
   ├ 큰 달력 (Community 있는 날짜에 Dot)
   ├ Selected Date Communities (카드: 제목 · 날짜 · 시간 · 승인인원/최대 · 참가비 · VIEW · JOIN)
   └ CREATE COMMUNITY (바텀시트 폼)
Community 상세 바텀시트 — Creator 본인에게만 관리 영역(승인 수 · 대기 수 · 신청자 + APPROVE/DECLINE)
```
PC에서도 같은 세로 순서(Guestbook 아래 Community Calendar)를 유지하고, 가운데 760px 컬럼으로 넓게 보여줍니다.

**Admin (admin.html, Desktop First)** — Sidebar + Main
`Guestbook` · `Comments` · `Communities`(예약번호/생성자/상세 Drawer) · `Applications` · `Guests`(예약번호)
태블릿에서는 아이콘 사이드바, 모바일 폭에서는 상단 바로 전환.

## 3. Database Schema

`supabase/schema.sql` 한 파일에 전부 들어 있습니다.

| Table | 주요 컬럼 |
|---|---|
| `profiles` | id, auth_user_id → auth.users, reservation_number, nickname, role(guest/admin), created_at |
| `posts` | id, author_id → profiles, content, original_language, image_url, created_at |
| `comments` | id, post_id → posts, author_id → profiles, parent_comment_id → comments, content, original_language, created_at |
| `communities` | id, creator_id → profiles, title, activity, preferred_participants, schedule, community_date, community_time, max_participants(1–30), participation_fee(KRW, 0=FREE), **approved_count**, created_at |
| `community_reservations` | community_id → communities (PK), **reservation_number**, created_at |
| `community_applications` | id, community_id → communities, applicant_id → profiles, status(pending/approved/declined), created_at, reviewed_at, UNIQUE(community_id, applicant_id) |

### 요청 스펙과 다른 점 (이유)

1. **Community 예약번호를 `community_reservations` 별도 테이블로 분리**
   `communities`는 Realtime으로 모든 Guest에게 변경 이벤트가 전송됩니다. Supabase Realtime 이벤트 payload는 컬럼 단위 권한을 보장하지 않으므로, 예약번호가 같은 행에 있으면 WebSocket으로 다른 Guest에게 새어나갈 위험이 있습니다. 분리된 테이블은 권한·정책이 전혀 없어 Admin RPC로만 읽힙니다.
   (`profiles.reservation_number`는 Realtime에 포함하지 않으므로 스펙대로 profiles에 두고 컬럼 권한으로 숨겼습니다.)
2. **`communities.approved_count` 추가**
   일반 Guest는 신청 목록(RLS로 차단)을 볼 수 없지만 "8 / 15 people"은 봐야 합니다. 승인 RPC가 row lock 안에서 이 값을 올리고, `CHECK (approved_count <= max_participants)`가 최종 방어선이 되어 동시 승인 경쟁(race condition)에서도 정원을 넘지 않습니다.
3. **댓글 깊이**: `POST → COMMENT → REPLY`(한 댓글 아래 여러 Reply)로 해석했습니다. Reply에 대한 Reply는 DB trigger가 거부합니다.

## 4. RLS / 권한 구조

| 대상 | SELECT | INSERT | DELETE | 기타 |
|---|---|---|---|---|
| profiles | 로그인 Guest: `id, nickname, created_at` 컬럼만 | ✗ (`register_guest` RPC만) | ✗ | `reservation_number`, `role` 쓰기 불가 |
| posts | 로그인 Guest 전체 | 본인(author_id는 DB default) | 본인 **또는 Admin** | |
| comments | 로그인 Guest 전체 | 본인, 깊이 trigger | 본인 **또는 Admin** | Reply는 부모 삭제 시 함께 삭제 |
| communities | 로그인 Guest 전체 | ✗ (`create_community` RPC) | ✗ | 수정 권한 없음 |
| community_reservations | ✗ | ✗ | ✗ | `admin_list_communities()`만 |
| community_applications | 신청자 본인 · 해당 Creator · Admin | 본인, status=pending, 자기 모임 X, FULL X | ✗ | 상태 변경은 `review_application()`만 (Creator 전용, row lock) |

RPC 함수 (모두 `SECURITY DEFINER`, `search_path` 고정, anon 실행 권한 제거):
`register_guest`, `get_my_profile`, `create_community`, `review_application`, `admin_list_guests`, `admin_list_communities`(내부에서 `is_admin()` 확인).

> 로컬 Postgres에서 이 정책들을 테스트했습니다: 다른 Guest의 글/댓글 삭제 차단, 예약번호 컬럼 조회 차단, role 변경 차단, 자기 모임 신청 차단, 30명 초과 차단, Creator 외 승인 차단, 동시 승인 2건 중 1건만 성공(FULL).

## 5. 파일 구조

```
wegoinn/
├ index.html            Guest 앱
├ admin.html            Admin 대시보드
├ css/
│  ├ style.css          Guest 디자인 (Mobile First)
│  └ admin.css          Admin 디자인 (Desktop First)
├ js/
│  ├ config.js          Supabase URL / anon key / R2·번역 endpoint
│  ├ supabase.js        클라이언트 생성, 에러 메시지
│  ├ auth.js            verifyReservationNumber(), signInGuest(), getMyProfile()
│  ├ app.js             Guest 부트스트랩, Realtime 구독
│  ├ guestbook.js       작성/피드/삭제
│  ├ comments.js        댓글·답글
│  ├ community.js       달력, 카드, 생성, JOIN, Creator 관리
│  ├ translation.js     translateText(), detectLanguage()
│  ├ image-upload.js    compressImage(), uploadImage()
│  ├ sheet.js           바텀시트
│  ├ icons.js           라인 아이콘
│  ├ utils.js           공통 유틸
│  └ admin.js           Admin 대시보드
└ supabase/schema.sql   테이블 + RLS + RPC + Realtime
```

## 6. 설치 / 실행

1. Supabase 프로젝트 생성 → **SQL Editor**에서 `supabase/schema.sql` 실행.
2. **Authentication → Sign In / Providers → Anonymous sign-ins 활성화.**
   (운영 시 Attack Protection의 CAPTCHA 활성화 권장 — 익명 가입 남용 방지)
   Email 공개 가입(Allow new users to sign up)은 끄세요. Admin 계정은 대시보드에서 직접 만듭니다.
3. `js/config.js`에 `SUPABASE_URL`, `SUPABASE_ANON_KEY` 입력. (**service_role key는 절대 넣지 마세요.**)
4. Admin 만들기: Authentication → Users → Add user(이메일/비번) 후 SQL Editor에서
   ```sql
   insert into public.profiles (auth_user_id, reservation_number, nickname, role)
   select id, 'STAFF', 'WegoinnAdmin', 'admin' from auth.users where email = 'admin@example.com'
   on conflict (auth_user_id) do update set role = 'admin';
   ```
5. 정적 서버로 실행 (ES Module이라 `file://`로는 동작하지 않습니다):
   ```bash
   npx serve wegoinn        # 또는: python3 -m http.server -d wegoinn 8080
   ```
   Guest: `/` · Admin: `/admin.html`

## 7. 남은 TODO

| 위치 | TODO |
|---|---|
| `js/auth.js`, `register_guest()` | `// TODO: Connect reservation verification API` — 실제 검증은 반드시 서버(Edge Function)에서도 |
| `js/translation.js` | `// TODO: Connect translation API` — `TRANSLATION_ENDPOINT`가 `{ text, target }` → `{ translatedText }` |
| `js/admin.js`, `schema.sql §7` | `// TODO: Configure real admin authentication` |

사진은 `schema.sql` §8이 만드는 Supabase Storage `post-images` 버킷에 저장됩니다(본인 폴더에만 업로드 가능, WebP/JPEG ≤ 1MB).


## 8. 모임 운영·언어·알림 업데이트 (2026-10-08)

기존 프로젝트는 Supabase SQL Editor에서 `supabase/migrations/20261008_community_lifecycle.sql`을 실행하세요. 신규 프로젝트는 전체 `schema.sql`을 실행하면 이 변경도 포함됩니다. **DB 변경을 먼저 적용하고 프런트엔드를 배포해야 합니다.**

- 주최자: 미래 모임 수정·취소. 취소는 삭제가 아닌 `status=cancelled` 처리입니다.
- 참가자: 대기·승인 상태의 신청 철회. 승인된 신청을 철회하면 승인 인원이 감소합니다. 신청 행은 `withdrawn` 상태로 남습니다. 철회·거절 후 재신청은 지원하지 않습니다.
- **시작 시각부터 읽기 전용**: 한국 시간 `Asia/Seoul` 기준으로 생성·수정·취소·신청·철회·승인을 DB에서도 차단합니다. 지난 모임과 취소된 모임은 모든 로그인 투숙객이 달력에서 계속 조회할 수 있습니다.
- 내 모임: 현재 달에 관계없이 주최·신청·지난 모임을 함께 조회합니다.
- 장소: 만남 장소와 HTTPS 지도 링크를 저장하고 상세 화면에서 지도를 엽니다.
- 방명록: 20개씩 더보기. 새로고침할 때도 펼친 범위를 유지합니다.
- 게스트 로그아웃: 관리자 세션과 분리된 게스트 세션을 종료합니다. 익명 로그인 특성상 재로그인 시 기존 계정 복구는 별도 기능이 필요합니다.

### 알림

`notifications` 테이블에 신청, 승인, 거절, 철회, 일정/장소 변경, 모임 취소 알림을 저장합니다. 본인 알림만 조회하며 Realtime 및 화면 복귀 시 갱신합니다. 우측 상단에서 최근 100개를 조회하고 읽음 처리하거나 해당 모임을 열 수 있습니다. **사이트를 닫은 상태의 OS 푸시·이메일·SMS는 구현되지 않았습니다.**

### 네 가지 언어와 게시글 자동 번역

우측 상단에서 영어(기본), 한국어, 일본어, 중국어를 선택합니다. 화면 문구는 로컬 번역으로 즉시 전환됩니다. 게시글·댓글·모임 이름/설명/장소·알림 모임명은 서버 번역을 사용합니다. 이용자 닉네임은 번역하지 않습니다. API가 미연결되거나 실패하면 원문과 연결 상태를 표시합니다.

Cloudflare Pages의 `/api/translate` 함수는 저장소의 `functions/api/translate.js`입니다. Pages 환경 변수에 다음을 설정한 뒤 프런트엔드와 함수를 함께 배포하세요:

- `GOOGLE_TRANSLATE_API_KEY`: Cloud Translation Basic v2 사용이 가능한 서버 전용 API 키
- `SUPABASE_URL`: 현재 Supabase 프로젝트 URL
- `SUPABASE_ANON_KEY`: 현재 프로젝트의 공개 키

Google API 키는 브라우저 설정 파일에 넣지 마세요. 요청은 Supabase 세션과 등록된 투숙객 프로필을 검증한 뒤 번역합니다. 언어 자동 감지와 번역은 [Google Cloud Translation v2](https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate)를 사용합니다. 공급자 호출은 연결 후 발생합니다.

### 검증

`npm test -- --run`은 한국 시간 경계, 지난 모임 변경 차단 화면, 모임 수정·신청 철회, 안전한 지도 링크, 방명록 더보기, 알림 읽음 처리, 4개 언어 전환, 번역 API 인증을 확인합니다. `npm run build`는 테스트 파일을 제외한 게스트/관리자 파일을 `dist/`에 복사합니다.

## Live Chat (실시간 채팅)

- **Global Chat**: 우측 하단 `Chat` 버튼 → 로그인한 모든 투숙객이 함께 대화. 상단에 현재 접속자 수(Realtime Presence) 표시, 채팅창이 닫혀 있을 때 새 메시지 수 배지.
- **Group chat**: 모임 상세에서 `Open group chat` → 주최자 + 승인된 참가자만 읽기/쓰기 (RLS `can_access_chat_room`).
- 저장: `chat_messages` 테이블 (메시지 500자, 10초에 5개 제한 trigger). 본인 메시지 삭제 가능, Admin은 `admin.html` → **Chat** 탭에서 모든 메시지 삭제 가능.
- 번역: 메시지는 `data-user-content`라서 사이트 언어 선택 시 기존 번역 API로 자동 번역됩니다.
- 적용: Supabase SQL Editor에서 `supabase/migrations/20261009_live_chat.sql` 실행.
