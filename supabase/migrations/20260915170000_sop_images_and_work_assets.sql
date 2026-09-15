begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table public.sop_asset_extractions (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),sop_id uuid not null references sops(id),asset_id uuid not null references assets(id),
 extractor_version text not null default 'sop-images-v1',source_path text not null,source_hash text,requested_by uuid not null,
 status text not null default 'queued' check(status in ('queued','running','ready','failed')),attempts integer not null default 0,
 lease_token uuid,lease_until timestamptz,warnings jsonb not null default '[]',error_summary text,image_count integer not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(asset_id,extractor_version)
);
create index sop_extraction_pending on sop_asset_extractions(created_at) where status in ('queued','running');
create table public.sop_extracted_images (
 asset_id uuid primary key references assets(id),workspace_id uuid not null references workspaces(id),sop_id uuid not null references sops(id),
 extraction_id uuid not null references sop_asset_extractions(id),source_asset_id uuid not null references assets(id),ordinal integer not null,
 location text not null,context text not null,method text not null,content_hash text not null,width integer not null,height integer not null,attachable boolean not null default false,
 unique(extraction_id,ordinal)
);
create index sop_images_source on sop_extracted_images(workspace_id,source_asset_id,ordinal);
alter table public.sop_asset_extractions enable row level security;
alter table public.sop_extracted_images enable row level security;
revoke all on sop_asset_extractions,sop_extracted_images from public,anon,authenticated;
grant all on sop_asset_extractions,sop_extracted_images to service_role;
alter table public.sop_work_runs add column asset_candidates jsonb;

create function public.queue_sop_extraction(p_workspace uuid,p_actor uuid,p_sop uuid,p_asset uuid,p_retry boolean default false) returns uuid
language plpgsql security definer set search_path=public as $$
declare a assets; j sop_asset_extractions;
begin
 perform assert_sop_admin(p_workspace,p_actor);
 select f.* into a from assets f join sop_assets l on l.asset_id=f.id and l.workspace_id=f.workspace_id join sops s on s.id=l.sop_id and s.workspace_id=l.workspace_id
 where f.workspace_id=p_workspace and f.id=p_asset and l.sop_id=p_sop and s.archived_at is null;
 if not found then raise exception 'SOP asset unavailable.';end if;
 if a.content_type not in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document') then return null;end if;
 if a.file_size>20971520 then raise exception 'Extraction supports documents up to 20 MB.';end if;
 insert into sop_asset_extractions(workspace_id,sop_id,asset_id,source_path,requested_by) values(p_workspace,p_sop,p_asset,a.storage_path,p_actor) on conflict do nothing;
 select * into j from sop_asset_extractions where asset_id=p_asset and extractor_version='sop-images-v1' for update;
 if j.source_path<>a.storage_path then raise exception 'The original file changed. Upload it as a new SOP asset.';end if;
 if p_retry and j.status='failed' then
  if j.attempts>=3 then raise exception 'Three extraction attempts were used. Check or split the original file.';end if;
  update sop_asset_extractions set status='queued',requested_by=p_actor,error_summary=null,updated_at=now() where id=j.id;
 end if;
 return j.id;
end $$;
create function public.queue_uploaded_sop_images() returns trigger language plpgsql security definer set search_path=public as $$
declare a assets;
begin select * into a from assets where workspace_id=new.workspace_id and id=new.asset_id;
 if a.content_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document') and a.file_size<=20971520 and a.created_by is not null then
 insert into sop_asset_extractions(workspace_id,sop_id,asset_id,source_path,requested_by) values(new.workspace_id,new.sop_id,new.asset_id,a.storage_path,a.created_by) on conflict do nothing;
 end if;return null;end $$;
create trigger sop_images_on_upload after insert on sop_assets for each row execute function queue_uploaded_sop_images();

create function public.claim_sop_extraction(p_id uuid default null) returns setof sop_asset_extractions language plpgsql security definer set search_path=public as $$
begin
 update sop_asset_extractions set status=case when attempts<3 then 'queued' else 'failed' end,error_summary='Extraction interrupted; original file is retained.',lease_token=null,lease_until=null where status='running' and lease_until<now();
 return query with candidate as(select id from sop_asset_extractions where status='queued' and attempts<3 and (p_id is null or id=p_id) order by created_at,id limit 1 for update skip locked)
 update sop_asset_extractions j set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',updated_at=now() from candidate c where j.id=c.id returning j.*;
