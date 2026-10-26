-- Brand spelling in the community terms: WEGO INN → Wegoinn, lower-case team email.
-- A wording fix only, so the version (and every guest's consent to it) stays the same.
update public.community_terms_versions
set body = replace(replace(replace(body, 'WEGO INN HOSTEL', 'Wegoinn Hostel'), 'WEGO INN', 'Wegoinn'), 'Wegoinnteam@gmail.com', 'wegoinnteam@gmail.com')
where body like '%WEGO INN%' or body like '%Wegoinnteam@gmail.com%';
