-- Read-only catalog inventory for an explicitly selected database.
-- This script does not install migrations or inspect customer rows.
begin read only;
set local statement_timeout = '10s';
select jsonb_build_object(
  'version',current_setting('server_version'),
  'migration_registry',to_regclass('supabase_migrations.schema_migrations'),
  'roles',(select jsonb_agg(jsonb_build_object('role',rolname,'bypass_rls',rolbypassrls,'superuser',rolsuper)) from pg_roles where rolname in ('anon','authenticated','service_role')),
  'tables',(select jsonb_agg(jsonb_build_object(
    'name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
    'estimated_rows',c.reltuples,'table_bytes',pg_relation_size(c.oid),'grants',c.relacl,
    'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
    'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
    'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid=c.oid),
    'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))) from pg_policy p where p.polrelid=c.oid)
  ) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('notes','note_relationships','note_assets','note_work_items','note_notes','assets','asset_relationships','asset_work_items','record_attachment_commands')),
  'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body_md5',md5(p.prosrc),'security_definer',p.prosecdef,'owner',pg_get_userbyid(p.proowner),'config',p.proconfig,'grants',p.proacl,'definition',pg_get_functiondef(p.oid)) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('enforce_note_link_workspace','check_note_attachment_workspace','check_note_note_workspace','validate_private_work_item_links','assert_record_attachment_admin','create_attachment_record','attach_existing_record','save_note_text','edit_note_relationships','is_workspace_member','current_session_is_aal2')),
  'default_privileges',(select jsonb_agg(jsonb_build_object('role',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'type',d.defaclobjtype,'grants',d.defaclacl)) from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public' or d.defaclnamespace=0)
) as records_schema_inventory;
commit;
