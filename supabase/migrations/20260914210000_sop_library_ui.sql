-- SOP-level service assignment, independent autosave, and one main source per SOP.
begin;
create function public.save_sop_text(p_workspace uuid,p_actor uuid,p_sop uuid,p_field text,p_value text,p_baseline text) returns jsonb
language plpgsql set search_path=public as $$
declare saved sops;
begin
 perform assert_sop_admin(p_workspace,p_actor);
 if p_field not in ('title','description') or p_field is null or p_value is null or p_baseline is null
 or (p_field='title' and length(trim(p_value)) not between 1 and 200)
 or (p_field='description' and length(p_value)>5000) then raise exception 'Check the SOP name and description.'; end if;
 if p_field='title' then
  update sops set title=trim(p_value),version=version+1,updated_at=clock_timestamp()
  where workspace_id=p_workspace and id=p_sop and archived_at is null and title=p_baseline returning * into saved;
 else
  update sops set description=trim(p_value),version=version+1,updated_at=clock_timestamp()
  where workspace_id=p_workspace and id=p_sop and archived_at is null and coalesce(description,'')=p_baseline returning * into saved;
 end if;
 if saved.id is null then return null; end if;
 return jsonb_build_object('version',saved.updated_at,'recordVersion',saved.version);
end $$;
create function public.set_sop_main_asset(p_workspace uuid,p_actor uuid,p_sop uuid,p_asset uuid) returns void
language plpgsql set search_path=public as $$
begin
 perform assert_sop_admin(p_workspace,p_actor);
 perform 1 from sops where workspace_id=p_workspace and id=p_sop and archived_at is null for update;
 if not found then raise exception 'This SOP is unavailable or archived.'; end if;
 if not exists(select 1 from sop_assets s join assets a on a.workspace_id=s.workspace_id and a.id=s.asset_id
 where s.workspace_id=p_workspace and s.sop_id=p_sop and s.asset_id=p_asset and a.file_size<=20971520
 and a.content_type not like 'video/%' and a.content_type not like 'audio/%') then raise exception 'Choose a readable procedure file from this SOP.'; end if;
 update sop_assets set role='reference' where workspace_id=p_workspace and sop_id=p_sop and role='main' and asset_id<>p_asset;
 update sop_assets set role='main' where workspace_id=p_workspace and sop_id=p_sop and asset_id=p_asset;
 update sop_service_sources set asset_id=p_asset,updated_at=now() where workspace_id=p_workspace and sop_id=p_sop;
 update sops set version=version+1,updated_at=clock_timestamp() where workspace_id=p_workspace and id=p_sop;
end $$;
create function public.assign_sop_service(p_workspace uuid,p_actor uuid,p_sop uuid,p_service uuid,p_remove boolean) returns void
language plpgsql set search_path=public as $$
declare source_id uuid; candidates uuid[];
begin
 perform assert_sop_admin(p_workspace,p_actor);
 perform 1 from sops where workspace_id=p_workspace and id=p_sop and archived_at is null for update;
 if not found then raise exception 'This SOP is unavailable or archived.'; end if;
 if p_remove then
  -- Removing an assignment does not remove existing client work or its evidence.
  update sop_service_sources set enabled=false,updated_at=now() where workspace_id=p_workspace and sop_id=p_sop and service_id=p_service;
  return;
 end if;
 select array_agg(asset_id) into candidates from sop_assets where workspace_id=p_workspace and sop_id=p_sop and role='main';
 if cardinality(candidates)=1 then source_id:=candidates[1];
 elsif coalesce(cardinality(candidates),0)=0 then
  select array_agg(s.asset_id) into candidates from sop_assets s join assets a on a.workspace_id=s.workspace_id and a.id=s.asset_id
   where s.workspace_id=p_workspace and s.sop_id=p_sop and a.file_size<=20971520 and a.content_type not like 'video/%' and a.content_type not like 'audio/%';
  if cardinality(candidates)=1 then
   source_id:=candidates[1]; perform set_sop_main_asset(p_workspace,p_actor,p_sop,source_id);
  end if;
 end if;
 if source_id is null then raise exception 'Add a procedure file to this SOP. If there are several, choose Use as main procedure on its card.'; end if;
 perform link_sop_service(p_workspace,p_actor,p_sop,p_service,source_id,false);
end $$;
revoke all on function public.save_sop_text(uuid,uuid,uuid,text,text,text),public.set_sop_main_asset(uuid,uuid,uuid,uuid),public.assign_sop_service(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.save_sop_text(uuid,uuid,uuid,text,text,text),public.set_sop_main_asset(uuid,uuid,uuid,uuid),public.assign_sop_service(uuid,uuid,uuid,uuid,boolean) to service_role;
create or replace function public.attach_sop_upload(p_workspace uuid,p_actor uuid,p_sop uuid,p_asset uuid,p_title text,p_type text,p_size bigint,p_path text,p_role text,p_notes text) returns uuid
language plpgsql set search_path=public as $$
begin
    perform assert_sop_admin(p_workspace,p_actor);
    perform 1 from sops where workspace_id=p_workspace and id=p_sop and archived_at is null for update;
    if not found then raise exception 'This SOP is unavailable or archived.'; end if;
    if exists(select 1 from sop_assets where asset_id=p_asset and workspace_id=p_workspace and sop_id=p_sop) then return p_asset; end if;
    if p_path !~ ('^'||p_workspace::text||'/sops/'||p_sop::text||'/assets/'||p_asset::text||'/[a-f0-9]{64}/original$') then raise exception 'Invalid SOP asset path.'; end if;
    if p_size<=0 or p_size>262144000 then raise exception 'Invalid file size.'; end if;
    insert into assets(id,workspace_id,title,asset_kind,source_kind,native_kind,native_id,storage_path,content_type,file_size,created_by)
      values(p_asset,p_workspace,p_title,case when p_type ~ '^(image|video|audio)/' then 'media' else 'document' end,'upload','sop_asset',p_asset,p_path,p_type,p_size,p_actor);
    insert into sop_assets(asset_id,sop_id,workspace_id,role,notes) values(p_asset,p_sop,p_workspace,p_role,p_notes);
    if p_role='main' and p_size<=20971520 and p_type not like 'video/%' and p_type not like 'audio/%' then
      perform set_sop_main_asset(p_workspace,p_actor,p_sop,p_asset);
    else
      update sops set version=version+1,updated_at=now() where id=p_sop;
    end if;
    return p_asset;
end $$;

notify pgrst,'reload schema';
commit;
