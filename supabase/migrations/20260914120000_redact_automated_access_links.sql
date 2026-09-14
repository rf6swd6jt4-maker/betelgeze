-- Access URLs are bearer credentials. Providers still receive the complete URL,
-- but staff-facing Comms history must retain only the origin. Re-encrypt the
-- small, explicitly identified set of existing automated link messages in place.
begin;

with decoded as materialized (
    select
        message.id,
        case
            when message.body_ciphertext is null then message.body
            else communications_secure.try_decrypt_text(message.body_ciphertext, decrypted.decrypted_secret)
        end as body
    from public.client_messages message
    left join communications_secure.content_keys content_key on content_key.id = message.body_key_id
    left join vault.decrypted_secrets decrypted on decrypted.id = content_key.vault_secret_id
    where coalesce(message.automation_kind, message.raw_payload ->> 'kind')
        in ('onboarding_link', 'module_update', 'client_portal_link')
), redacted as materialized (
    select
        id,
        body as original_body,
        regexp_replace(
            body,
            '(https?://[^/?#[:space:]<>)]+)[^[:space:]<>)]*[0-9a-f]{64}[^[:space:]<>)]*',
            E'\\1/…',
            'gi'
        ) as body
    from decoded
    where body is not null and body ~* 'https?://[^[:space:]<>)]+[0-9a-f]{64}'
)
update public.client_messages message
set
    body = redacted.body,
    -- Older fallback deliveries kept the same credential under this key.
    -- Replacing raw_payload also replaces its encrypted counterpart via the
    -- existing encryption trigger, so neither projection retains the token.
    raw_payload = coalesce(message.raw_payload, '{}'::jsonb) - 'onboarding_url'
from redacted
where message.id = redacted.id
  and redacted.body is distinct from redacted.original_body;

-- Cover a malformed or partially written legacy row whose metadata retained a
-- credential even when its rendered body did not contain a parseable URL.
update public.client_messages message
set raw_payload = message.raw_payload - 'onboarding_url'
where coalesce(message.automation_kind, message.raw_payload ->> 'kind')
        in ('onboarding_link', 'module_update', 'client_portal_link')
  and message.raw_payload ? 'onboarding_url';

do $$
declare
    exposed_count bigint;
begin
    select count(*) into exposed_count
    from public.client_messages message
    left join communications_secure.content_keys content_key on content_key.id = message.body_key_id
    left join vault.decrypted_secrets decrypted on decrypted.id = content_key.vault_secret_id
    where coalesce(message.automation_kind, message.raw_payload ->> 'kind')
            in ('onboarding_link', 'module_update', 'client_portal_link')
      and coalesce(
          case
              when message.body_ciphertext is null then message.body
              else communications_secure.try_decrypt_text(message.body_ciphertext, decrypted.decrypted_secret)
          end,
          ''
      ) ~* 'https?://[^[:space:]<>)]+[0-9a-f]{64}';
    if exposed_count <> 0 then
        raise exception 'Automated Comms access-link redaction did not complete';
    end if;
end;
$$;

commit;
