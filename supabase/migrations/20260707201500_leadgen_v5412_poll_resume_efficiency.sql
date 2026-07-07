-- Lead Gen v5.4.12 staged poll resume and website fallback efficiency.
-- Prevent active duplicate website crawl tasks for the same poll/company/stage.

with duplicate_active_website_tasks as (
    select
        id,
        row_number() over (
            partition by workspace_id, poll_id, source_key, stage_key, source_query->>'company_id'
            order by created_at asc, id asc
        ) as duplicate_rank
    from public.leadgen_poll_tasks
    where source_key = 'website'
        and status in ('queued', 'running')
        and source_query ? 'company_id'
        and nullif(source_query->>'company_id', '') is not null
)
update public.leadgen_poll_tasks
set
    status = 'cancelled',
    completed_at = coalesce(completed_at, now()),
    error = coalesce(error, 'Cancelled duplicate active website crawl task during Lead Gen v5.4.12 resume hardening.')
where id in (
    select id
    from duplicate_active_website_tasks
    where duplicate_rank > 1
);

create unique index if not exists leadgen_poll_tasks_active_website_company_stage_idx
on public.leadgen_poll_tasks (
    workspace_id,
    poll_id,
    source_key,
    stage_key,
    (source_query->>'company_id')
)
where source_key = 'website'
    and status in ('queued', 'running')
    and source_query ? 'company_id'
    and nullif(source_query->>'company_id', '') is not null;
