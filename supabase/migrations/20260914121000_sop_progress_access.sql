-- Match the established relationship-access argument contract explicitly.
begin;
create or replace function public.read_service_sop_progress(p_workspace uuid,p_actor uuid,p_relationship uuid,p_instance uuid) returns jsonb
language plpgsql set search_path=public as $$
declare request sop_work_requests; job sop_work_runs; source_status text; progress integer; label text;
begin
 if not workspace_user_can_access_relationship(p_workspace_id => p_workspace,p_relationship_id => p_relationship,p_user_id => p_actor) then raise exception 'Relationship access required'; end if;
 if not exists(select 1 from relationship_service_instances where workspace_id=p_workspace and relationship_id=p_relationship and id=p_instance) then raise exception 'Service not found'; end if;
 select * into request from sop_work_requests where workspace_id=p_workspace and relationship_id=p_relationship and instance_id=p_instance;
 if not found then return jsonb_build_object('status','unavailable','progress',0,'label','Work was not queued','error','Link this service to a main SOP file, then add it to an active test relationship in Setup.'); end if;
 select * into job from sop_work_runs where workspace_id=p_workspace and id=request.run_id;
 if job.id is null then return jsonb_build_object('status',request.status,'progress',10,'label','Waiting to read the SOP','error',request.error_summary); end if;
 select status into source_status from sop_interpretations where workspace_id=p_workspace and id=job.interpretation_id;
 progress:=case when job.status='published' then 100 when job.plan is not null then 90 when job.raw_output is not null then 80 when source_status in ('ready','reviewed') then 50 when source_status='running' then 25 else 10 end;
 label:=case progress when 100 then 'Work added to the queue' when 90 then 'Adding work to the queue' when 80 then 'Checking the work flow' when 50 then 'Creating SOP-based work' when 25 then 'Reading the SOP' else 'Waiting to read the SOP' end;
 return jsonb_build_object('status',job.status,'progress',progress,'label',label,'error',job.error_summary);
end $$;
commit;
