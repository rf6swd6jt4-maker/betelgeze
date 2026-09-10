-- Read-only catalog checks. No account/client content or secrets are selected.
select p.oid::regprocedure::text as function_signature, p.prosecdef as security_definer,
       p.prorettype::regtype::text as return_type,
       md5(p.prosrc) as definition_hash,
       p.prosrc ~* '(net[.]http|http_post|http_get|dblink|cron[.]schedule)' as external_call_text
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname in ('workspace_user_can_manage_appointment_setting','appointment_setting_service_is_available','workspace_user_can_access_relationship','workspace_role_for_user','submit_appointment_setting_appointment','validate_appointment_setting_appointment_configuration','save_appointment_setting_draft_command','submit_appointment_setting_appointment_queued','save_relationship_background_command'))
   or (n.nspname='communications_secure' and p.proname in ('encrypt_client_message','get_or_create_content_key'))
order by 1;
select n.nspname as schema_name,c.relname as table_name,t.tgname,
       pg_get_triggerdef(t.oid) as trigger_definition,p.oid::regprocedure::text as trigger_function,
       pn.nspname as function_schema,
       p.prosrc ~* '(net[.]http|http_post|http_get|dblink|cron[.]schedule)' as external_call_text
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
where not t.tgisinternal and ((n.nspname='auth' and c.relname='users') or (n.nspname='vault' and c.relname='secrets')
 or (n.nspname='public' and c.relname in ('workspaces','workspace_memberships','user_profiles','workspace_teams','workspace_team_members','workspace_native_conversations','workspace_native_conversation_participants','relationships','relationship_services','onboarding_services','onboarding_service_revisions','appointment_setting_appointments','client_messages')))
order by 1,2,3;
select evtname,evtevent,evtenabled,evtfoid::regprocedure::text as function_signature from pg_event_trigger order by 1;
select extname,extversion from pg_extension where extname in ('pgcrypto','supabase_vault','pg_net','http','pg_cron') order by 1;
