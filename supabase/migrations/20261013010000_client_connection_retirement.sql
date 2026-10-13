-- Retain credential-free connection history and explicitly release retired locations.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table client_portal_secure.ghl_connection_history (
 id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 relationship_id uuid not null references public.relationships(id),
 retired_at timestamptz not null default clock_timestamp(),
 retired_by uuid not null,
 snapshot jsonb not null
);
alter table client_portal_secure.ghl_connection_history enable row level security;
revoke all on client_portal_secure.ghl_connection_history from public,anon,authenticated,service_role;
create index ghl_history_workspace_page_idx on client_portal_secure.ghl_connection_history(workspace_id,retired_at desc,id desc);
create index ghl_history_relationship_page_idx on client_portal_secure.ghl_connection_history(workspace_id,relationship_id,retired_at desc,id desc);

create function public.retire_client_ghl_connection(p_workspace_id uuid,p_user_id uuid,p_relationship_id uuid,p_expected_revision uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved client_portal_secure.ghl_connections%rowtype; client public.relationships%rowtype; actor_role text; retired client_portal_secure.ghl_connection_history%rowtype;
begin
 select m.role into actor_role from public.workspace_memberships m join public.workspaces w on w.id=m.workspace_id and w.status='active'
 where m.workspace_id=p_workspace_id and m.user_id=p_user_id;
 select * into client from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id;
 if actor_role is null or client.id is null or p_expected_revision is null then return jsonb_build_object('failure','access'); end if;
 if actor_role not in ('owner','admin') and (client.status='archived' or not public.service_assignee_can_setup_client(p_workspace_id,p_user_id,p_relationship_id)) then return jsonb_build_object('failure','access'); end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-ghl:'||p_relationship_id::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-ghl:'||p_relationship_id::text,0));
 -- A lost acknowledgement may safely retry the exact retired revision, including after reconnection.
 select * into retired from client_portal_secure.ghl_connection_history where workspace_id=p_workspace_id and relationship_id=p_relationship_id and id=p_expected_revision;
 if found then return jsonb_build_object('removed',true,'retired',retired.snapshot||jsonb_build_object('historyId',retired.id,'retiredAt',retired.retired_at,'connected',false)); end if;
 select * into saved from client_portal_secure.ghl_connections where workspace_id=p_workspace_id and relationship_id=p_relationship_id;
 if saved.vault_secret_id is null or saved.calendar_revision is distinct from p_expected_revision then return jsonb_build_object('failure','changed'); end if;
 insert into client_portal_secure.ghl_connection_history(id,workspace_id,relationship_id,retired_by,snapshot)
 values(saved.calendar_revision,p_workspace_id,p_relationship_id,p_user_id,jsonb_build_object(
  'relationshipId',p_relationship_id,'clientName',client.primary_person_name,'businessName',client.business_name,
  'accountType',saved.account_type,'locationId',saved.location_id,'locationName',saved.location_name,
  'calendarId',saved.selected_calendar_id,'calendarName',saved.selected_calendar_name,'readyAt',saved.ready_at,'refreshedAt',saved.refreshed_at)) returning * into retired;
 -- Existing delete trigger destroys only the managed Vault secret; calendar cache cascades.
 -- Relationship, onboarding, payments and provider records are untouched.
 delete from client_portal_secure.ghl_connections where workspace_id=p_workspace_id and relationship_id=p_relationship_id;
 return jsonb_build_object('removed',true,'retired',retired.snapshot||jsonb_build_object('historyId',retired.id,'retiredAt',retired.retired_at,'connected',false));
