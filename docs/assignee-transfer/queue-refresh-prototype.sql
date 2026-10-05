-- Restore progress metadata lost when queue display metadata was added.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $queue$
declare definition text;
begin
 definition:=pg_get_functiondef('public.read_relationship_work_queue(uuid,uuid,uuid,integer)'::regprocedure);
 if position('return result;' in definition)=0 or position('''generation''' in definition)>0 then raise exception 'Unexpected relationship queue function'; end if;
 definition:=replace(definition,'return result;',$fragment$
 if p_offset=0 and exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and user_id=p_user_id and role in ('owner','admin')) then
  result:=result||jsonb_build_object('generation',coalesce((select jsonb_agg(to_jsonb(x)) from (
   select q.instance_id,q.sop_id,coalesce(j.id,q.run_id) run_id,coalesce(j.status,q.status) status,coalesce(j.error_summary,q.error_summary) error_summary
   from (select * from public.sop_work_requests where workspace_id=p_workspace_id and relationship_id=p_relationship_id order by created_at desc limit 10) q
   left join public.sop_work_runs j on j.workspace_id=q.workspace_id and j.id=q.run_id
  ) x),'[]'::jsonb));
 end if;
 return result;
$fragment$);
 execute definition;
end $queue$;
notify pgrst,'reload schema';
commit;
