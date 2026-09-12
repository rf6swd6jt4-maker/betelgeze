-- TEST-only, relationship-scoped GHL reporting. Credentials never enter public tables.
create schema if not exists client_portal_secure;
revoke all on schema client_portal_secure from public, anon, authenticated, service_role;

create table client_portal_secure.ghl_connections (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid primary key references public.relationships(id) on delete cascade,
    vault_secret_id uuid,
    location_id text,
    location_name text,
    metrics jsonb,
    refreshed_at timestamptz,
    last_error text,
    operation_id uuid,
    lease_until timestamptz,
    attempted_at timestamptz,
    check (metrics is null or (jsonb_typeof(metrics) = 'object' and octet_length(metrics::text) < 2048))
);
alter table client_portal_secure.ghl_connections enable row level security;
revoke all on client_portal_secure.ghl_connections from public, anon, authenticated, service_role;

create function public.client_portal_ghl(
    p_session_token text, p_workspace_id uuid, p_action text default 'read',
    p_operation_id uuid default null, p_location_id text default null,
    p_private_token text default null, p_location_name text default null,
    p_metrics jsonb default null, p_error text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    target_relationship uuid;
    connection client_portal_secure.ghl_connections%rowtype;
    secret_value text;
    metric_key text;
begin
    if auth.role() is distinct from 'service_role' then return jsonb_build_object('failure', 'access'); end if;
    select r.id into target_relationship
    from public.client_portal_sessions s
    join public.relationships r on r.id = s.relationship_id and r.workspace_id = s.workspace_id
    join public.workspaces w on w.id = s.workspace_id
    where s.session_token = p_session_token and s.workspace_id = p_workspace_id
      and s.status = 'active' and s.token_revoked_at is null and w.status = 'active'
      and r.status <> 'archived' and r.source_metadata->'is_test' = 'true'::jsonb;
    if target_relationship is null then return jsonb_build_object('failure', 'access'); end if;
    if p_action not in ('read', 'begin_connect', 'begin_refresh', 'finish', 'fail', 'disconnect') then
        return jsonb_build_object('failure', 'invalid_action');
    end if;

    if p_action <> 'read' then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-ghl:' || target_relationship::text, 0));
    end if;
    select * into connection from client_portal_secure.ghl_connections
    where relationship_id = target_relationship and workspace_id = p_workspace_id;

    if p_action in ('begin_connect', 'begin_refresh') then
        if p_operation_id is null then return jsonb_build_object('failure', 'changed'); end if;
        if connection.lease_until > now() then return jsonb_build_object('failure', 'busy'); end if;
        if connection.attempted_at > now() - interval '60 seconds' then return jsonb_build_object('failure', 'cooldown'); end if;
        if p_action = 'begin_refresh' and connection.vault_secret_id is null then return jsonb_build_object('failure', 'credentials'); end if;
        insert into client_portal_secure.ghl_connections (workspace_id, relationship_id, operation_id, lease_until, attempted_at)
        values (p_workspace_id, target_relationship, p_operation_id, now() + interval '60 seconds', now())
        on conflict (relationship_id) do update set operation_id = excluded.operation_id, lease_until = excluded.lease_until, attempted_at = excluded.attempted_at
        returning * into connection;
        if p_action = 'begin_refresh' then
            select decrypted_secret into secret_value from vault.decrypted_secrets where id = connection.vault_secret_id;
            return jsonb_build_object('locationId', connection.location_id, 'privateToken', secret_value);
        end if;
        return jsonb_build_object('accepted', true);
    end if;

    if p_action = 'finish' then
        if connection.operation_id is distinct from p_operation_id or p_operation_id is null or connection.lease_until <= now() then
            return jsonb_build_object('failure', 'changed');
        end if;
        if p_metrics is null or jsonb_typeof(p_metrics) <> 'object' or octet_length(p_metrics::text) >= 2048
          or p_location_id is null or p_location_id !~ '^[a-zA-Z0-9_-]{10,80}$'
          or p_location_name is null or length(p_location_name) not between 1 and 200 then
            return jsonb_build_object('failure', 'response');
        end if;
        foreach metric_key in array array['contacts','opportunities','open','won','lost'] loop
            if not (p_metrics ? metric_key) or jsonb_typeof(p_metrics->metric_key) <> 'number'
              or (p_metrics->>metric_key) !~ '^[0-9]+$' then return jsonb_build_object('failure', 'response'); end if;
        end loop;
        if p_private_token is not null then
            if length(p_private_token) not between 20 and 4096 then return jsonb_build_object('failure', 'credentials'); end if;
            if connection.vault_secret_id is null then
                select vault.create_secret(p_private_token, 'portal-ghl-' || target_relationship::text) into connection.vault_secret_id;
            else
                perform vault.update_secret(connection.vault_secret_id, p_private_token);
            end if;
        elsif connection.vault_secret_id is null or connection.location_id is distinct from p_location_id then
            return jsonb_build_object('failure', 'changed');
        end if;
        update client_portal_secure.ghl_connections set vault_secret_id = connection.vault_secret_id,
            location_id = p_location_id, location_name = p_location_name,
            metrics = jsonb_build_object('contacts',p_metrics->'contacts','opportunities',p_metrics->'opportunities','open',p_metrics->'open','won',p_metrics->'won','lost',p_metrics->'lost'),
            refreshed_at = now(), last_error = null, operation_id = null, lease_until = null
        where relationship_id = target_relationship returning * into connection;
    elsif p_action = 'fail' then
        if connection.operation_id is distinct from p_operation_id or p_operation_id is null then return jsonb_build_object('failure', 'changed'); end if;
        update client_portal_secure.ghl_connections set operation_id = null, lease_until = null,
            last_error = case when p_error in ('credentials','permissions','location','rate_limit','response','unavailable') then p_error else 'unavailable' end
        where relationship_id = target_relationship returning * into connection;
    elsif p_action = 'disconnect' then
        -- Only this relationship's managed secret is removed; late refreshes cannot restore it.
        delete from vault.secrets where id = connection.vault_secret_id;
        update client_portal_secure.ghl_connections set vault_secret_id = null, location_id = null,
            location_name = null, metrics = null, refreshed_at = null, last_error = null,
            operation_id = null, lease_until = null
        where relationship_id = target_relationship returning * into connection;
    end if;
    return jsonb_build_object('connected', connection.vault_secret_id is not null,
        'locationId', connection.location_id, 'locationName', connection.location_name,
        'metrics', connection.metrics, 'refreshedAt', connection.refreshed_at,
        'error', connection.last_error, 'busy', coalesce(connection.lease_until > now(), false));
end;
$$;
revoke all on function public.client_portal_ghl(text,uuid,text,uuid,text,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.client_portal_ghl(text,uuid,text,uuid,text,text,text,jsonb,text) to service_role;

-- Cascading relationship/workspace removal also disposes of its encrypted token.
create function client_portal_secure.remove_ghl_secret() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    delete from vault.secrets where id = old.vault_secret_id;
    return old;
end;
$$;
revoke all on function client_portal_secure.remove_ghl_secret() from public, anon, authenticated, service_role;
create trigger remove_ghl_secret after delete on client_portal_secure.ghl_connections
for each row execute function client_portal_secure.remove_ghl_secret();
notify pgrst, 'reload schema';
