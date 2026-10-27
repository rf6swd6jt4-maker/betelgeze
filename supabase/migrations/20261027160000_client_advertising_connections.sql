-- Credential-free, bounded advertising summaries. Custom plans keep optional
-- scope/cursor predicates on the existing workspace/relationship indexes. HighLevel reads and writes
-- retain their existing owners; this independent page never contacts a provider.
begin;
do $$ begin
 if to_regprocedure('public.manage_client_ghl_connection_v2(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text,uuid,text,text)') is null then
  raise exception 'Install Client Connections controls before advertising summaries';
 end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='relationship_windsor_meta_ads_connections' and column_name='reporting_verified_at') then
  raise exception 'Install Meta reporting readiness before advertising summaries';
 end if;
end $$;

create function public.read_client_advertising_connections(
 p_workspace_id uuid,p_user_id uuid,p_relationship_id uuid default null,
 p_after_relationship uuid default null,p_after_provider text default null
) returns jsonb language plpgsql security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare actor_role text; permitted uuid[]; allowed jsonb; accounts jsonb; next_cursor jsonb;
begin
 select m.role into actor_role from public.workspace_memberships m
 join public.workspaces w on w.id=m.workspace_id and w.status='active'
 where m.workspace_id=p_workspace_id and m.user_id=p_user_id;
 if actor_role is null then return jsonb_build_object('failure','access'); end if;
 if (p_after_relationship is null) <> (p_after_provider is null)
    or (p_after_provider is not null and p_after_provider not in ('google_ads','meta_ads','windsor')) then
  return jsonb_build_object('failure','cursor');
 end if;
 -- Reuse the canonical current setup scope, including explicit grants and
 -- shared-service assignments. Never infer staff access from a provider row.
 if actor_role not in ('owner','admin') then
  allowed:=public.manage_client_ghl_connection_v2(p_workspace_id,p_user_id,'list',p_relationship_id);
  if jsonb_typeof(allowed)<>'array' then return jsonb_build_object('failure','access'); end if;
  select array_agg((item->>'relationshipId')::uuid) into permitted from jsonb_array_elements(allowed) item;
  if coalesce(cardinality(permitted),0)=0 then return jsonb_build_object('accounts','[]'::jsonb,'nextCursor',null); end if;
 end if;
 with candidates as (
  (select c.relationship_id,'google_ads'::text provider,c.status,c.customer_id account_id,c.account_name,c.connected_at,c.last_verified_at
   from public.relationship_google_ads_connections c
   where c.workspace_id=p_workspace_id and (p_relationship_id is null or c.relationship_id=p_relationship_id)
    and (actor_role in ('owner','admin') or c.relationship_id=any(permitted))
    and (p_after_relationship is null or (c.relationship_id,'google_ads'::text)>(p_after_relationship,p_after_provider))
   order by c.relationship_id limit 51)
  union all
  (select c.relationship_id,'meta_ads'::text,
    case when c.status='connected' and c.access_token_expires_at<=now() then 'needs_attention' else c.status end,
    c.facebook_user_id,c.facebook_user_name,c.connected_at,c.last_verified_at
   from public.relationship_meta_ads_connections c
   where c.workspace_id=p_workspace_id and (p_relationship_id is null or c.relationship_id=p_relationship_id)
    and (actor_role in ('owner','admin') or c.relationship_id=any(permitted))
    and (p_after_relationship is null or (c.relationship_id,'meta_ads'::text)>(p_after_relationship,p_after_provider))
   order by c.relationship_id limit 51)
  union all
  (select c.relationship_id,'windsor'::text,
    case when c.status='connected' and (c.reporting_verified_at is null or c.last_report_error is not null) then 'needs_attention' else c.status end,
    c.account_id,c.account_name,c.connected_at,c.reporting_verified_at
   from public.relationship_windsor_meta_ads_connections c
   where c.workspace_id=p_workspace_id and (p_relationship_id is null or c.relationship_id=p_relationship_id)
    and (actor_role in ('owner','admin') or c.relationship_id=any(permitted))
    and (p_after_relationship is null or (c.relationship_id,'windsor'::text)>(p_after_relationship,p_after_provider))
   order by c.relationship_id limit 51)
 ), page as (
  select c.*,r.primary_person_name,r.business_name,r.status='archived' archived
  from candidates c join public.relationships r on r.workspace_id=p_workspace_id and r.id=c.relationship_id
  where actor_role in ('owner','admin') or r.status<>'archived'
  order by c.relationship_id,c.provider limit 51
 ) select coalesce(jsonb_agg(jsonb_build_object(
  'relationshipId',relationship_id,'provider',provider,'clientName',primary_person_name,'businessName',business_name,'archived',archived,
  'status',status,'accountId',account_id,'accountName',account_name,'connectedAt',connected_at,'verifiedAt',last_verified_at
 ) order by relationship_id,provider),'[]'::jsonb) into accounts from page;
 if jsonb_array_length(accounts)>50 then
  accounts:=accounts-50;
  next_cursor:=jsonb_build_object('relationshipId',accounts->49->>'relationshipId','provider',accounts->49->>'provider');
 end if;
 return jsonb_build_object('accounts',accounts,'nextCursor',next_cursor);
end $$;
revoke all on function public.read_client_advertising_connections(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.read_client_advertising_connections(uuid,uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