end $$;
revoke all on function public.retire_client_ghl_connection(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.retire_client_ghl_connection(uuid,uuid,uuid,uuid) to service_role;

-- Keep old open tabs compatible: their confirmed Remove now retains the same history.
do $migration$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('public.manage_client_ghl_connection_v2(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text,uuid,text,text)'::regprocedure);
 needle:=' items:=public.manage_client_ghl_connection(p_workspace_id,p_user_id,''list'',p_relationship_id);';
 if position(needle in definition)=0 then raise exception 'Unexpected GHL v2 authorization'; end if;
 definition:=replace(definition,needle,' if p_action=''remove'' then return public.retire_client_ghl_connection(p_workspace_id,p_user_id,p_relationship_id,p_expected_revision); end if;'||chr(10)||needle);
 needle:=' result:=public.manage_client_ghl_connection(p_workspace_id,p_user_id,p_action,p_relationship_id,p_operation_id,p_account_type,p_location_id,p_private_token,p_location_name,p_metrics,p_error);';
 if position(needle in definition)=0 then raise exception 'Unexpected GHL finish'; end if;
 definition:=replace(definition,needle,' if p_action=''finish'' and saved.vault_secret_id is not null and saved.location_id is distinct from p_location_id then return jsonb_build_object(''failure'',''retire_required''); end if;'||chr(10)||needle);
 execute definition;
 definition:=pg_get_functiondef('public.manage_client_ghl_connection(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text)'::regprocedure);
 needle:='then return jsonb_build_object(''failure'',''duplicate''); end if;';
 if position(needle in definition)=0 then raise exception 'Unexpected GHL duplicate check'; end if;
 definition:=replace(definition,needle,$replacement$then
  if exists(select 1 from client_portal_secure.ghl_connections other join public.relationships r on r.id=other.relationship_id and r.workspace_id=other.workspace_id
   where other.workspace_id=p_workspace_id and other.relationship_id<>p_relationship_id and other.location_id=p_location_id and other.vault_secret_id is not null and r.status='archived')
  then return jsonb_build_object('failure','duplicate_archived'); end if;
  return jsonb_build_object('failure','duplicate'); end if;$replacement$);
 needle:='        if p_private_token is not null then';
 if position(needle in definition)=0 then raise exception 'Unexpected GHL credentials write'; end if;
 definition:=replace(definition,needle,'        if v_connection.vault_secret_id is not null and v_connection.location_id is distinct from p_location_id then return jsonb_build_object(''failure'',''retire_required''); end if;'||chr(10)||needle);
 execute definition;
end $migration$;

create function public.read_client_ghl_connections(p_workspace_id uuid,p_user_id uuid,p_relationship_id uuid default null,p_history_only boolean default false,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_role text; accounts jsonb:='[]'; history jsonb; permitted uuid[]; next_cursor jsonb;
begin
 select m.role into actor_role from public.workspace_memberships m join public.workspaces w on w.id=m.workspace_id and w.status='active'
 where m.workspace_id=p_workspace_id and m.user_id=p_user_id;
 if actor_role is null then return jsonb_build_object('failure','access'); end if;
 if (p_before is null) <> (p_before_id is null) then return jsonb_build_object('failure','response'); end if;
 if actor_role in ('owner','admin') then
  if p_relationship_id is null then
  with current_rows as (
   select r.id,r.primary_person_name,r.business_name,r.status,c.*
   from public.relationships r left join client_portal_secure.ghl_connections c on c.workspace_id=p_workspace_id and c.relationship_id=r.id
   where not p_history_only and r.workspace_id=p_workspace_id
    and (c.vault_secret_id is not null or (r.status<>'archived' and (
     r.lifecycle_phase in ('onboarding','retention') or r.id in (
      select i.relationship_id from public.relationship_service_instances i
      where i.workspace_id=p_workspace_id  and i.import_id is null and i.disposition='active' and i.stage in ('onboarding','setup','maintenance')
      union all
      select i.relationship_id from public.relationship_service_instances i join public.onboarding_service_revisions v on v.workspace_id=i.workspace_id and v.id=i.service_revision_id
      where i.workspace_id=p_workspace_id  and i.import_id is null and i.disposition<>'cancelled'
       and not(i.disposition='active' and i.stage in ('onboarding','setup','maintenance')) and coalesce(v.definition->>'templateId',v.definition->>'template_id')='appointment-setting'
      union all
      select a.relationship_id from public.relationship_services a join public.onboarding_service_revisions v on v.workspace_id=a.workspace_id and v.id=a.service_revision_id
      where a.workspace_id=p_workspace_id  and coalesce(v.definition->>'templateId',v.definition->>'template_id')='appointment-setting'
     )))) limit 1001
  ), history_page as (
   select h.id,h.retired_at,h.snapshot||jsonb_build_object('historyId',h.id,'connected',false,'retiredAt',h.retired_at,'retiredBy',h.retired_by) item
   from client_portal_secure.ghl_connection_history h where h.workspace_id=p_workspace_id
    and (h.retired_at,h.id)<(coalesce(p_before,'infinity'::timestamptz),coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) order by h.retired_at desc,h.id desc limit 51
  )
  select coalesce((select jsonb_agg(jsonb_build_object(
    'relationshipId',c.id,'clientName',c.primary_person_name,'businessName',c.business_name,'archived',c.status='archived',
    'accountType',coalesce(c.account_type,'client_account'),'connected',c.vault_secret_id is not null,'locationId',c.location_id,'locationName',c.location_name,
    'calendarId',c.selected_calendar_id,'calendarName',c.selected_calendar_name,'revision',case when c.vault_secret_id is not null then c.calendar_revision else null end,
    'readyAt',c.ready_at,'refreshedAt',c.refreshed_at,'error',c.last_error,'busy',coalesce(c.lease_until>now(),false)) order by coalesce(c.business_name,c.primary_person_name),c.id) from current_rows c),'[]'),
   coalesce((select jsonb_agg(item order by retired_at desc,id desc) from history_page),'[]') into accounts,history;
  else
  with current_rows as (
   select r.id,r.primary_person_name,r.business_name,r.status,c.*
   from public.relationships r left join client_portal_secure.ghl_connections c on c.workspace_id=p_workspace_id and c.relationship_id=r.id
   where not p_history_only and r.workspace_id=p_workspace_id and r.id=p_relationship_id
    and (c.vault_secret_id is not null or (r.status<>'archived' and (
     r.lifecycle_phase in ('onboarding','retention') or r.id in (
      select i.relationship_id from public.relationship_service_instances i
      where i.workspace_id=p_workspace_id and i.relationship_id=p_relationship_id and i.import_id is null and i.disposition='active' and i.stage in ('onboarding','setup','maintenance')
      union all
      select i.relationship_id from public.relationship_service_instances i join public.onboarding_service_revisions v on v.workspace_id=i.workspace_id and v.id=i.service_revision_id
      where i.workspace_id=p_workspace_id and i.relationship_id=p_relationship_id and i.import_id is null and i.disposition<>'cancelled'
       and not(i.disposition='active' and i.stage in ('onboarding','setup','maintenance')) and coalesce(v.definition->>'templateId',v.definition->>'template_id')='appointment-setting'
      union all
      select a.relationship_id from public.relationship_services a join public.onboarding_service_revisions v on v.workspace_id=a.workspace_id and v.id=a.service_revision_id
      where a.workspace_id=p_workspace_id and a.relationship_id=p_relationship_id and coalesce(v.definition->>'templateId',v.definition->>'template_id')='appointment-setting'
     )))) limit 1001
  ), history_page as (
   select h.id,h.retired_at,h.snapshot||jsonb_build_object('historyId',h.id,'connected',false,'retiredAt',h.retired_at,'retiredBy',h.retired_by) item
   from client_portal_secure.ghl_connection_history h where h.workspace_id=p_workspace_id and h.relationship_id=p_relationship_id
    and (h.retired_at,h.id)<(coalesce(p_before,'infinity'::timestamptz),coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) order by h.retired_at desc,h.id desc limit 51
  )
  select coalesce((select jsonb_agg(jsonb_build_object(
    'relationshipId',c.id,'clientName',c.primary_person_name,'businessName',c.business_name,'archived',c.status='archived',
    'accountType',coalesce(c.account_type,'client_account'),'connected',c.vault_secret_id is not null,'locationId',c.location_id,'locationName',c.location_name,
    'calendarId',c.selected_calendar_id,'calendarName',c.selected_calendar_name,'revision',case when c.vault_secret_id is not null then c.calendar_revision else null end,
    'readyAt',c.ready_at,'refreshedAt',c.refreshed_at,'error',c.last_error,'busy',coalesce(c.lease_until>now(),false)) order by coalesce(c.business_name,c.primary_person_name),c.id) from current_rows c),'[]'),
   coalesce((select jsonb_agg(item order by retired_at desc,id desc) from history_page),'[]') into accounts,history;
  end if;
  if jsonb_array_length(accounts)>1000 then return jsonb_build_object('failure','list_limit'); end if;
 else
  accounts:=public.manage_client_ghl_connection_v2(p_workspace_id,p_user_id,'list',p_relationship_id);
  if jsonb_typeof(accounts)<>'array' then return accounts; end if;
  select array_agg((item->>'relationshipId')::uuid) into permitted from jsonb_array_elements(accounts) item;
 select coalesce(jsonb_agg(item order by retired_at desc,id desc),'[]') into history from (
  select h.id,h.retired_at,h.snapshot||jsonb_build_object('historyId',h.id,'connected',false,'retiredAt',h.retired_at,'retiredBy',h.retired_by) item
  from client_portal_secure.ghl_connection_history h
  where h.workspace_id=p_workspace_id and (p_relationship_id is null or h.relationship_id=p_relationship_id)
   and (actor_role in ('owner','admin') or h.relationship_id=any(permitted))
   and (h.retired_at,h.id)<(coalesce(p_before,'infinity'::timestamptz),coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by h.retired_at desc,h.id desc limit 51
 ) page;
 end if;
 if jsonb_array_length(history)>50 then
  history:=history-50;
  next_cursor:=jsonb_build_object('before',history->49->>'retiredAt','id',history->49->>'historyId');
 end if;
 return jsonb_build_object('accounts',case when p_history_only then '[]'::jsonb else accounts end,'history',history,'nextCursor',next_cursor);
end $$;
revoke all on function public.read_client_ghl_connections(uuid,uuid,uuid,boolean,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.read_client_ghl_connections(uuid,uuid,uuid,boolean,timestamptz,uuid) to service_role;
notify pgrst,'reload schema';
commit;
