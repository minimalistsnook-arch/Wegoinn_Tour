-- 객실 번호 000 = 스태프 로그인
-- 일반 손님과 똑같이 체크인·체크아웃 날짜, 객실 000, 닉네임, 사진으로 로그인합니다.
-- 운영진(운영자) 권한은 없는 일반 계정입니다.
-- 이 파일 내용을 전부 복사해서 Supabase SQL Editor에 붙여 넣고 Run 을 누르세요. 여러 번 실행해도 괜찮아요.

insert into public.hostel_rooms (room_number, room_type, capacity) values ('000', 'Staff', 100)
on conflict (room_number) do update set room_type = excluded.room_type, capacity = excluded.capacity;

-- 확인: 아래 결과에 000 한 줄이 나오면 성공
select room_number, room_type, capacity from public.hostel_rooms where room_number = '000';
