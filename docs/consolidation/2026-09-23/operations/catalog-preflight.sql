-- Diagnostic metadata only. Review the target project before running.
-- No row bodies, cron commands, URLs, credentials, or function source are returned.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '5s';
set local lock_timeout = '500ms';
set local idle_in_transaction_session_timeout = '30s';

select now() as observed_at, current_setting('transaction_read_only') as read_only,
       to_regclass('supabase_migrations.schema_migrations') is not null as migration_registry_present,
       to_regclass('public.leadgen_sunbiz_owner_index') is not null as legacy_sunbiz_index_present;

with expected(name) as (values
 ('leadgen_polls'), ('leadgen_poll_tasks'), ('leadgen_investigation_tasks'),
 ('leadgen_poll_stage_runs'), ('leadgen_company_stage_status'),
 ('record_attachment_commands'), ('notes'), ('note_assets'), ('note_relationships'))
select e.name, c.oid is not null as present, c.relrowsecurity as rls_enabled,
       c.reltuples::bigint as estimated_rows
from expected e left join pg_class c on c.oid=to_regclass('public.'||e.name)
order by e.name;

select c.table_name, c.column_name, c.data_type, c.is_nullable
from information_schema.columns c
where c.table_schema='public' and c.table_name in
 ('leadgen_polls','leadgen_poll_tasks','leadgen_investigation_tasks',
  'leadgen_poll_stage_runs','leadgen_company_stage_status','record_attachment_commands')
order by c.table_name,c.ordinal_position;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       md5(pg_get_functiondef(p.oid)) as definition_md5,
       p.prosecdef as security_definer,
       has_function_privilege('anon',p.oid,'execute') as anon_execute,
       has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
       has_function_privilege('service_role',p.oid,'execute') as service_role_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('enforce_note_link_workspace','assert_record_attachment_admin','attach_existing_record',
  'save_note_text','edit_note_relationships','create_attachment_record')
order by p.proname,arguments;

select c.relname as table_name,t.tgname,t.tgenabled,
       p.proname as function_name, md5(pg_get_triggerdef(t.oid)) as definition_md5
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('note_assets','note_relationships') and not t.tgisinternal
order by c.relname,t.tgname;

select schemaname,tablename,indexname,indexdef
from pg_indexes where schemaname='public' and tablename in
 ('leadgen_polls','leadgen_poll_tasks','leadgen_investigation_tasks',
  'leadgen_poll_stage_runs','leadgen_company_stage_status','record_attachment_commands')
order by tablename,indexname;

-- The receipt table contains private request payloads. Never SELECT * to diagnose it.
select role_name,
       has_table_privilege(role_name,to_regclass('public.record_attachment_commands'),'SELECT') as can_select,
       has_table_privilege(role_name,to_regclass('public.record_attachment_commands'),'INSERT') as can_insert,
       has_table_privilege(role_name,to_regclass('public.record_attachment_commands'),'UPDATE') as can_update,
       has_table_privilege(role_name,to_regclass('public.record_attachment_commands'),'DELETE') as can_delete
from (values ('anon'),('authenticated'),('service_role')) as roles(role_name);
rollback;
