-- Additive OAuth storage. Existing PIT/calendar reads keep their Vault path.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table client_portal_secure.ghl_oauth_attempts (
 state_hash text primary key check(state_hash ~ '^[a-f0-9]{64}$'),
 browser_hash text not null check(browser_hash ~ '^[a-f0-9]{64}$'),
 workspace_id uuid not null references public.workspaces(id),
 relationship_id uuid not null references public.relationships(id),
 user_id uuid not null references auth.users(id), workspace_slug text not null,
 expected_revision uuid, config_hash text not null,
 phase text not null default 'authorizing' check(phase in('authorizing','exchanging','ready','selecting','selected','connecting','done','failed')),
 credential_encrypted text check(octet_length(credential_encrypted)<=32768),
 choices jsonb not null default '[]' check(jsonb_typeof(choices)='array' and jsonb_array_length(choices)<=50 and octet_length(choices::text)<=32768),
 limited boolean not null default false, selected_location text,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '20 minutes'
);
create index ghl_oauth_attempts_relationship on client_portal_secure.ghl_oauth_attempts(workspace_id,relationship_id,created_at desc);
create index ghl_oauth_attempts_expired on client_portal_secure.ghl_oauth_attempts(expires_at);
create table client_portal_secure.ghl_oauth_credentials (
 relationship_id uuid primary key references client_portal_secure.ghl_connections(relationship_id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id), location_id text not null, app_id text not null, company_id text,
 credential_encrypted text not null check(octet_length(credential_encrypted)<=32768),
 access_hash text not null check(access_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz not null,
 status text not null default 'active' check(status in('active','refreshing','reconnect_required','revoked')),
 lease_token uuid, lease_until timestamptz, refreshed_at timestamptz not null default now(), last_error text
);
create index ghl_oauth_credentials_due on client_portal_secure.ghl_oauth_credentials(expires_at,relationship_id) where status in('active','refreshing');
create index ghl_oauth_credentials_location on client_portal_secure.ghl_oauth_credentials(app_id,location_id);
create index ghl_oauth_credentials_company on client_portal_secure.ghl_oauth_credentials(app_id,company_id,relationship_id);
alter table client_portal_secure.ghl_oauth_attempts enable row level security;
alter table client_portal_secure.ghl_oauth_credentials enable row level security;
revoke all on client_portal_secure.ghl_oauth_attempts,client_portal_secure.ghl_oauth_credentials from public,anon,authenticated,service_role;

create function public.ghl_oauth_connection(p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a client_portal_secure.ghl_oauth_attempts%rowtype; t client_portal_secure.ghl_oauth_credentials%rowtype;
 c client_portal_secure.ghl_connections%rowtype; result jsonb; access_result jsonb; item jsonb;
 secret_value text; op uuid; items jsonb:='[]'; bound integer;
begin
 if auth.role() is distinct from 'service_role' then return jsonb_build_object('failure','access'); end if;
 if jsonb_typeof(p_input) is distinct from 'object' then return jsonb_build_object('failure','input'); end if;
 if p_action='prepare' then
  access_result:=public.read_client_ghl_connections((p_input->>'workspaceId')::uuid,(p_input->>'userId')::uuid,(p_input->>'relationshipId')::uuid);
  select value into item from jsonb_array_elements(coalesce(access_result->'accounts','[]')) where value->>'relationshipId'=p_input->>'relationshipId' and not coalesce((value->>'archived')::boolean,false);
  if item is null then return jsonb_build_object('failure','access'); end if;
  if item->>'revision' is distinct from p_input->>'expectedRevision' then return jsonb_build_object('failure','changed'); end if;
  if not exists(select 1 from public.workspaces where id=(p_input->>'workspaceId')::uuid and slug=p_input->>'workspaceSlug') then return jsonb_build_object('failure','access'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ghl-oauth-prepare:'||(p_input->>'relationshipId'),0));
  if exists(select 1 from client_portal_secure.ghl_oauth_attempts where workspace_id=(p_input->>'workspaceId')::uuid and relationship_id=(p_input->>'relationshipId')::uuid and created_at>now()-interval '10 seconds') then return jsonb_build_object('failure','busy'); end if;
  update client_portal_secure.ghl_oauth_attempts set phase='failed',credential_encrypted=null where workspace_id=(p_input->>'workspaceId')::uuid and relationship_id=(p_input->>'relationshipId')::uuid and user_id=(p_input->>'userId')::uuid and phase not in('done','failed');
  insert into client_portal_secure.ghl_oauth_attempts(state_hash,browser_hash,workspace_id,relationship_id,user_id,workspace_slug,expected_revision,config_hash)
  values(p_input->>'stateHash',p_input->>'browserHash',(p_input->>'workspaceId')::uuid,(p_input->>'relationshipId')::uuid,(p_input->>'userId')::uuid,p_input->>'workspaceSlug',(p_input->>'expectedRevision')::uuid,p_input->>'configHash');
  return jsonb_build_object('accepted',true);
 elsif p_action in('read','transition','connect') then
  select * into a from client_portal_secure.ghl_oauth_attempts where state_hash=p_input->>'stateHash' and browser_hash=p_input->>'browserHash' and expires_at>now() for update;
  if a.state_hash is null or a.config_hash is distinct from p_input->>'configHash' then return jsonb_build_object('failure','expired'); end if;
  access_result:=public.read_client_ghl_connections(a.workspace_id,a.user_id,a.relationship_id);
  select value into item from jsonb_array_elements(coalesce(access_result->'accounts','[]')) where value->>'relationshipId'=a.relationship_id::text and not coalesce((value->>'archived')::boolean,false);
  if item is null then return jsonb_build_object('failure','access'); end if;
  if a.phase<>'done' and (item->>'revision')::uuid is distinct from a.expected_revision then return jsonb_build_object('failure','changed'); end if;
  if p_action='read' then return to_jsonb(a)-'browser_hash'-'config_hash'; end if;
  if a.user_id is distinct from (p_input->>'userId')::uuid then return jsonb_build_object('failure','access'); end if;
  if p_action='transition' then
   if a.phase is distinct from p_input->>'from' or not (
    (a.phase='authorizing' and p_input->>'to'='exchanging') or (a.phase='exchanging' and p_input->>'to'='ready') or
    (a.phase='ready' and p_input->>'to'='selecting') or (a.phase='selecting' and p_input->>'to'='selected') or
    (a.phase='selected' and p_input->>'to'='connecting') or (a.phase not in('done','failed') and p_input->>'to'='failed')
   ) then return jsonb_build_object('failure','phase'); end if;
   update client_portal_secure.ghl_oauth_attempts set phase=p_input->>'to',
    credential_encrypted=case when p_input->>'to'='failed' then null else coalesce(p_input->>'credential',credential_encrypted) end,
    choices=coalesce(p_input->'choices',choices),limited=coalesce((p_input->>'limited')::boolean,limited),selected_location=coalesce(p_input->>'locationId',selected_location)
   where state_hash=a.state_hash;
   return jsonb_build_object('accepted',true);
  end if;
  if a.phase='done' then return jsonb_build_object('connected',true,'revision',(select calendar_revision from client_portal_secure.ghl_connections where relationship_id=a.relationship_id)); end if;
  if a.phase<>'connecting' or a.selected_location is distinct from p_input->>'locationId' then return jsonb_build_object('failure','phase'); end if;
  if nullif(p_input->>'credential','') is null or length(p_input->>'credential')>32768 or p_input->>'accessToken' is null or length(p_input->>'accessToken') not between 20 and 4096 or p_input->>'expiresAt' is null or (p_input->>'expiresAt')::timestamptz<=now()+interval '5 minutes' then return jsonb_build_object('failure','credentials'); end if;
  op:=gen_random_uuid();
  result:=public.manage_client_ghl_connection_v2(a.workspace_id,a.user_id,'begin_connect',p_relationship_id=>a.relationship_id,p_operation_id=>op,p_expected_revision=>a.expected_revision);
  if result ? 'failure' then return result; end if;
  result:=public.manage_client_ghl_connection_v2(a.workspace_id,a.user_id,'finish',p_relationship_id=>a.relationship_id,p_operation_id=>op,
   p_account_type=>p_input->>'accountType',p_location_id=>a.selected_location,p_private_token=>p_input->>'accessToken',p_location_name=>p_input->>'locationName',p_metrics=>p_input->'metrics',p_calendar_id=>p_input->>'calendarId',p_calendar_name=>p_input->>'calendarName');
  if result ? 'failure' then
   perform public.manage_client_ghl_connection_v2(a.workspace_id,a.user_id,'fail',p_relationship_id=>a.relationship_id,p_operation_id=>op,p_error=>'unavailable'); return result;
  end if;
  insert into client_portal_secure.ghl_oauth_credentials(relationship_id,workspace_id,location_id,app_id,company_id,credential_encrypted,access_hash,expires_at)
   values(a.relationship_id,a.workspace_id,a.selected_location,p_input->>'appId',p_input->>'companyId',p_input->>'credential',encode(extensions.digest(p_input->>'accessToken','sha256'),'hex'),(p_input->>'expiresAt')::timestamptz)
  on conflict(relationship_id) do update set location_id=excluded.location_id,app_id=excluded.app_id,company_id=excluded.company_id,credential_encrypted=excluded.credential_encrypted,access_hash=excluded.access_hash,expires_at=excluded.expires_at,status='active',lease_token=null,lease_until=null,refreshed_at=now(),last_error=null;
  update client_portal_secure.ghl_oauth_attempts set phase='done',credential_encrypted=null,choices='[]' where state_hash=a.state_hash;
  return jsonb_build_object('connected',true,'revision',(select calendar_revision from client_portal_secure.ghl_connections where relationship_id=a.relationship_id));
 elsif p_action='claim_refresh' then
  bound:=greatest(1,least(coalesce((p_input->>'limit')::integer,5),5));
  -- Expired unfinished grants are never retained indefinitely. Each pass is bounded.
  delete from client_portal_secure.ghl_oauth_attempts where state_hash in(select state_hash from client_portal_secure.ghl_oauth_attempts where expires_at<=now() order by expires_at limit 100);
  for t in select g.* from client_portal_secure.ghl_oauth_credentials g where (g.status='active' or (g.status='refreshing' and g.lease_until<=now())) and g.expires_at<=now()+interval '2 hours' and g.app_id=p_input->>'appId'
   and exists(select 1 from public.workspaces w join public.relationships r on r.workspace_id=w.id where w.id=g.workspace_id and r.id=g.relationship_id and w.status='active' and r.status<>'archived')
   order by g.expires_at,g.relationship_id limit bound for update of g skip locked loop
   if t.status='refreshing' then
    if t.lease_until<=now() then update client_portal_secure.ghl_oauth_credentials set status='reconnect_required',last_error='refresh_acknowledgement_unknown' where relationship_id=t.relationship_id; end if; continue;
   end if;
   select * into c from client_portal_secure.ghl_connections where relationship_id=t.relationship_id and workspace_id=t.workspace_id;
   select decrypted_secret into secret_value from vault.decrypted_secrets where id=c.vault_secret_id;
   if c.location_id is distinct from t.location_id or encode(extensions.digest(secret_value,'sha256'),'hex') is distinct from t.access_hash then
    update client_portal_secure.ghl_oauth_credentials set status='revoked',last_error='credential_replaced' where relationship_id=t.relationship_id; continue;
   end if;
   if not exists(select 1 from public.workspaces w join public.relationships r on r.workspace_id=w.id where w.id=t.workspace_id and r.id=t.relationship_id and w.status='active' and r.status<>'archived') then continue; end if;
   update client_portal_secure.ghl_oauth_credentials set status='refreshing',lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds' where relationship_id=t.relationship_id returning * into t;
   items:=items||jsonb_build_array(to_jsonb(t));
  end loop;
  return jsonb_build_object('items',items);
 elsif p_action='finish_refresh' then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-ghl:'||(p_input->>'relationshipId'),0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-ghl:'||(p_input->>'relationshipId'),0));
  select * into t from client_portal_secure.ghl_oauth_credentials where relationship_id=(p_input->>'relationshipId')::uuid for update;
  if t.status is distinct from 'refreshing' or t.lease_token is distinct from (p_input->>'leaseToken')::uuid or t.lease_until<=now() then return jsonb_build_object('failure','lease'); end if;
  if p_input->>'outcome'='failed' then
   update client_portal_secure.ghl_oauth_credentials set status='reconnect_required',last_error='refresh_failed',lease_token=null,lease_until=null where relationship_id=t.relationship_id; return jsonb_build_object('accepted',true);
  end if;
  select * into c from client_portal_secure.ghl_connections where relationship_id=t.relationship_id and workspace_id=t.workspace_id;
  select decrypted_secret into secret_value from vault.decrypted_secrets where id=c.vault_secret_id;
  if c.location_id is distinct from t.location_id or encode(extensions.digest(secret_value,'sha256'),'hex') is distinct from t.access_hash or t.location_id is distinct from p_input->>'locationId' then return jsonb_build_object('failure','changed'); end if;
  if p_input->>'accessToken' is null or length(p_input->>'accessToken') not between 20 and 4096 or nullif(p_input->>'credential','') is null or p_input->>'expiresAt' is null or (p_input->>'expiresAt')::timestamptz<=now()+interval '5 minutes' then return jsonb_build_object('failure','credentials'); end if;
  perform vault.update_secret(c.vault_secret_id,p_input->>'accessToken');
  update client_portal_secure.ghl_oauth_credentials set credential_encrypted=p_input->>'credential',access_hash=encode(extensions.digest(p_input->>'accessToken','sha256'),'hex'),expires_at=(p_input->>'expiresAt')::timestamptz,status='active',lease_token=null,lease_until=null,last_error=null,refreshed_at=now() where relationship_id=t.relationship_id;
  return jsonb_build_object('accepted',true);
 end if;
 return jsonb_build_object('failure','action');
end $$;
revoke all on function public.ghl_oauth_connection(text,jsonb) from public,anon,authenticated;
grant execute on function public.ghl_oauth_connection(text,jsonb) to service_role;
commit;
