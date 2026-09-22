begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Existing relationship credentials remain in place. These columns add the
-- internal ownership/setup state without rotating or deleting a Vault secret.
alter table client_portal_secure.ghl_connections
    add column if not exists account_type text not null default 'client_account'
        check (account_type in ('client_account', 'agency_subaccount')),
    add column if not exists ready_at timestamptz,
    add column if not exists connected_by uuid references auth.users(id) on delete set null,
    add column if not exists updated_at timestamptz not null default now();

update client_portal_secure.ghl_connections
set ready_at = coalesce(ready_at, refreshed_at), updated_at = coalesce(refreshed_at, attempted_at, now())
where vault_secret_id is not null and ready_at is null;

create table if not exists public.appointment_setting_setup_assignees (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    assigned_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    primary key (workspace_id, relationship_id, user_id),
    foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade
);
create index if not exists appointment_setting_setup_assignees_user_idx
on public.appointment_setting_setup_assignees(workspace_id, user_id, relationship_id);
alter table public.appointment_setting_setup_assignees enable row level security;
revoke all on public.appointment_setting_setup_assignees from public, anon, authenticated;
grant select, insert, update, delete on public.appointment_setting_setup_assignees to service_role;

create or replace function public.assign_appointment_setting_setup_owners()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_relationship uuid; v_revision uuid; v_disposition text;
begin
    v_workspace := nullif(to_jsonb(new)->>'workspace_id','')::uuid;
    v_relationship := nullif(to_jsonb(new)->>'relationship_id','')::uuid;
    v_revision := nullif(to_jsonb(new)->>'service_revision_id','')::uuid;
    v_disposition := coalesce(to_jsonb(new)->>'disposition','active');
    if v_revision is null or v_disposition = 'cancelled' or not exists (
        select 1 from public.onboarding_service_revisions revision
        where revision.workspace_id = v_workspace and revision.id = v_revision
          and coalesce(revision.definition->>'templateId', revision.definition->>'template_id') = 'appointment-setting'
    ) then return new; end if;
    insert into public.appointment_setting_setup_assignees(workspace_id, relationship_id, user_id, assigned_by)
    select v_workspace, v_relationship, membership.user_id, membership.user_id
    from public.workspace_memberships membership
    where membership.workspace_id = v_workspace and membership.role = 'owner'
    on conflict do nothing;
    return new;
end;
$$;
revoke all on function public.assign_appointment_setting_setup_owners() from public, anon, authenticated;

drop trigger if exists assign_appointment_setting_setup_owners_instance on public.relationship_service_instances;
create trigger assign_appointment_setting_setup_owners_instance
after insert or update of service_revision_id, disposition on public.relationship_service_instances
for each row execute function public.assign_appointment_setting_setup_owners();
drop trigger if exists assign_appointment_setting_setup_owners_legacy on public.relationship_services;
create trigger assign_appointment_setting_setup_owners_legacy
after insert or update of service_revision_id on public.relationship_services
for each row execute function public.assign_appointment_setting_setup_owners();

insert into public.appointment_setting_setup_assignees(workspace_id, relationship_id, user_id, assigned_by)
select eligible.workspace_id, eligible.relationship_id, membership.user_id, membership.user_id
from (
    select distinct instance.workspace_id, instance.relationship_id
    from public.relationship_service_instances instance
    join public.onboarding_service_revisions revision on revision.workspace_id = instance.workspace_id and revision.id = instance.service_revision_id
    where instance.import_id is null and instance.disposition <> 'cancelled'
      and coalesce(revision.definition->>'templateId', revision.definition->>'template_id') = 'appointment-setting'
    union
    select distinct service.workspace_id, service.relationship_id
    from public.relationship_services service
    join public.onboarding_service_revisions revision on revision.workspace_id = service.workspace_id and revision.id = service.service_revision_id
    where coalesce(revision.definition->>'templateId', revision.definition->>'template_id') = 'appointment-setting'
) eligible
join public.workspace_memberships membership on membership.workspace_id = eligible.workspace_id and membership.role = 'owner'
on conflict do nothing;

