begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.workspace_integrations
    drop constraint if exists workspace_integrations_provider_check;
alter table public.workspace_integrations
    add constraint workspace_integrations_provider_check
    check (provider in ('stripe', 'meta_whatsapp', 'meta_ads', 'windsor', 'google_ads', 'ghl', 'twilio_sms', 'clickup'));

-- The verified provider identity must be promoted with the candidate. Without
-- company_id here, a first-time GHL connection changes mode to connected while
-- connected_account_id is still null, violating workspace_integrations' core
-- connection constraint after the provider has already verified successfully.
create or replace function public.activate_workspace_integration_candidate(
    p_workspace_id uuid,
    p_provider text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.workspace_integrations
    set previous_mode = mode,
        previous_config_encrypted = config_encrypted,
        previous_config_hint = config_hint,
        previous_auth_method = auth_method,
        mode = 'connected',
        enabled = true,
        config_encrypted = candidate_config_encrypted,
        config_hint = candidate_config_hint,
        auth_method = candidate_auth_method,
        connection_status = 'connected',
        capabilities = coalesce(candidate_config_hint -> 'capabilities', '{}'::jsonb),
        connected_account_id = coalesce(
            candidate_config_hint ->> 'account_id',
            candidate_config_hint ->> 'waba_id',
            candidate_config_hint ->> 'business_id',
            candidate_config_hint ->> 'company_id',
            connected_account_id
        ),
        configured_at = candidate_configured_at,
        configured_by = candidate_configured_by,
        last_verified_at = now(),
        last_error = null,
        candidate_config_encrypted = null,
        candidate_config_hint = '{}'::jsonb,
        candidate_auth_method = null,
        candidate_configured_at = null,
        candidate_configured_by = null
    where workspace_id = p_workspace_id
      and provider = p_provider
      and candidate_config_encrypted is not null;

    if not found then
        raise exception 'No verified connection candidate exists.';
    end if;
end;
$$;

create or replace function public.restore_workspace_integration_previous(
    p_workspace_id uuid,
    p_provider text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.workspace_integrations
    set mode = previous_mode,
        enabled = previous_mode in ('platform_legacy', 'connected'),
        config_encrypted = previous_config_encrypted,
        config_hint = coalesce(previous_config_hint, '{}'::jsonb),
        auth_method = previous_auth_method,
        connection_status = case when previous_mode in ('platform_legacy', 'connected') then 'connected' else 'not_connected' end,
        capabilities = coalesce(previous_config_hint -> 'capabilities', '{}'::jsonb),
        connected_account_id = coalesce(
            previous_config_hint ->> 'account_id',
            previous_config_hint ->> 'waba_id',
            previous_config_hint ->> 'business_id',
            previous_config_hint ->> 'company_id'
        ),
        last_verified_at = nullif(previous_config_hint ->> 'verified_at', '')::timestamptz,
        last_error = null,
        previous_mode = null,
        previous_config_encrypted = null,
        previous_config_hint = null,
        previous_auth_method = null
    where workspace_id = p_workspace_id
      and provider = p_provider
      and previous_mode is not null;

    if not found then
        raise exception 'No previous connection is available.';
    end if;
end;
$$;

revoke all on function public.activate_workspace_integration_candidate(uuid, text) from public;
revoke all on function public.restore_workspace_integration_previous(uuid, text) from public;

commit;
