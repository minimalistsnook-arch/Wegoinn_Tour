-- 이용 안내 본문 표기 수정: WEGO INN → Wegoinn, 이메일 → wegoinnteam@gmail.com
-- 표기만 바꾸는 것이라 버전 번호는 그대로이고, 손님이 다시 동의할 필요가 없습니다.
-- 이 파일 내용을 전부 복사해서 Supabase SQL Editor에 붙여 넣고 Run 을 누르세요. 여러 번 실행해도 괜찮아요.

update public.community_terms_versions
set body = replace(replace(replace(body, 'WEGO INN HOSTEL', 'Wegoinn Hostel'), 'WEGO INN', 'Wegoinn'), 'Wegoinnteam@gmail.com', 'wegoinnteam@gmail.com')
where body like '%WEGO INN%' or body like '%Wegoinnteam@gmail.com%';

-- 확인: 아래 결과의 has_old_name 이 모두 false 이면 성공
select version, body like '%WEGO INN%' or body like '%Wegoinnteam@%' as has_old_name from public.community_terms_versions order by version;
