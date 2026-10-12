-- Free relationship-level GHL connections. No sale, service, session or credential rewrite.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Retain the current secret, lease, staff-grant and service-transfer implementation.
-- Owners/admins can additionally connect clients during onboarding or retention.
do $migration$
declare definition text; old_text text; new_text text; list_start integer; list_end integer; list_body text; scoped_body text; owner_start integer; owner_end integer; owner_branch text; from_start integer; from_end integer;
begin
 definition:=pg_get_functiondef('public.manage_client_ghl_connection(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text)'::regprocedure);
 old_text:=$old$with eligible as (
                select instance.relationship_id from public.relationship_service_instances instance
                join public.onboarding_service_revisions revision on revision.workspace_id=instance.workspace_id and revision.id=instance.service_revision_id
                where instance.workspace_id=p_workspace_id and instance.import_id is null and instance.disposition <> 'cancelled'
                  and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'
                union
                select service.relationship_id from public.relationship_services service
                join public.onboarding_service_revisions revision on revision.workspace_id=service.workspace_id and revision.id=service.service_revision_id
                where service.workspace_id=p_workspace_id
                  and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'
            )$old$;
 new_text:=$new$with eligible as (
                select client.id,client.primary_person_name,client.business_name
                from public.relationships client
                where client.workspace_id=p_workspace_id and client.status<>'archived'
                  and (client.lifecycle_phase in ('onboarding','retention') or client.id in (
                select instance.relationship_id from public.relationship_service_instances instance
                where instance.workspace_id=p_workspace_id and instance.import_id is null
                  and instance.disposition='active' and instance.stage in ('onboarding','setup','maintenance')
                union all
                select instance.relationship_id from public.relationship_service_instances instance
                join public.onboarding_service_revisions revision on revision.workspace_id=instance.workspace_id and revision.id=instance.service_revision_id
                where instance.workspace_id=p_workspace_id and instance.import_id is null and instance.disposition<>'cancelled'
                  and not (instance.disposition='active' and instance.stage in ('onboarding','setup','maintenance'))
                  and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'
                union all
                select service.relationship_id from public.relationship_services service
                join public.onboarding_service_revisions revision on revision.workspace_id=service.workspace_id and revision.id=service.service_revision_id
                where service.workspace_id=p_workspace_id
                  and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting') or exists (
                    select 1 from client_portal_secure.ghl_connections saved
                    where saved.relationship_id=client.id and saved.workspace_id=p_workspace_id and saved.vault_secret_id is not null
                  ))
                limit 1001
            )$new$;
 if position(old_text in definition)=0 or position('if p_action = ''list'' and v_role not in' in definition)=0 then
  raise exception 'Unexpected client connection eligibility; review before installing';
 end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old$    if not exists (
        select 1 from (
            select instance.relationship_id$old$;
 new_text:=$new$    if not (v_role in ('owner','admin') and exists (
        select 1 from public.relationships client
        where client.workspace_id=p_workspace_id and client.id=p_relationship_id
          and client.status<>'archived' and (client.lifecycle_phase in ('onboarding','retention') or exists (
            select 1 from public.relationship_service_instances enrolled
            where enrolled.workspace_id=p_workspace_id and enrolled.relationship_id=client.id
              and enrolled.import_id is null and enrolled.disposition='active'
              and enrolled.stage in ('onboarding','setup','maintenance')
          ) or exists (
            select 1 from client_portal_secure.ghl_connections saved
            where saved.relationship_id=client.id and saved.workspace_id=p_workspace_id and saved.vault_secret_id is not null
          ))
    )) and not exists (
        select 1 from (
            select instance.relationship_id$new$;
 if position(old_text in definition)=0 then raise exception 'Unexpected client connection command eligibility'; end if;
 definition:=replace(definition,old_text,new_text);
 old_text:=$old$    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-ghl:'||p_relationship_id::text,0));$old$;
 if position(old_text in definition)=0 then raise exception 'Unexpected client connection lock'; end if;
 definition:=replace(definition,old_text,$new$    if not exists(select 1 from public.relationships client
        where client.workspace_id=p_workspace_id and client.id=p_relationship_id and client.status<>'archived')
    then return jsonb_build_object('failure','access'); end if;
$new$||old_text);
 -- Bound only the broadened owner list; preserve the existing staff list body.
 definition:=replace(definition,'    permitted boolean;','    permitted boolean;
    v_accounts jsonb;');
 owner_start:=position('    if p_action = ''list'' then' in definition);
 owner_end:=position('    if p_relationship_id is null' in definition);
 owner_branch:=substring(definition from owner_start for owner_end-owner_start);
 owner_branch:=replace(owner_branch,'        return coalesce((', '        v_accounts := coalesce((');
 owner_branch:=replace(owner_branch,$old$        ), '[]'::jsonb);$old$,$new$        ), '[]'::jsonb);
        if jsonb_array_length(v_accounts)>1000 then return jsonb_build_object('failure','list_limit'); end if;
        return v_accounts;$new$);
 definition:=substring(definition from 1 for owner_start-1)||owner_branch||substring(definition from owner_end);
 -- Owner eligibility already contains the bounded relationship projection.
 -- Avoid joining the relationship table a second time; staff keep indexed grants.
 owner_start:=position('    if p_action = ''list'' then' in definition);
 owner_end:=position('    if p_relationship_id is null' in definition);
 if owner_start=0 or owner_end<=owner_start then raise exception 'Unexpected owner list boundary'; end if;
 owner_branch:=substring(definition from owner_start for owner_end-owner_start);
 from_start:=position('            from eligible' in owner_branch);
 from_end:=position('            left join client_portal_secure' in owner_branch);
 if from_start=0 or from_end<=from_start then raise exception 'Unexpected owner list source'; end if;
 definition:=substring(definition from 1 for owner_start-1)
   ||substring(owner_branch from 1 for from_start-1)||E'            from eligible relationship\n'
   ||substring(owner_branch from from_end)||substring(definition from owner_end);
 -- Keep full-list query plans free of nullable target predicates. Targeted
 -- checks use separate, equality-scoped copies of the same actor policy.
 list_start:=position('    if p_action = ''list'' and v_role not in' in definition);
 list_end:=position('    if p_relationship_id is null' in definition);
 list_body:=substring(definition from list_start for list_end-list_start);
 scoped_body:=replace(list_body,'instance.workspace_id=p_workspace_id and',
  'instance.workspace_id=p_workspace_id and instance.relationship_id=p_relationship_id and');
 scoped_body:=replace(scoped_body,'where service.workspace_id=p_workspace_id',
  'where service.workspace_id=p_workspace_id and service.relationship_id=p_relationship_id');
 scoped_body:=replace(scoped_body,'assignment.workspace_id=p_workspace_id and',
  'assignment.workspace_id=p_workspace_id and assignment.relationship_id=p_relationship_id and');
 scoped_body:=replace(scoped_body,'client.workspace_id=p_workspace_id and',
  'client.workspace_id=p_workspace_id and client.id=p_relationship_id and');
 definition:=substring(definition from 1 for list_start-1)
  ||E'    if p_relationship_id is not null then\n'||scoped_body||E'    end if;\n'
  ||substring(definition from list_start);
 execute definition;

 definition:=pg_get_functiondef('public.manage_client_ghl_connection_v2(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text,uuid,text,text)'::regprocedure);
 old_text:=$old$items:=public.manage_client_ghl_connection(p_workspace_id,p_user_id,'list');$old$;
 if position(old_text in definition)=0 then raise exception 'Unexpected calendar controls authorization'; end if;
 execute replace(definition,old_text,$new$items:=public.manage_client_ghl_connection(p_workspace_id,p_user_id,'list',p_relationship_id);$new$);
end;
$migration$;

-- Read the connection in the existing session query. Only service_role may call
-- this RPC; all output stays on the same validated portal session/relationship.
do $migration$
declare definition text; old_text text;
begin
 definition:=pg_get_functiondef('public.client_portal_overview(text,uuid)'::regprocedure);
 definition:=replace(definition,'portal public.client_portal_sessions%rowtype;','portal record;');
 definition:=replace(definition,'LANGUAGE plpgsql','LANGUAGE plpgsql SECURITY DEFINER');
 definition:=replace(definition,'SET search_path TO ''public''','SET search_path TO ''''');
 definition:=replace(definition,$old$if current_user <> 'service_role' then return null; end if;$old$,$new$if auth.role() is distinct from 'service_role' then return null; end if;$new$);
 old_text:=$old$    select * into portal from public.client_portal_sessions
    where workspace_id = p_workspace_id and session_token = lower(p_token)
      and status = 'active' and token_revoked_at is null;$old$;
 if position(old_text in definition)=0 then raise exception 'Unexpected portal session read'; end if;
 definition:=replace(definition,old_text,$new$    select session.*, connection.vault_secret_id is not null as ghl_connected
    into portal from public.client_portal_sessions session
    left join client_portal_secure.ghl_connections connection
      on connection.relationship_id=session.relationship_id and connection.workspace_id=session.workspace_id
    where session.workspace_id=p_workspace_id and session.session_token=lower(p_token)
      and session.status='active' and session.token_revoked_at is null;$new$);
 old_text:=$old$when portal.onboarding_session_id is null then 'ghl'$old$;
 if position(old_text in definition)=0 then raise exception 'Unexpected portal lead selection'; end if;
 execute replace(definition,old_text,$new$when portal.ghl_connected then 'ghl'$new$);
end;
$migration$;
notify pgrst,'reload schema';
commit;
