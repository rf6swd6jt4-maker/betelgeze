-- Additive Meta reporting verification and maintenance. No live binding is
-- replaced until a scoped provider report has been previewed and confirmed.
begin;

alter table public.relationship_windsor_meta_ads_connections
  alter column onboarding_session_id drop not null,
  alter column source_session_block_id drop not null,
  add column reporting_revision uuid,
  add column reporting_verified_at timestamptz,
  add column reporting_grant_encrypted text,
  add column last_report jsonb,
  add column last_report_error text,
  add column last_report_attempt_at timestamptz;

create function public.windsor_reporting_binding_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.account_id,new.integration_fingerprint,new.status) is distinct from (old.account_id,old.integration_fingerprint,old.status) then
    new.reporting_revision:=gen_random_uuid();
    new.reporting_verified_at:=null; new.reporting_grant_encrypted:=null;
    new.last_report:=null; new.last_report_error:=null; new.last_report_attempt_at:=null;
  end if;
  return new;
end;
$$;
create trigger windsor_reporting_binding_revision before update of account_id,integration_fingerprint,status
on public.relationship_windsor_meta_ads_connections for each row execute function public.windsor_reporting_binding_revision();
revoke all on function public.windsor_reporting_binding_revision() from public,anon,authenticated;

create table public.windsor_meta_reporting_candidates (
  workspace_id uuid not null,
  relationship_id uuid not null,
  id uuid not null default gen_random_uuid(),
  expected_revision uuid,
  actor_user_id uuid not null,
  authorization_encrypted text not null,
  authorization_hash text not null check(authorization_hash ~ '^[a-f0-9]{64}$'),
  integration_fingerprint text not null check(integration_fingerprint ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null default now()+interval '30 minutes',
  created_at timestamptz not null default now(),
  account_id text,
  account_name text,
  datasource text,
  preview jsonb,
  verified_at timestamptz,
  primary key(workspace_id,relationship_id),
  unique(id),
  foreign key(workspace_id,relationship_id) references public.relationships(workspace_id,id) on delete cascade
);
create table public.windsor_meta_reporting_history (
  id uuid primary key,
  workspace_id uuid not null,
  relationship_id uuid not null,
  actor_user_id uuid not null,
  previous_account_id text,
  previous_account_name text,
  account_id text not null,
  account_name text not null,
  connection_revision uuid not null,
  created_at timestamptz not null default now(),
  foreign key(workspace_id,relationship_id) references public.relationships(workspace_id,id) on delete cascade
);
create index windsor_meta_reporting_history_relationship on public.windsor_meta_reporting_history(workspace_id,relationship_id,created_at desc,id desc);
alter table public.windsor_meta_reporting_candidates enable row level security;
alter table public.windsor_meta_reporting_history enable row level security;
revoke all on public.windsor_meta_reporting_candidates,public.windsor_meta_reporting_history from public,anon,authenticated;
grant all on public.windsor_meta_reporting_candidates,public.windsor_meta_reporting_history to service_role;

create function public.manage_windsor_meta_reporting(p_action text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  ws uuid:=(p_input->>'workspaceId')::uuid; rel uuid:=(p_input->>'relationshipId')::uuid; actor uuid:=(p_input->>'userId')::uuid;
  actor_role text; client_status text; connection public.relationship_windsor_meta_ads_connections%rowtype;
  candidate public.windsor_meta_reporting_candidates%rowtype; receipt public.windsor_meta_reporting_history%rowtype;
  revision uuid; integration public.workspace_integrations%rowtype; result jsonb; new_revision uuid;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='Trusted reporting runtime required'; end if;
  select m.role into actor_role from public.workspace_memberships m join public.workspaces w on w.id=m.workspace_id and w.status='active'
    where m.workspace_id=ws and m.user_id=actor;
  select r.status into client_status from public.relationships r where r.workspace_id=ws and r.id=rel;
  if actor_role is null or client_status is null or client_status='archived' or
    (actor_role not in ('owner','admin') and not public.service_assignee_can_setup_client(ws,actor,rel)) then
    raise exception using errcode='42501',message='You do not have access to this client connection';
  end if;
  -- All new writes serialize one relationship. Provider reads happen outside this transaction.
  if p_action<>'read' then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(ws::text||':'||rel::text||':windsor-meta',0)); end if;
  select * into connection from public.relationship_windsor_meta_ads_connections where workspace_id=ws and relationship_id=rel;
  revision:=coalesce(connection.reporting_revision,connection.id);
  select * into candidate from public.windsor_meta_reporting_candidates where workspace_id=ws and relationship_id=rel;
  select * into integration from public.workspace_integrations where workspace_id=ws and provider='windsor';
  if p_action='read' then
    return jsonb_build_object('connection',case when connection.id is null then null else jsonb_build_object(
      'revision',revision,'accountId',connection.account_id,'accountName',connection.account_name,'status',connection.status,
      'verifiedAt',connection.reporting_verified_at,'lastReportAt',connection.last_report->>'fetchedAt','lastError',case when not coalesce(integration.enabled and integration.mode='connected' and integration.connection_status='connected' and connection.integration_fingerprint=encode(extensions.digest(convert_to(integration.config_encrypted,'UTF8'),'sha256'),'hex'),false) then 'authorization' else connection.last_report_error end,
      'canReuseAuthorization',connection.reporting_grant_encrypted is not null and connection.integration_fingerprint=encode(extensions.digest(convert_to(integration.config_encrypted,'UTF8'),'sha256'),'hex')) end,
      'candidateId',case when candidate.expires_at>now() and candidate.actor_user_id=actor and candidate.expected_revision is not distinct from revision then candidate.id else null end,
      'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (
        select id,previous_account_id,previous_account_name,account_id,account_name,created_at from public.windsor_meta_reporting_history
        where workspace_id=ws and relationship_id=rel order by created_at desc,id desc limit 10) h),'[]'::jsonb));
  end if;
  if not coalesce(integration.enabled and integration.mode='connected' and integration.connection_status='connected',false) or integration.config_encrypted is null then
    raise exception using errcode='P0001',message='The agency Windsor connection needs attention';
  end if;
  if p_action='context' then
    return jsonb_build_object('revision',revision,'integrationEncrypted',integration.config_encrypted,'grantEncrypted',case when connection.integration_fingerprint=encode(extensions.digest(convert_to(integration.config_encrypted,'UTF8'),'sha256'),'hex') then connection.reporting_grant_encrypted else null end,
      'candidate',case when candidate.expires_at>now() and candidate.actor_user_id=actor and candidate.expected_revision is not distinct from revision then to_jsonb(candidate) else null end);
  end if;
  if p_action='commit' then
    select * into receipt from public.windsor_meta_reporting_history where id=(p_input->>'candidateId')::uuid and workspace_id=ws and relationship_id=rel and actor_user_id=actor;
    if found then return jsonb_build_object('saved',true,'revision',receipt.connection_revision,'accountId',receipt.account_id); end if;
  end if;
  select * into connection from public.relationship_windsor_meta_ads_connections where workspace_id=ws and relationship_id=rel for update;
  revision:=coalesce(connection.reporting_revision,connection.id);
  if revision is distinct from (p_input->>'expectedRevision')::uuid then raise exception using errcode='P0001',message='The connection changed. Reload before continuing'; end if;
  if p_input->>'integrationFingerprint' is distinct from encode(extensions.digest(convert_to(integration.config_encrypted,'UTF8'),'sha256'),'hex') then
    raise exception using errcode='P0001',message='The agency Windsor connection changed. Start again';
  end if;
  if p_action='begin' then
    if candidate.created_at>now()-interval '10 seconds' then raise exception using errcode='P0001',message='A connection was just started. Wait a moment'; end if;
    if nullif(p_input->>'authorizationEncrypted','') is null or coalesce(p_input->>'authorizationHash','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid authorization'; end if;
    insert into public.windsor_meta_reporting_candidates(workspace_id,relationship_id,id,expected_revision,actor_user_id,authorization_encrypted,authorization_hash,integration_fingerprint)
      values(ws,rel,(p_input->>'candidateId')::uuid,revision,actor,p_input->>'authorizationEncrypted',p_input->>'authorizationHash',p_input->>'integrationFingerprint')
      on conflict(workspace_id,relationship_id) do update set id=excluded.id,expected_revision=excluded.expected_revision,actor_user_id=excluded.actor_user_id,
        authorization_encrypted=excluded.authorization_encrypted,authorization_hash=excluded.authorization_hash,integration_fingerprint=excluded.integration_fingerprint,
        created_at=now(),expires_at=now()+interval '30 minutes',account_id=null,account_name=null,datasource=null,preview=null,verified_at=null;
    return jsonb_build_object('candidateId',p_input->>'candidateId');
  end if;
  if candidate.id is distinct from (p_input->>'candidateId')::uuid or candidate.actor_user_id<>actor or candidate.expires_at<=now()
     or candidate.expected_revision is distinct from revision or candidate.integration_fingerprint is distinct from p_input->>'integrationFingerprint' then
    raise exception using errcode='P0001',message='This verification expired or was replaced. Start again';
  end if;
  if p_action='preview' then
    if coalesce(p_input->>'accountId','') !~ '^[a-zA-Z0-9_-]{1,200}$' or length(coalesce(p_input->>'accountName','')) not between 1 and 300
      or coalesce(p_input->>'datasource','') not in ('facebook','facebook_ads') or jsonb_typeof(p_input->'report') is distinct from 'object'
      or octet_length((p_input->'report')::text)>65536 or coalesce(jsonb_array_length(p_input->'report'->'daily'),-1)<>30
      or p_input->'report'->>'accountId' is distinct from p_input->>'accountId' then raise exception 'Invalid report preview'; end if;
    update public.windsor_meta_reporting_candidates set account_id=p_input->>'accountId',account_name=p_input->>'accountName',datasource=p_input->>'datasource',preview=p_input->'report',verified_at=now()
      where workspace_id=ws and relationship_id=rel;
    return jsonb_build_object('verified',true);
  end if;
  if p_action<>'commit' then raise exception 'Unknown reporting operation'; end if;
  if candidate.preview is null or candidate.verified_at<now()-interval '10 minutes' or candidate.account_id is distinct from p_input->>'accountId' then
    raise exception using errcode='P0001',message='Preview this account again before confirming';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(ws::text||':windsor-account:'||candidate.account_id,0));
  -- Two exact probes use the existing partial unique account index. Do not add
  -- another index (and its write cost) to the live connection table.
  if exists(select 1 from public.relationship_windsor_meta_ads_connections where workspace_id=ws and relationship_id<>rel and status='connected' and account_id in (candidate.account_id,'act_'||candidate.account_id)) then
    raise exception using errcode='P0001',message='This Meta account is already linked to another client';
  end if;
  new_revision:=gen_random_uuid();
  insert into public.relationship_windsor_meta_ads_connections(workspace_id,relationship_id,status,account_id,account_name,datasource,integration_fingerprint,connected_at,last_verified_at,reporting_revision)
    values(ws,rel,'connected',candidate.account_id,candidate.account_name,candidate.datasource,candidate.integration_fingerprint,now(),now(),new_revision)
    on conflict(workspace_id,relationship_id) do update set status='connected',account_id=excluded.account_id,account_name=excluded.account_name,datasource=excluded.datasource,
      integration_fingerprint=excluded.integration_fingerprint,connected_at=now(),last_verified_at=now(),updated_at=now(),reporting_revision=new_revision;
  select coalesce(reporting_revision,id) into new_revision from public.relationship_windsor_meta_ads_connections where workspace_id=ws and relationship_id=rel;
  update public.relationship_windsor_meta_ads_connections set reporting_verified_at=now(),reporting_grant_encrypted=candidate.authorization_encrypted,
    last_report=candidate.preview||jsonb_build_object('accountId',candidate.account_id,'accountName',candidate.account_name,'connectionRevision',new_revision),
    last_report_error=null,last_report_attempt_at=now() where workspace_id=ws and relationship_id=rel;
  insert into public.windsor_meta_reporting_history(id,workspace_id,relationship_id,actor_user_id,previous_account_id,previous_account_name,account_id,account_name,connection_revision)
    values(candidate.id,ws,rel,actor,connection.account_id,connection.account_name,candidate.account_id,candidate.account_name,new_revision);
  delete from public.windsor_meta_reporting_candidates where workspace_id=ws and relationship_id=rel and id=candidate.id;
  return jsonb_build_object('saved',true,'revision',new_revision,'accountId',candidate.account_id);