create or replace function public.seed_owner_client_connection_assignments()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.role <> 'owner' then return new; end if;
    insert into public.appointment_setting_setup_assignees(workspace_id, relationship_id, user_id, assigned_by)
    select new.workspace_id, eligible.relationship_id, new.user_id, new.user_id
    from (
        select instance.relationship_id
        from public.relationship_service_instances instance
        join public.onboarding_service_revisions revision on revision.workspace_id=instance.workspace_id and revision.id=instance.service_revision_id
        where instance.workspace_id=new.workspace_id and instance.import_id is null and instance.disposition <> 'cancelled'
          and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'
        union
        select service.relationship_id
        from public.relationship_services service
        join public.onboarding_service_revisions revision on revision.workspace_id=service.workspace_id and revision.id=service.service_revision_id
        where service.workspace_id=new.workspace_id
          and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'
    ) eligible on conflict do nothing;
    return new;
end;
$$;
revoke all on function public.seed_owner_client_connection_assignments() from public, anon, authenticated;
drop trigger if exists seed_owner_client_connection_assignments on public.workspace_memberships;
create trigger seed_owner_client_connection_assignments after insert or update of role on public.workspace_memberships
for each row execute function public.seed_owner_client_connection_assignments();

-- Server-only management surface used by Client Connections. It has no
-- disconnect action; replacement credentials become active only after a full
-- provider verification succeeds.
create or replace function public.manage_client_ghl_connection(
    p_workspace_id uuid, p_user_id uuid, p_action text default 'list',
    p_relationship_id uuid default null, p_operation_id uuid default null,
    p_account_type text default null, p_location_id text default null,
    p_private_token text default null, p_location_name text default null,
    p_metrics jsonb default null, p_error text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_role text;
    connection client_portal_secure.ghl_connections%rowtype;
    secret_value text;
    metric_key text;
    permitted boolean;
begin
    if auth.role() is distinct from 'service_role' then return jsonb_build_object('failure','access'); end if;
    select membership.role into v_role from public.workspace_memberships membership
    join public.workspaces workspace on workspace.id=membership.workspace_id and workspace.status='active'
    where membership.workspace_id=p_workspace_id and membership.user_id=p_user_id;
    if v_role is null then return jsonb_build_object('failure','access'); end if;

    if p_action = 'list' then
        return coalesce((
            with eligible as (
                select instance.relationship_id from public.relationship_service_instances instance
                join public.onboarding_service_revisions revision on revision.workspace_id=instance.workspace_id and revision.id=instance.service_revision_id
                where instance.workspace_id=p_workspace_id and instance.import_id is null and instance.disposition <> 'cancelled'
                  and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'
                union
                select service.relationship_id from public.relationship_services service
                join public.onboarding_service_revisions revision on revision.workspace_id=service.workspace_id and revision.id=service.service_revision_id
                where service.workspace_id=p_workspace_id
                  and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'
            )
            select jsonb_agg(jsonb_build_object(
                'relationshipId', relationship.id,
                'clientName', relationship.primary_person_name,
                'businessName', relationship.business_name,
                'accountType', coalesce(connection.account_type,'client_account'),
                'connected', connection.vault_secret_id is not null,
                'locationId', connection.location_id,
                'locationName', connection.location_name,
                'refreshedAt', connection.refreshed_at,
                'readyAt', connection.ready_at,
                'error', connection.last_error,
                'busy', coalesce(connection.lease_until > now(),false)
            ) order by coalesce(relationship.business_name,relationship.primary_person_name),relationship.id)
            from eligible
            join public.relationships relationship on relationship.workspace_id=p_workspace_id and relationship.id=eligible.relationship_id and relationship.status <> 'archived'
            left join client_portal_secure.ghl_connections connection on connection.workspace_id=p_workspace_id and connection.relationship_id=relationship.id
            where v_role in ('owner','admin') or exists (
                select 1 from public.appointment_setting_setup_assignees assignment
                where assignment.workspace_id=p_workspace_id and assignment.relationship_id=relationship.id and assignment.user_id=p_user_id
            )
        ), '[]'::jsonb);
    end if;

    if p_relationship_id is null or p_action not in ('begin_connect','begin_refresh','finish','fail') then return jsonb_build_object('failure','invalid_action'); end if;
    select v_role in ('owner','admin') or exists (
        select 1 from public.appointment_setting_setup_assignees assignment
        where assignment.workspace_id=p_workspace_id and assignment.relationship_id=p_relationship_id and assignment.user_id=p_user_id
    ) into permitted;
    if not permitted then return jsonb_build_object('failure','access'); end if;
    if not exists (
        select 1 from (
            select instance.relationship_id from public.relationship_service_instances instance
            join public.onboarding_service_revisions revision on revision.workspace_id=instance.workspace_id and revision.id=instance.service_revision_id
            where instance.workspace_id=p_workspace_id and instance.relationship_id=p_relationship_id and instance.import_id is null and instance.disposition <> 'cancelled'
              and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'
            union all
            select service.relationship_id from public.relationship_services service
            join public.onboarding_service_revisions revision on revision.workspace_id=service.workspace_id and revision.id=service.service_revision_id
            where service.workspace_id=p_workspace_id and service.relationship_id=p_relationship_id
              and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'
        ) service_access
    ) then return jsonb_build_object('failure','access'); end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-ghl:'||p_relationship_id::text,0));
    select * into connection from client_portal_secure.ghl_connections
    where workspace_id=p_workspace_id and relationship_id=p_relationship_id;

    if p_action in ('begin_connect','begin_refresh') then
        if p_operation_id is null then return jsonb_build_object('failure','changed'); end if;
        if connection.lease_until > now() then return jsonb_build_object('failure','busy'); end if;
        if connection.attempted_at > now()-interval '15 seconds' then return jsonb_build_object('failure','cooldown'); end if;
        if p_action='begin_refresh' and connection.vault_secret_id is null then return jsonb_build_object('failure','credentials'); end if;
        insert into client_portal_secure.ghl_connections(workspace_id,relationship_id,operation_id,lease_until,attempted_at,updated_at)
        values(p_workspace_id,p_relationship_id,p_operation_id,now()+interval '60 seconds',now(),now())
        on conflict(relationship_id) do update set operation_id=excluded.operation_id,lease_until=excluded.lease_until,attempted_at=excluded.attempted_at,updated_at=now()
        returning * into connection;
        if p_action='begin_refresh' then
            select decrypted_secret into secret_value from vault.decrypted_secrets where id=connection.vault_secret_id;
            return jsonb_build_object('locationId',connection.location_id,'privateToken',secret_value,'accountType',connection.account_type);
        end if;
        return jsonb_build_object('accepted',true);
    end if;

    if p_action='finish' then
        if connection.operation_id is distinct from p_operation_id or p_operation_id is null or connection.lease_until <= now() then return jsonb_build_object('failure','changed'); end if;
        if p_account_type not in ('client_account','agency_subaccount') or p_metrics is null or jsonb_typeof(p_metrics)<>'object' or octet_length(p_metrics::text)>=2048
          or p_location_id is null or p_location_id !~ '^[a-zA-Z0-9_-]{10,80}$' or p_location_name is null or length(p_location_name) not between 1 and 200 then
            return jsonb_build_object('failure','response');
        end if;
        foreach metric_key in array array['contacts','opportunities','open','won','lost'] loop
            if not(p_metrics ? metric_key) or jsonb_typeof(p_metrics->metric_key)<>'number' or (p_metrics->>metric_key)!~'^[0-9]+$' then return jsonb_build_object('failure','response'); end if;
        end loop;
        if exists(select 1 from client_portal_secure.ghl_connections other where other.workspace_id=p_workspace_id and other.relationship_id<>p_relationship_id and other.location_id=p_location_id and other.vault_secret_id is not null) then return jsonb_build_object('failure','duplicate'); end if;
        if p_private_token is not null then
            if length(p_private_token) not between 20 and 4096 then return jsonb_build_object('failure','credentials'); end if;
            if connection.vault_secret_id is null then select vault.create_secret(p_private_token,'portal-ghl-'||p_relationship_id::text) into connection.vault_secret_id;
            else perform vault.update_secret(connection.vault_secret_id,p_private_token); end if;
        elsif connection.vault_secret_id is null or connection.location_id is distinct from p_location_id then return jsonb_build_object('failure','changed'); end if;
        update client_portal_secure.ghl_connections set vault_secret_id=connection.vault_secret_id,location_id=p_location_id,location_name=p_location_name,
            account_type=p_account_type,metrics=jsonb_build_object('contacts',p_metrics->'contacts','opportunities',p_metrics->'opportunities','open',p_metrics->'open','won',p_metrics->'won','lost',p_metrics->'lost'),
            refreshed_at=now(),ready_at=now(),connected_by=p_user_id,last_error=null,operation_id=null,lease_until=null,updated_at=now()
        where workspace_id=p_workspace_id and relationship_id=p_relationship_id returning * into connection;
    elsif p_action='fail' then
        if connection.operation_id is distinct from p_operation_id or p_operation_id is null then return jsonb_build_object('failure','changed'); end if;
        update client_portal_secure.ghl_connections set operation_id=null,lease_until=null,last_error=case when p_error in ('credentials','permissions','location','rate_limit','response','unavailable','agency') then p_error else 'unavailable' end,updated_at=now()
        where workspace_id=p_workspace_id and relationship_id=p_relationship_id returning * into connection;
    end if;
    return jsonb_build_object('connected',connection.vault_secret_id is not null,'locationId',connection.location_id,'locationName',connection.location_name,'accountType',connection.account_type,'refreshedAt',connection.refreshed_at,'readyAt',connection.ready_at,'error',connection.last_error);
end;
$$;
revoke all on function public.manage_client_ghl_connection(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.manage_client_ghl_connection(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text) to service_role;

-- New CRM setup block. Existing session snapshots are never rewritten.
alter table public.relationship_onboarding_session_blocks drop constraint if exists relationship_onboarding_session_blocks_kind_check;
alter table public.relationship_onboarding_session_blocks add constraint relationship_onboarding_session_blocks_kind_check
check(kind in ('header','estimate','form','video','button','checklist','calendar','connection','appointment_medium','appointment_fields','crm_setup'));
alter table public.onboarding_block_requirements drop constraint if exists onboarding_block_requirements_requirement_kind_check;
alter table public.onboarding_block_requirements add constraint onboarding_block_requirements_requirement_kind_check
check(requirement_kind in ('button_opened','video_finished','meta_ads_connected','google_ads_connected','calendar_scheduled','appointment_medium_configured','appointment_fields_configured','crm_setup_completed'));

create or replace function public.require_connection_onboarding_block() returns trigger language plpgsql security invoker set search_path=public as $$
begin
    if new.kind in ('connection','calendar','appointment_medium','appointment_fields','crm_setup') then new.required:=true; end if;
    return new;
end; $$;

do $$
declare v_definition text; v_updated text;
begin
    select pg_get_functiondef('public.validate_onboarding_module_definition(jsonb)'::regprocedure) into v_definition;
    v_updated := replace(v_definition, '''appointment_medium'', ''appointment_fields'')', '''appointment_medium'', ''appointment_fields'', ''crm_setup'')');
    if v_updated=v_definition then raise exception 'Expected onboarding block allow-list was not found'; end if;
    execute v_updated;
end $$;

create or replace function public.submit_onboarding_crm_setup_block(p_token text,p_session_block_id uuid,p_uses_ghl boolean,p_crm_name text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_block public.relationship_onboarding_session_blocks%rowtype; v_response jsonb;
begin
    if current_user<>'service_role' then raise exception using errcode='42501',message='Trusted onboarding runtime required'; end if;
    select block.* into v_block from public.relationship_onboarding_session_blocks block
    join public.relationship_onboarding_sessions session on session.id=block.session_id and session.workspace_id=block.workspace_id
    where block.id=p_session_block_id and session.session_token=p_token and session.status='active' for update of block;
    if v_block.id is null or v_block.kind<>'crm_setup' then raise exception using errcode='P0001',message='CRM setup block not found.'; end if;
    if exists(select 1 from public.work_items item where item.workspace_id=v_block.workspace_id and item.native_kind='onboarding_step' and item.metadata->>'session_step_id'=v_block.session_step_id::text and item.status='done') then raise exception using errcode='P0001',message='Submitted steps are locked.'; end if;
    if p_uses_ghl is null or (not p_uses_ghl and length(btrim(coalesce(p_crm_name,''))) not between 1 and 120) then raise exception using errcode='22023',message='Tell us whether you use HighLevel and, if not, which CRM you use.'; end if;
    v_response:=jsonb_build_object('usesGhl',p_uses_ghl,'crmName',case when p_uses_ghl then null else btrim(p_crm_name) end);
    insert into public.onboarding_block_requirements(workspace_id,session_id,session_step_id,session_block_id,requirement_kind,response,satisfied_at)
    values(v_block.workspace_id,v_block.session_id,v_block.session_step_id,v_block.id,'crm_setup_completed',v_response,now())
    on conflict(session_block_id) do update set requirement_kind=excluded.requirement_kind,response=excluded.response,satisfied_at=now();
    return jsonb_build_object('session_block_id',v_block.id,'satisfied',true,'response',v_response);
end; $$;
revoke all on function public.submit_onboarding_crm_setup_block(text,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.submit_onboarding_crm_setup_block(text,uuid,boolean,text) to service_role;

-- Publish successor module revisions for Appointment Setting. Frozen active
-- sessions continue to reference their prior revision and blocks.
create or replace function public.client_connections_crm_definition(p_definition jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare v_step jsonb; v_block jsonb; v_steps jsonb:='[]'::jsonb; v_blocks jsonb; v_added boolean;
begin
    if jsonb_typeof(p_definition->'steps')<>'array' then return p_definition; end if;
    for v_step in select value from jsonb_array_elements(p_definition->'steps') loop
        v_blocks:='[]'::jsonb; v_added:=false;
        for v_block in select value from jsonb_array_elements(coalesce(v_step->'blocks','[]'::jsonb)) loop
            if v_block->>'kind' in ('appointment_medium','appointment_fields') then
                if not v_added then
                    v_blocks:=v_blocks||jsonb_build_array(jsonb_build_object('id',v_block->>'id','name','CRM setup','kind','crm_setup','title','Do you already use HighLevel?','description','Tell us whether you have a HighLevel account. If not, tell us which CRM you currently use and we’ll prepare your appointment system.','crmLabel','Which CRM do you currently use?','video',null,'required',true,'layout',coalesce(v_block->'layout','{"width":"wide","alignment":"left","spacingBefore":"normal","spacingAfter":"normal"}'::jsonb)));
                    v_added:=true;
                end if;
            else v_blocks:=v_blocks||jsonb_build_array(v_block); end if;
        end loop;
        v_steps:=v_steps||jsonb_build_array(jsonb_set(v_step,'{blocks}',v_blocks,true));
    end loop;
    return jsonb_set(p_definition,'{steps}',v_steps,true);
end; $$;

do $$
declare row record; v_definition jsonb;
begin
    for row in
        with appointment_modules as (
            select distinct assignment.workspace_id,assignment.module_id
            from public.onboarding_service_revision_modules assignment
            join public.onboarding_service_revisions service_revision on service_revision.workspace_id=assignment.workspace_id and service_revision.id=assignment.service_revision_id
            where coalesce(service_revision.definition->>'templateId',service_revision.definition->>'template_id')='appointment-setting'
        ), latest as (
            select distinct on(revision.module_id) revision.* from public.onboarding_module_revisions revision
            join appointment_modules appointment on appointment.workspace_id=revision.workspace_id and appointment.module_id=revision.module_id
            where revision.status='published' order by revision.module_id,revision.revision_number desc
        ) select * from latest where definition::text like '%appointment_medium%' or definition::text like '%appointment_fields%'
    loop
        v_definition:=public.client_connections_crm_definition(row.definition);
        perform public.validate_onboarding_module_definition(v_definition);
        insert into public.onboarding_module_revisions(workspace_id,module_id,revision_number,status,definition,definition_hash,created_by,updated_by,published_by,published_at)
        values(row.workspace_id,row.module_id,row.revision_number+1,'published',v_definition,encode(extensions.digest(convert_to(v_definition::text,'UTF8'),'sha256'),'hex'),row.created_by,row.updated_by,row.published_by,now());
    end loop;
    update public.onboarding_module_revisions draft set definition=public.client_connections_crm_definition(draft.definition),definition_hash=md5(public.client_connections_crm_definition(draft.definition)::text),updated_at=now()
    where draft.status='draft' and (draft.definition::text like '%appointment_medium%' or draft.definition::text like '%appointment_fields%') and exists(
        select 1 from public.onboarding_service_revision_modules assignment
        join public.onboarding_service_revisions service_revision on service_revision.workspace_id=assignment.workspace_id and service_revision.id=assignment.service_revision_id
        where assignment.workspace_id=draft.workspace_id and assignment.module_id=draft.module_id and coalesce(service_revision.definition->>'templateId',service_revision.definition->>'template_id')='appointment-setting'
    );
end $$;
drop function public.client_connections_crm_definition(jsonb);

-- Keep the shell bootstrap in lockstep with the application authorization.
create or replace function public.workspace_shell_bootstrap(p_workspace_slug text,p_user_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
with shell_context as (
 select workspace.id workspace_id,workspace.name workspace_name,workspace.slug workspace_slug,workspace.logo_path,membership.role,profile.username,profile.avatar_path
 from public.workspaces workspace join public.workspace_memberships membership on membership.workspace_id=workspace.id and membership.user_id=p_user_id
 left join public.user_profiles profile on profile.user_id=p_user_id where workspace.slug=p_workspace_slug and workspace.status='active' limit 1
),allowed_services as (
 select distinct service_id from(
  select access.service_id from public.workspace_member_service_access access join shell_context context on context.workspace_id=access.workspace_id where access.user_id=p_user_id
  union all select allocation.service_id from public.relationship_services allocation join shell_context context on context.workspace_id=allocation.workspace_id where allocation.assignee_user_id=p_user_id and allocation.service_id is not null
 ) service_access
)
select jsonb_build_object('workspace_id',context.workspace_id,'workspace_name',context.workspace_name,'workspace_slug',context.workspace_slug,'logo_path',context.logo_path,'role',context.role,'username',coalesce(context.username,'account'),'avatar_path',context.avatar_path,
'allowed_service_ids',case when context.role in('owner','admin') then '[]'::jsonb else coalesce((select jsonb_agg(service_id order by service_id) from allowed_services),'[]'::jsonb) end,
'capabilities',case when context.role in('owner','admin') then to_jsonb(array['relationships.view','onboarding.manage','fulfilment.manage','appointment_setting.manage','client_connections.manage','communications.manage','library.manage','onboarding_builder.manage','leadgen.manage','admin.manage','settings.manage']::text[])
else coalesce((select jsonb_agg(capability order by display_order) from(
 select 'fulfilment.manage'::text capability,1 display_order union all select 'communications.manage',2
 union all select 'relationships.view',3 where public.workspace_user_has_capability(context.workspace_id,'relationships.view',p_user_id)
 union all select 'appointment_setting.manage',4 where public.workspace_user_has_capability(context.workspace_id,'appointment_setting.manage',p_user_id)
 union all select 'client_connections.manage',5 where exists(select 1 from public.appointment_setting_setup_assignees assignment where assignment.workspace_id=context.workspace_id and assignment.user_id=p_user_id)
) staff_capabilities),'[]'::jsonb) end,'service_access_schema_ready',true) from shell_context context
$$;
revoke all on function public.workspace_shell_bootstrap(text,uuid) from public,anon,authenticated;
grant execute on function public.workspace_shell_bootstrap(text,uuid) to service_role;

notify pgrst,'reload schema';
commit;
