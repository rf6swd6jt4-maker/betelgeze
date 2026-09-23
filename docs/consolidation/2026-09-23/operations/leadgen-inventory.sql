-- Run catalog-preflight first: these five tables and cron.job must exist.
-- No IDs, business payloads, errors, cron commands, tokens, or URLs are returned.
-- Caps bound materialized rows, not heap pages visited. A timeout is an unknown
-- result, never evidence that no work exists. Do not raise it blindly on production.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '5s';
set local lock_timeout = '500ms';
set local idle_in_transaction_session_timeout = '30s';

with parent_sample as materialized (
    select status from public.leadgen_polls limit 1001
), grouped as (
    select status,count(*) as n from parent_sample group by status
)
select jsonb_build_object(
 'observed_at',now(),
 'parent_rows_observed',(select count(*) from parent_sample),
 'parent_counts_complete',(select count(*)<1001 from parent_sample),
 'parent_status_counts',(select jsonb_object_agg(status,n) from grouped),
 'legacy_sunbiz_index_present',to_regclass('public.leadgen_sunbiz_owner_index') is not null,
 'cron_jobs',(select jsonb_agg(jsonb_build_object('name',jobname,'active',active) order by jobname) from cron.job)
) as parent_and_scheduler_inventory;

with task_sample as materialized (
 select poll_id,workspace_id,status from public.leadgen_poll_tasks limit 10001
), investigation_sample as materialized (
 select poll_id,workspace_id,status from public.leadgen_investigation_tasks limit 10001
), stage_sample as materialized (
 select poll_id,workspace_id,status from public.leadgen_poll_stage_runs limit 10001
), company_stage_sample as materialized (
 select poll_id,workspace_id,status from public.leadgen_company_stage_status limit 10001
), sampled as materialized (
 select 'leadgen_poll_tasks' as table_name,* from task_sample
 union all select 'leadgen_investigation_tasks',* from investigation_sample
 union all select 'leadgen_poll_stage_runs',* from stage_sample
 union all select 'leadgen_company_stage_status',* from company_stage_sample
), grouped as (
 select s.table_name,s.status as child_status,coalesce(p.status,'<missing parent>') as parent_status,
        (p.id is not null and s.workspace_id is distinct from p.workspace_id) as workspace_mismatch,
        count(*) as observed_rows
 from sampled s left join public.leadgen_polls p on p.id=s.poll_id
 group by s.table_name,s.status,p.status,(p.id is not null and s.workspace_id is distinct from p.workspace_id)
), completeness as (
 select name as table_name,(select count(*) from sampled s where s.table_name=name) as observed_rows,
        (select count(*)<10001 from sampled s where s.table_name=name) as counts_complete
 from (values ('leadgen_poll_tasks'),('leadgen_investigation_tasks'),
              ('leadgen_poll_stage_runs'),('leadgen_company_stage_status')) as names(name)
)
select jsonb_build_object('observed_at',now(),
 'sample_completeness',(select jsonb_agg(to_jsonb(c) order by c.table_name) from completeness c),
 'child_states_by_parent',(select jsonb_agg(to_jsonb(g) order by g.table_name,g.parent_status,g.child_status) from grouped g)
) as child_inventory;
rollback;