exception when unique_violation then raise exception using errcode='P0001',message='This Meta account is already linked to another client';
end;
$$;
revoke all on function public.manage_windsor_meta_reporting(text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_windsor_meta_reporting(text,jsonb) to service_role;

-- Called only after portal authorization and an account-scoped provider read.
-- The CAS prevents an old report from overwriting a newly selected account.
create function public.save_windsor_meta_report(p_workspace_id uuid,p_relationship_id uuid,p_revision uuid,p_fingerprint text,p_report jsonb,p_error text default null,p_started_at timestamptz default now())
returns boolean language plpgsql security invoker set search_path='' as $$
declare saved public.relationship_windsor_meta_ads_connections%rowtype;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='Trusted reporting runtime required'; end if;
  select * into saved from public.relationship_windsor_meta_ads_connections where workspace_id=p_workspace_id and relationship_id=p_relationship_id and status='connected' for update;
  if saved.id is null or coalesce(saved.reporting_revision,saved.id) is distinct from p_revision or saved.integration_fingerprint is distinct from p_fingerprint then return false; end if;
  if not exists(select 1 from public.workspace_integrations where workspace_id=p_workspace_id and provider='windsor' and enabled and mode='connected' and connection_status='connected' and encode(extensions.digest(convert_to(config_encrypted,'UTF8'),'sha256'),'hex')=p_fingerprint) then return false; end if;
  if p_report is not null and (jsonb_typeof(p_report)<>'object' or octet_length(p_report::text)>65536 or p_report->>'accountId' is distinct from saved.account_id or p_report->>'connectionRevision' is distinct from p_revision::text) then raise exception 'Invalid report'; end if;
  update public.relationship_windsor_meta_ads_connections set last_report=coalesce(p_report,last_report),last_report_error=case when p_report is null then 'unavailable' else null end,last_report_attempt_at=now()
    where id=saved.id and (last_report_attempt_at is null or last_report_attempt_at<=p_started_at)
      and (p_report is null or last_report is null or (last_report->>'fetchedAt')::timestamptz<=(p_report->>'fetchedAt')::timestamptz);
  return true;
end;
$$;
revoke all on function public.save_windsor_meta_report(uuid,uuid,uuid,text,jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.save_windsor_meta_report(uuid,uuid,uuid,text,jsonb,text,timestamptz) to service_role;

-- New onboarding keeps the exact verified report and client-scoped grant.
-- Existing completion RPCs remain available to already deployed callers.
create function public.complete_verified_windsor_meta_ads_onboarding(p_token text,p_block_id uuid,p_authorization_hash text,p_account_id text,p_account_name text,p_datasource text,p_integration_fingerprint text,p_report jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare block public.relationship_onboarding_session_blocks%rowtype; saved public.relationship_windsor_meta_ads_connections%rowtype; result jsonb; revision uuid;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='Trusted onboarding runtime required'; end if;
  if jsonb_typeof(p_report) is distinct from 'object' or octet_length(p_report::text)>65536 or coalesce(jsonb_array_length(p_report->'daily'),-1)<>30 or p_report->>'accountId' is distinct from p_account_id then raise exception 'Invalid reporting verification'; end if;
  block:=public.windsor_meta_ads_onboarding_block(p_token,p_block_id);
  select * into saved from public.relationship_windsor_meta_ads_connections where workspace_id=block.workspace_id and source_session_block_id=block.id for update;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(block.workspace_id::text||':windsor-account:'||regexp_replace(p_account_id,'^act_',''),0));
  if exists(select 1 from public.relationship_windsor_meta_ads_connections where workspace_id=block.workspace_id and relationship_id<>saved.relationship_id and status='connected' and account_id in (regexp_replace(p_account_id,'^act_',''),'act_'||regexp_replace(p_account_id,'^act_',''))) then
    raise exception using errcode='P0001',message='This Meta account is already linked to another client';
  end if;
  result:=public.complete_windsor_meta_ads_onboarding(p_token,p_block_id,p_authorization_hash,p_account_id,p_account_name,p_datasource,p_integration_fingerprint);
  select coalesce(reporting_revision,id) into revision from public.relationship_windsor_meta_ads_connections where id=saved.id;
  update public.relationship_windsor_meta_ads_connections set reporting_verified_at=now(),reporting_grant_encrypted=saved.authorization_encrypted,
    last_report=p_report||jsonb_build_object('accountId',p_account_id,'accountName',p_account_name,'connectionRevision',revision),last_report_attempt_at=now(),last_report_error=null where id=saved.id;
  return result||jsonb_build_object('reportingVerified',true);
end;
$$;
revoke all on function public.complete_verified_windsor_meta_ads_onboarding(text,uuid,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.complete_verified_windsor_meta_ads_onboarding(text,uuid,text,text,text,text,text,jsonb) to service_role;
commit;