end $$;
create function public.finish_sop_extraction(p_id uuid,p_lease uuid,p_hash text,p_images jsonb,p_warnings jsonb,p_error text default null) returns boolean
language plpgsql security definer set search_path=public as $$
declare j sop_asset_extractions; v jsonb; image_id uuid; path text;
begin
 select * into j from sop_asset_extractions where id=p_id and status='running' and lease_token=p_lease and lease_until>now() for update;
 if not found then return false;end if;
 if p_error is not null then update sop_asset_extractions set status='failed',error_summary=left(p_error,500),lease_token=null,lease_until=null,updated_at=now() where id=j.id;return true;end if;
 perform assert_sop_admin(j.workspace_id,j.requested_by);
 if not exists(select 1 from sop_assets l join assets a on a.id=l.asset_id and a.workspace_id=l.workspace_id join sops s on s.id=l.sop_id and s.workspace_id=l.workspace_id where l.workspace_id=j.workspace_id and l.sop_id=j.sop_id and l.asset_id=j.asset_id and a.storage_path=j.source_path and s.archived_at is null) then raise exception 'SOP source changed during extraction.';end if;
 if p_hash!~'^[a-f0-9]{64}$' or jsonb_typeof(p_images)<>'array' or jsonb_array_length(p_images)>80 or jsonb_typeof(p_warnings)<>'array' or length(p_warnings::text)>12000 then raise exception 'Invalid extraction result.';end if;
 for v in select value from jsonb_array_elements(p_images) loop
  image_id:=(v->>'id')::uuid;
  if (v->>'hash')!~'^[a-f0-9]{64}$' or coalesce((v->>'ordinal')::integer,0)<1 or length(v->>'context')>2000 or length(v->>'location')>300 or v->>'method' not in ('pdf_page','docx_image') or (v->>'width')::integer not between 1 and 5000 or (v->>'height')::integer not between 1 and 5000 or (v->>'size')::integer not between 1 and 25165824 then raise exception 'Invalid extracted image.';end if;
  path:=j.workspace_id||'/sops/'||j.sop_id||'/extractions/'||j.id||'/'||(v->>'hash')||'.webp';
  insert into assets(id,workspace_id,title,description,asset_kind,source_kind,native_kind,native_id,storage_path,content_type,file_size,metadata,created_by)
  values(image_id,j.workspace_id,left('SOP visual · '||(v->>'location'),200),v->>'context','media','system','sop_extracted_image',image_id,path,'image/webp',(v->>'size')::integer,jsonb_build_object('sop_id',j.sop_id,'source_asset_id',j.asset_id,'source_hash',p_hash,'extraction_id',j.id,'source_location',v->>'location'),j.requested_by);
  insert into sop_extracted_images values(image_id,j.workspace_id,j.sop_id,j.id,j.asset_id,(v->>'ordinal')::integer,v->>'location',v->>'context',v->>'method',v->>'hash',(v->>'width')::integer,(v->>'height')::integer,coalesce((v->>'attachable')::boolean,false));
 end loop;
 update sop_asset_extractions set status='ready',source_hash=p_hash,image_count=jsonb_array_length(p_images),warnings=p_warnings,error_summary=null,lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 return true;
end $$;

-- Only explicitly linked SOP guidance or files belonging exclusively to this client.
create function public.sop_work_asset_allowed(p_run uuid,p_asset uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from sop_work_runs r join assets a on a.workspace_id=r.workspace_id and a.id=p_asset where r.id=p_run and a.id<>r.asset_id and a.asset_kind in ('file','media','document') and a.metadata->>'archived_at' is null and (
 exists(select 1 from sop_extracted_images i join sop_asset_extractions e on e.id=i.extraction_id where i.workspace_id=r.workspace_id and i.asset_id=a.id and i.source_asset_id=r.asset_id and e.status='ready' and i.attachable)
 or exists(select 1 from sop_assets s where s.workspace_id=r.workspace_id and s.asset_id=a.id and s.sop_id=r.sop_id and s.role in ('main','supplement','example','reference'))
 or (a.asset_kind in ('file','media','document') and a.source_kind='upload' and a.native_kind is distinct from 'client_portal_resource'
 and exists(select 1 from asset_relationships l where l.workspace_id=r.workspace_id and l.asset_id=a.id and l.relationship_id=r.relationship_id)
 and not exists(select 1 from asset_relationships l where l.asset_id=a.id and (l.workspace_id<>r.workspace_id or l.relationship_id<>r.relationship_id))
 and not exists(select 1 from asset_work_items l join work_items w on w.id=l.work_item_id where l.asset_id=a.id and (w.visibility='admins_only' or w.area='admin' or not exists(select 1 from work_item_relationships x where x.work_item_id=w.id and x.relationship_id=r.relationship_id) or exists(select 1 from work_item_relationships x where x.work_item_id=w.id and x.relationship_id<>r.relationship_id))))
 ));
