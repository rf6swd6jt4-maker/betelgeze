-- Private document text is extracted once at upload and snapshotted for generation.
create table public.relationship_context_assets (
 asset_id uuid primary key references public.assets(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 relationship_id uuid not null references public.relationships(id) on delete cascade,
 title text not null, description text not null default '', content_type text not null,
 file_size bigint not null, storage_path text not null, source_hash text not null,
 document_text text not null check(length(document_text) between 10 and 65000),
 extractor_version text not null default 'relationship-text-v1',
 created_at timestamptz not null default now(), detached_at timestamptz
);
create index relationship_context_assets_active on public.relationship_context_assets(workspace_id,relationship_id,created_at) where detached_at is null;
alter table public.relationship_context_assets enable row level security;
revoke all on public.relationship_context_assets from public,anon,authenticated;
grant select,insert,update,delete on public.relationship_context_assets to service_role;

create function public.assert_relationship_context_editor(p_workspace uuid,p_relationship uuid,p_actor uuid) returns void
language plpgsql set search_path=public as $$
declare r relationships; role text;
begin
 if current_user<>'service_role' then raise exception 'Trusted runtime required'; end if;
 select * into r from relationships where workspace_id=p_workspace and id=p_relationship for update;
 if not found or r.status='archived' or not exists(select 1 from workspaces where id=p_workspace and status='active') then raise exception 'Relationship is unavailable'; end if;
 if workspace_user_can_access_relationship(p_workspace,p_relationship,p_actor) is not true then raise exception 'Relationship access required'; end if;
 role:=workspace_role_for_user(p_workspace,p_actor);
 if role is null or (role not in ('owner','admin') and r.seller_user_id is distinct from p_actor and r.fulfilment_manager_user_id is distinct from p_actor and (r.pos_started_at is not null or workspace_user_can_sell(p_workspace,p_actor) is not true)) then raise exception 'Only the relationship seller, manager or an admin can change assets'; end if;
end $$;

create function public.attach_relationship_context_asset(p_workspace uuid,p_relationship uuid,p_actor uuid,p_asset uuid,p_title text,p_description text,p_type text,p_size bigint,p_path text,p_hash text,p_text text) returns uuid
language plpgsql set search_path=public as $$
declare existing relationship_context_assets;
begin
 perform assert_relationship_context_editor(p_workspace,p_relationship,p_actor);
 select * into existing from relationship_context_assets where asset_id=p_asset;
 if found then
  if existing.workspace_id<>p_workspace or existing.relationship_id<>p_relationship or existing.source_hash<>p_hash or existing.detached_at is not null then raise exception 'Upload identity changed or was removed'; end if;
  return p_asset;
 end if;
 if p_title is null or length(p_title) not between 1 and 240 or p_description is null or length(p_description)>5000 or p_text is null or length(p_text) not between 10 and 65000 or p_size is null or p_size not between 1 and 20971520 or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_path is distinct from p_workspace||'/relationship-context/'||p_relationship||'/'||p_asset||'/'||p_hash||'/original' or p_type not in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','text/markdown','text/csv') then raise exception 'Invalid relationship document'; end if;
 if (select count(*) from relationship_context_assets where workspace_id=p_workspace and relationship_id=p_relationship and detached_at is null)>=20 then raise exception 'This relationship already has 20 context documents; remove outdated files first'; end if;
 if (select coalesce(sum(length(document_text)),0) from relationship_context_assets where workspace_id=p_workspace and relationship_id=p_relationship and detached_at is null)+length(p_text)>100000 then raise exception 'Combined context exceeds 100,000 characters; shorten or remove outdated documents'; end if;
 insert into assets(id,workspace_id,title,description,asset_kind,source_kind,storage_path,content_type,file_size,native_kind,created_by)
 values(p_asset,p_workspace,p_title,p_description,'document','upload',p_path,p_type,p_size,'relationship_context',p_actor);
 insert into asset_relationships(workspace_id,relationship_id,asset_id) values(p_workspace,p_relationship,p_asset);
 insert into relationship_context_assets(asset_id,workspace_id,relationship_id,title,description,content_type,file_size,storage_path,source_hash,document_text)
 values(p_asset,p_workspace,p_relationship,p_title,p_description,p_type,p_size,p_path,p_hash,p_text);
 return p_asset;
end $$;

create function public.edit_relationship_context_asset(p_workspace uuid,p_relationship uuid,p_actor uuid,p_asset uuid,p_description text,p_remove boolean default false,p_expected_description text default null) returns void
language plpgsql set search_path=public as $$
declare a relationship_context_assets;
begin
 perform assert_relationship_context_editor(p_workspace,p_relationship,p_actor);
 select * into a from relationship_context_assets where workspace_id=p_workspace and relationship_id=p_relationship and asset_id=p_asset for update;
 if not found then raise exception 'Asset not found'; end if;
 if a.detached_at is not null and p_remove then return; end if;
 if a.detached_at is not null then raise exception 'This asset was removed'; end if;
 if p_expected_description is distinct from a.description then raise exception 'Asset description changed; reload the assets before editing'; end if;
 if p_description is null or length(p_description)>5000 then raise exception 'Keep the description under 5,000 characters'; end if;
 update relationship_context_assets set description=p_description,detached_at=case when p_remove then now() else null end where asset_id=p_asset;
 -- Detaching stops future context use, retaining the original and prior run evidence.
 if not p_remove then update assets set description=p_description where id=p_asset and workspace_id=p_workspace; end if;
end $$;
revoke all on function public.assert_relationship_context_editor(uuid,uuid,uuid),public.attach_relationship_context_asset(uuid,uuid,uuid,uuid,text,text,text,bigint,text,text,text),public.edit_relationship_context_asset(uuid,uuid,uuid,uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.assert_relationship_context_editor(uuid,uuid,uuid),public.attach_relationship_context_asset(uuid,uuid,uuid,uuid,text,text,text,bigint,text,text,text),public.edit_relationship_context_asset(uuid,uuid,uuid,uuid,text,boolean,text) to service_role;

create or replace function public.sop_work_evidence(p_workspace uuid,p_relationship uuid,p_session uuid,p_service text) returns jsonb
language plpgsql set search_path=public as $$
declare result jsonb; profile jsonb; documents jsonb;
begin
 -- The parent row serializes context changes with the publication evidence check.
 perform 1 from relationships where workspace_id=p_workspace and id=p_relationship for share;
 select jsonb_build_object('mode','relationship_context_v1','service',jsonb_build_object('id',s.service_id,'revision_id',s.service_revision_id,'name',coalesce(v.name,s.service_key),'assignee',s.assignee_user_id))
 into result from sop_generation_instance(p_workspace,p_relationship,p_service::uuid) s left join onboarding_service_revisions v on v.id=s.service_revision_id and v.workspace_id=s.workspace_id
 where s.workspace_id=p_workspace and s.relationship_id=p_relationship and s.id=p_service::uuid;
 if result is null then raise exception 'Service information is unavailable.'; end if;
 select jsonb_build_object('name',primary_person_name,'company',business_name,'industry',industry_value,'website',website_url,'location',location_value,'contact_role',primary_contact_role,'description',notes_summary) into profile from relationships where workspace_id=p_workspace and id=p_relationship;
 select coalesce(jsonb_agg(jsonb_build_object('id',asset_id,'title',title,'document_text',document_text,'description',description,'source_hash',source_hash,'extractor_version',extractor_version) order by asset_id),'[]'::jsonb) into documents from relationship_context_assets where workspace_id=p_workspace and relationship_id=p_relationship and detached_at is null;
 result:=result||jsonb_build_object('client_context',jsonb_build_object('documents',documents,'relationship',profile));
 if octet_length(result::text)>600000 then raise exception 'Relationship context is too large; shorten descriptions or documents'; end if;
 return result;
end $$;

-- Removed context documents cannot be selected as new work attachments either.
do $$declare def text; begin
 select pg_get_functiondef('public.sop_work_asset_allowed(uuid,uuid)'::regprocedure) into def;
 if position('a.id<>r.asset_id' in def)=0 then raise exception 'Unexpected asset permission function'; end if;
 execute replace(def,'a.id<>r.asset_id', 'a.id<>r.asset_id and not exists(select 1 from relationship_context_assets c where c.asset_id=a.id and c.detached_at is not null)');
 select pg_get_functiondef('public.publish_sop_work(uuid,uuid)'::regprocedure) into def;
 if position(' select * into intent from sop_service_intents' in def)=0 then raise exception 'Unexpected publication wrapper'; end if;
 execute replace(def,' select * into intent from sop_service_intents',' perform 1 from relationships where workspace_id=job.workspace_id and id=job.relationship_id for update; select * into intent from sop_service_intents');
 select pg_get_functiondef('public.prepare_sop_work(uuid,uuid)'::regprocedure) into def;
 execute replace(def,'Service information changed after generation began. No work was published.', 'Client context or service changed during generation; retry with the latest saved information. No work was published.');
end $$;
