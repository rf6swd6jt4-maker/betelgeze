-- Template covers are public application assets. Existing template services were
-- saved before their source was persisted, so mark only blank, unchanged covers.
begin;

update public.onboarding_service_revisions
set definition = definition || jsonb_build_object(
    'thumbnailTemplateId',
    coalesce(definition->>'templateId', definition->>'template_id')
)
where coalesce(definition->>'templateId', definition->>'template_id') in (
    'meta-ads',
    'appointment-setting',
    'google-ads',
    'google-search-ads',
    'google-local-services-ads'
)
  and not (definition ? 'thumbnailTemplateId' or definition ? 'thumbnail_template_id')
  and nullif(trim(coalesce(definition->>'thumbnailPath', definition->>'thumbnail_path', '')), '') is null;

commit;