$$;
create function public.sop_asset_version(p_asset uuid) returns text language sql stable security definer set search_path=public as $$
 select md5(jsonb_build_array(title,description,storage_path,external_url,content_type,file_size,metadata,updated_at)::text) from assets where id=p_asset
$$;
create function public.sop_work_asset_candidates(p_id uuid,p_lease uuid,p_image_ids uuid[] default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare r sop_work_runs;result jsonb;
begin
 select * into r from sop_work_runs where id=p_id and status='running' and lease_token=p_lease and lease_until>now();if not found then raise exception 'Run lease expired.';end if;
 perform assert_sop_admin(r.workspace_id,r.requested_by);
 if cardinality(p_image_ids)>80 then raise exception 'Too many source images.';end if;
 with ids as (
 select asset_id from sop_extracted_images where workspace_id=r.workspace_id and source_asset_id=r.asset_id and asset_id=any(p_image_ids)
 union select asset_id from sop_assets where workspace_id=r.workspace_id and sop_id=r.sop_id
 union select asset_id from (select asset_id from asset_relationships where workspace_id=r.workspace_id and relationship_id=r.relationship_id order by created_at desc,asset_id limit 60) recent
 ), candidates as (
 select a.id,a.title,left(coalesce(i.context,nullif(a.description,''),s.notes,''),2000) description,
 case when i.asset_id is not null then 'extracted_image' when s.asset_id is not null then 'sop_asset' else 'relationship_asset' end kind,
 sop_asset_version(a.id) version,'[]'::jsonb source_steps
 from ids join assets a on a.id=ids.asset_id and a.workspace_id=r.workspace_id
 left join sop_extracted_images i on i.asset_id=a.id
 left join sop_assets s on s.asset_id=a.id and s.sop_id=r.sop_id
 where sop_work_asset_allowed(r.id,a.id) and length(trim(coalesce(i.context,nullif(a.description,''),s.notes,'')))>=20
 order by (i.asset_id is not null) desc,(s.asset_id is not null) desc,a.updated_at desc,a.id limit 64
 ) select coalesce(jsonb_agg(to_jsonb(candidates)),'[]') into result from candidates;
 return result;
end $$;

alter function public.publish_sop_work(uuid,uuid) rename to publish_sop_work_without_assets;
create function public.publish_sop_work(p_id uuid,p_lease uuid) returns uuid[] language plpgsql set search_path=public as $$
declare r sop_work_runs;ids uuid[];task jsonb;a jsonb;c jsonb;s jsonb;idx integer:=0;n integer:=0;used uuid[];
begin
 select * into r from sop_work_runs where id=p_id for update;
 if not found then raise exception 'Run not found.';end if;
 if r.status='published' then return r.work_item_ids;end if;
 if r.status<>'running' or r.lease_token is distinct from p_lease or r.lease_until<=now() then raise exception 'Run lease expired.';end if;
 perform 1 from assets where id in(select (selected_asset.value->>'asset_id')::uuid from jsonb_array_elements(r.plan->'tasks') selected_task cross join lateral jsonb_array_elements(coalesce(selected_task.value->'attachments','[]')) selected_asset) order by id for update;
 -- Validate before the existing atomic publication. No attachment can expand candidate scope.
 for task in select value from jsonb_array_elements(r.plan->'tasks') loop
  if r.schema_version='sop-work-assets-v7' and jsonb_typeof(task->'attachments') is distinct from 'array' then raise exception 'Missing attachment decision.';end if;
  if jsonb_array_length(coalesce(task->'attachments','[]'))>3 or (task->>'task_type'='request_information' and jsonb_array_length(coalesce(task->'attachments','[]'))>0) then raise exception 'Invalid attachment count.';end if;
  used:='{}';
  for a in select value from jsonb_array_elements(coalesce(task->'attachments','[]')) loop
   n:=n+1;c:=null;
   select value into c from jsonb_array_elements(coalesce(r.asset_candidates,'[]')) where value->>'id'=a->>'asset_id';
   if n>12 or c is null or (a->>'asset_id')::uuid=any(used) or not sop_work_asset_allowed(r.id,(a->>'asset_id')::uuid) or sop_asset_version((a->>'asset_id')::uuid) is distinct from c->>'version' then raise exception 'Asset selection is stale or unavailable.';end if;
   if not (task->'source_steps') @> jsonb_build_array((a->>'source_step')::integer) then raise exception 'Unsupported asset source step.';end if;
   s:=r.source_snapshot->'steps'->((a->>'source_step')::integer-1);
   if s is null or (c->>'kind'='extracted_image' and not coalesce((s->'image_ids') @> jsonb_build_array(a->>'asset_id'),false)) then raise exception 'Image does not support this step.';end if;
   if coalesce(length(trim(a->>'reason')),0) not between 20 and 400 or coalesce(length(trim(a->>'source_quote')),0) not between 12 and 400 or coalesce(length(trim(a->>'asset_quote')),0) not between 12 and 400
    or strpos(lower(regexp_replace(s->>'instruction','\s+',' ','g')),lower(regexp_replace(trim(a->>'source_quote'),'\s+',' ','g')))=0
    or strpos(lower(regexp_replace(c->>'description','\s+',' ','g')),lower(regexp_replace(trim(a->>'asset_quote'),'\s+',' ','g')))=0 then raise exception 'Unsupported attachment evidence.';end if;
   used:=array_append(used,(a->>'asset_id')::uuid);
  end loop;
 end loop;
 ids:=publish_sop_work_without_assets(p_id,p_lease);
 for task in select value from jsonb_array_elements(r.plan->'tasks') loop
  idx:=idx+1;
  for a in select value from jsonb_array_elements(coalesce(task->'attachments','[]')) loop
   insert into asset_work_items(workspace_id,asset_id,work_item_id) values(r.workspace_id,(a->>'asset_id')::uuid,ids[idx]) on conflict do nothing;
  end loop;
  if jsonb_array_length(coalesce(task->'attachments','[]'))>0 then update work_items set metadata=metadata||jsonb_build_object('ai_asset_evidence',task->'attachments') where id=ids[idx] and workspace_id=r.workspace_id;end if;
 end loop;
 return ids;
end $$;

-- Existing automatic flows must request the image-aware interpretation version.
do $$declare def text;begin
 select pg_get_functiondef(oid) into def from pg_proc where oid='public.queue_sop_work(uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure;
 execute replace(def,'''sop-source-v2''','''sop-source-images-v3''');
end $$;
create or replace function public.dispatch_pending_sop_work() returns bigint language plpgsql security definer set search_path=public as $$
declare settings sop_work_scheduler;token text;request_id bigint;
begin
 select * into settings from sop_work_scheduler where id and enabled for update skip locked;if not found then return null;end if;
 if not exists(select 1 from sop_work_requests where status='pending') and not exists(select 1 from sop_work_runs where status='queued' or (status='running' and lease_until<now()))
 and not exists(select 1 from sop_asset_extractions where status='queued' or (status='running' and lease_until<now())) and not exists(select 1 from sop_interpretations where status='queued') then return null;end if;
 if settings.last_dispatched_at>now()-interval '45 seconds' then return null;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='sop_work_cron_secret';if token is null then raise exception 'SOP scheduler credential is unavailable';end if;
 request_id:=net.http_post(url:=settings.worker_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=10000);
 update sop_work_scheduler set last_request_id=request_id,last_dispatched_at=now() where id;return request_id;
end $$;
do $$declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('queue_sop_extraction','queue_uploaded_sop_images','claim_sop_extraction','finish_sop_extraction','sop_work_asset_allowed','sop_asset_version','sop_work_asset_candidates','publish_sop_work','publish_sop_work_without_assets') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
notify pgrst,'reload schema';
commit;
