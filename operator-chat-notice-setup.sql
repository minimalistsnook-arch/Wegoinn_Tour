-- 운영자가 채팅에 쓴 메시지를 모든 손님에게 빨간 굵은 글씨 + 공지 확성기로 보여주기
-- 이 파일 내용을 전부 복사해서 Supabase SQL Editor에 붙여 넣고 Run 을 누르세요.
-- 여러 번 실행해도 괜찮아요.
-- (실행 전에는 채팅 메시지를 불러올 수 없으니, 새 코드를 배포하기 전에 먼저 실행하세요.)

grant select (role) on public.profiles to authenticated;

notify pgrst, 'reload schema';
