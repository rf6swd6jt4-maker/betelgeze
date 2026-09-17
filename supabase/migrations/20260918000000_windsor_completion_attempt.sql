-- Fence automatic completion against an authorization link replaced while the
-- provider request was in flight. Keep the previous RPC for deployed clients.
create or replace function public.complete_windsor_meta_ads_onboarding(
    p_token text,
    p_block_id uuid,
    p_authorization_hash text,
    p_account_id text,
    p_account_name text,
    p_datasource text,
    p_integration_fingerprint text
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
    v_block public.relationship_onboarding_session_blocks%rowtype;
    v_connection public.relationship_windsor_meta_ads_connections%rowtype;
begin
    v_block := public.windsor_meta_ads_onboarding_block(p_token, p_block_id);
    select * into v_connection from public.relationship_windsor_meta_ads_connections
    where workspace_id = v_block.workspace_id and onboarding_session_id = v_block.session_id
      and source_session_block_id = v_block.id for update;
    if v_connection.id is null or v_connection.status <> 'pending'
       or p_authorization_hash is null
       or v_connection.authorization_hash is distinct from p_authorization_hash then
        raise exception using errcode = 'P0001', message = 'A newer connection attempt replaced this one. Return from the latest Windsor window.';
    end if;
    return public.finish_windsor_meta_ads_onboarding(
        p_token, p_block_id, p_account_id, p_account_name, p_datasource, p_integration_fingerprint
    );
end;
$$;
revoke all on function public.complete_windsor_meta_ads_onboarding(text, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_windsor_meta_ads_onboarding(text, uuid, text, text, text, text, text) to service_role;
