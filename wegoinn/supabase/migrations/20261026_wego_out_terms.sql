-- Brand rename in the community terms: Wegoinn Hostel / 위고인(호스텔) → Wego Out.
-- A wording fix only, so the version (and every guest's consent to it) stays the same.
update public.community_terms_versions
set body = replace(replace(replace(replace(body, 'Wegoinn Hostel', 'Wego Out'), '위고인호스텔', 'Wego Out'), '위고인', 'Wego Out'), 'Wegoinn Community', 'Wego Out Community')
where body like '%Wegoinn Hostel%' or body like '%위고인%' or body like '%Wegoinn Community%';
