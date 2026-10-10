-- Read-only: execute in the same project used by js/config.js.
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       pg_get_function_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result,
       p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
 ('create_community_v2', 'create_community', 'register_guest', 'can_access_chat_room')
order by p.proname, identity_arguments;

select table_name, column_name, data_type
from information_schema.columns where table_schema = 'public'
and table_name in ('communities', 'community_reservations', 'chat_messages')
order by table_name, ordinal_position;

select event_object_table, trigger_name, action_statement
from information_schema.triggers where event_object_schema = 'public'
and event_object_table in ('communities', 'community_reservations', 'chat_messages');
