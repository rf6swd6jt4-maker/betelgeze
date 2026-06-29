alter table public.leadgen_poll_tasks
add column if not exists stage_key text;

alter table public.leadgen_investigation_tasks
add column if not exists stage_key text;

update public.leadgen_poll_tasks
set stage_key = case
    when source_key in ('overture', 'osm', 'alltheplaces', 'foursquare_os_places') or stage = 'candidate_seed' then 'seed'
    when source_key = 'phone.basic_format_validation' then 'phone_validation'
    else 'business_validation'
end
where stage_key is null;

update public.leadgen_investigation_tasks
set stage_key = 'business_validation'
where stage_key is null;

alter table public.leadgen_poll_tasks
alter column stage_key set default 'business_validation',
alter column stage_key set not null;

alter table public.leadgen_investigation_tasks
alter column stage_key set default 'business_validation',
alter column stage_key set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'leadgen_poll_tasks_stage_key_check'
            and conrelid = 'public.leadgen_poll_tasks'::regclass
    ) then
        alter table public.leadgen_poll_tasks
        add constraint leadgen_poll_tasks_stage_key_check
        check (stage_key in ('seed', 'business_validation', 'owner_identity', 'owner_phone', 'phone_validation'));
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'leadgen_investigation_tasks_stage_key_check'
            and conrelid = 'public.leadgen_investigation_tasks'::regclass
    ) then
        alter table public.leadgen_investigation_tasks
        add constraint leadgen_investigation_tasks_stage_key_check
        check (stage_key in ('business_validation', 'owner_identity', 'owner_phone', 'phone_validation'));
    end if;
end $$;

alter table public.leadgen_investigation_tasks
drop constraint if exists leadgen_investigation_tasks_poll_id_company_id_source_key_key;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'leadgen_investigation_tasks_poll_company_source_stage_key'
            and conrelid = 'public.leadgen_investigation_tasks'::regclass
    ) then
        alter table public.leadgen_investigation_tasks
        add constraint leadgen_investigation_tasks_poll_company_source_stage_key
        unique (poll_id, company_id, source_key, stage_key);
    end if;
end $$;

create index if not exists leadgen_poll_tasks_poll_stage_status_idx
on public.leadgen_poll_tasks (poll_id, stage_key, status, created_at);

create index if not exists leadgen_investigation_tasks_poll_stage_status_idx
on public.leadgen_investigation_tasks (poll_id, stage_key, status, created_at);

update public.leadgen_source_stage_capabilities
set enabled = false,
    updated_at = now()
where (source_key = 'sam_gov'
        and stage_key in ('business_validation', 'owner_identity', 'owner_phone'))
    or (source_key = 'website'
        and stage_key in ('business_validation', 'owner_phone'))
    or (source_key in ('state_license.tx.tdlr', 'state_license.fl.electrical', 'state_license.nc.general_contractors', 'regulated.nppes')
        and stage_key in ('business_validation', 'owner_phone'));

update public.leadgen_source_catalog source
set stage_capabilities = coalesce(capabilities.stage_capabilities, '[]'::jsonb),
    updated_at = now()
from (
    select source_key,
        jsonb_agg(jsonb_build_object('stage_key', stage_key, 'priority', priority) order by priority, stage_key) as stage_capabilities
    from public.leadgen_source_stage_capabilities
    where enabled = true
    group by source_key
) capabilities
where source.source_key = capabilities.source_key;

update public.leadgen_source_catalog
set stage_capabilities = '[]'::jsonb,
    updated_at = now()
where source_key = 'sam_gov';
