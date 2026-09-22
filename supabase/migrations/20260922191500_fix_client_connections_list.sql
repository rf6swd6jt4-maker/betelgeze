-- Avoid the PL/pgSQL record/SQL alias collision that made the list action fail.
create or replace function public.manage_client_ghl_connection(
    p_workspace_id uuid, p_user_id uuid, p_action text default 'list',
    p_relationship_id uuid default null, p_operation_id uuid default null,
    p_account_type text default null, p_location_id text default null,
    p_private_token text default null, p_location_name text default null,
    p_metrics jsonb default null, p_error text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    v_role text;
    v_connection client_portal_secure.ghl_connections%rowtype;
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
                'accountType', coalesce(ghl_connection.account_type,'client_account'),
                'connected', ghl_connection.vault_secret_id is not null,
                'locationId', ghl_connection.location_id,
                'locationName', ghl_connection.location_name,
                'refreshedAt', ghl_connection.refreshed_at,
                'readyAt', ghl_connection.ready_at,
                'error', ghl_connection.last_error,
                'busy', coalesce(ghl_connection.lease_until > now(),false)
            ) order by coalesce(relationship.business_name,relationship.primary_person_name),relationship.id)
            from eligible
            join public.relationships relationship on relationship.workspace_id=p_workspace_id and relationship.id=eligible.relationship_id and relationship.status <> 'archived'
            left join client_portal_secure.ghl_connections ghl_connection on ghl_connection.workspace_id=p_workspace_id and ghl_connection.relationship_id=relationship.id
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
    select * into v_connection from client_portal_secure.ghl_connections
    where workspace_id=p_workspace_id and relationship_id=p_relationship_id;

    if p_action in ('begin_connect','begin_refresh') then
        if p_operation_id is null then return jsonb_build_object('failure','changed'); end if;
        if v_connection.lease_until > now() then return jsonb_build_object('failure','busy'); end if;
        if v_connection.attempted_at > now()-interval '15 seconds' then return jsonb_build_object('failure','cooldown'); end if;
        if p_action='begin_refresh' and v_connection.vault_secret_id is null then return jsonb_build_object('failure','credentials'); end if;
        insert into client_portal_secure.ghl_connections(workspace_id,relationship_id,operation_id,lease_until,attempted_at,updated_at)
        values(p_workspace_id,p_relationship_id,p_operation_id,now()+interval '60 seconds',now(),now())
        on conflict(relationship_id) do update set operation_id=excluded.operation_id,lease_until=excluded.lease_until,attempted_at=excluded.attempted_at,updated_at=now()
        returning * into v_connection;
        if p_action='begin_refresh' then
            select decrypted_secret into secret_value from vault.decrypted_secrets where id=v_connection.vault_secret_id;
            return jsonb_build_object('locationId',v_connection.location_id,'privateToken',secret_value,'accountType',v_connection.account_type);
        end if;
        return jsonb_build_object('accepted',true);
    end if;

    if p_action='finish' then
        if v_connection.operation_id is distinct from p_operation_id or p_operation_id is null or v_connection.lease_until <= now() then return jsonb_build_object('failure','changed'); end if;
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
            if v_connection.vault_secret_id is null then select vault.create_secret(p_private_token,'portal-ghl-'||p_relationship_id::text) into v_connection.vault_secret_id;
            else perform vault.update_secret(v_connection.vault_secret_id,p_private_token); end if;
        elsif v_connection.vault_secret_id is null or v_connection.location_id is distinct from p_location_id then return jsonb_build_object('failure','changed'); end if;
        update client_portal_secure.ghl_connections set vault_secret_id=v_connection.vault_secret_id,location_id=p_location_id,location_name=p_location_name,
            account_type=p_account_type,metrics=jsonb_build_object('contacts',p_metrics->'contacts','opportunities',p_metrics->'opportunities','open',p_metrics->'open','won',p_metrics->'won','lost',p_metrics->'lost'),
            refreshed_at=now(),ready_at=now(),connected_by=p_user_id,last_error=null,operation_id=null,lease_until=null,updated_at=now()
        where workspace_id=p_workspace_id and relationship_id=p_relationship_id returning * into v_connection;
    elsif p_action='fail' then
        if v_connection.operation_id is distinct from p_operation_id or p_operation_id is null then return jsonb_build_object('failure','changed'); end if;
        update client_portal_secure.ghl_connections set operation_id=null,lease_until=null,last_error=case when p_error in ('credentials','permissions','location','rate_limit','response','unavailable','agency') then p_error else 'unavailable' end,updated_at=now()
        where workspace_id=p_workspace_id and relationship_id=p_relationship_id returning * into v_connection;
    end if;
    return jsonb_build_object('connected',v_connection.vault_secret_id is not null,'locationId',v_connection.location_id,'locationName',v_connection.location_name,'accountType',v_connection.account_type,'refreshedAt',v_connection.refreshed_at,'readyAt',v_connection.ready_at,'error',v_connection.last_error);
end;
$$;

revoke all on function public.manage_client_ghl_connection(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.manage_client_ghl_connection(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text) to service_role;
