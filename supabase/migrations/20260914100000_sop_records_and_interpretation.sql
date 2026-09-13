-- SOP records are separate from their immutable asset files. All writes use
-- server-only commands; route authorization includes membership and MFA.
create table public.sops (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    title text not null check (length(trim(title)) between 1 and 200),
    description text not null default '' check (length(description) <= 5000),
    version integer not null default 1,
    archived_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(workspace_id,id)
);
create index sops_catalogue_idx on public.sops(workspace_id,created_at desc,id desc) where archived_at is null;
create index sops_archived_idx on public.sops(workspace_id,created_at desc,id desc) where archived_at is not null;
create table public.sop_assets (
    asset_id uuid primary key references public.assets(id) on delete restrict,
    sop_id uuid not null,
    workspace_id uuid not null,
    role text not null default 'reference' check (role in ('main','supplement','example','revision','reference')),
    notes text not null default '' check (length(notes) <= 2000),
    created_at timestamptz not null default now(),
    foreign key(workspace_id,sop_id) references public.sops(workspace_id,id) on delete cascade
);
create index sop_assets_page_idx on public.sop_assets(workspace_id,sop_id,created_at desc,asset_id desc);
create table public.sop_interpretations (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    sop_id uuid not null,
    asset_id uuid not null references public.sop_assets(asset_id) on delete cascade,
    status text not null default 'queued' check (status in ('queued','running','ready','reviewed','failed')),
    schema_version text not null,
    model text not null,
    requested_by uuid references auth.users(id) on delete set null,
    reviewed_by uuid references auth.users(id) on delete set null,
    reviewed_at timestamptz,
    lease_token uuid,
    lease_until timestamptz,
    attempts integer not null default 1,
    result jsonb,
    source_hash text,
    input_tokens integer,
    output_tokens integer,
    error_summary text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(asset_id,schema_version),
    foreign key(workspace_id,sop_id) references public.sops(workspace_id,id) on delete cascade
);
create index sop_interpretations_pending_idx on public.sop_interpretations(created_at,id) where status='queued';
create index sop_interpretations_expired_idx on public.sop_interpretations(lease_until,id) where status='running';
create index sop_interpretations_detail_idx on public.sop_interpretations(workspace_id,sop_id,asset_id);
create table public.sop_interpretation_attempts (
    id bigint generated always as identity primary key,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    interpretation_id uuid not null references public.sop_interpretations(id) on delete cascade,
    created_at timestamptz not null default now()
);
create index sop_interpretation_budget_idx on public.sop_interpretation_attempts(workspace_id,created_at);

alter table public.sops enable row level security;
alter table public.sop_assets enable row level security;
alter table public.sop_interpretations enable row level security;
alter table public.sop_interpretation_attempts enable row level security;
revoke all on public.sops, public.sop_assets, public.sop_interpretations, public.sop_interpretation_attempts from anon, authenticated;
grant all on public.sops, public.sop_assets, public.sop_interpretations, public.sop_interpretation_attempts to service_role;
grant usage, select on sequence public.sop_interpretation_attempts_id_seq to service_role;

create function public.assert_sop_admin(p_workspace uuid,p_actor uuid) returns void
language plpgsql set search_path=public as $$
begin
    if not exists(select 1 from workspace_memberships m join workspaces w on w.id=m.workspace_id where m.workspace_id=p_workspace and m.user_id=p_actor and m.role in ('owner','admin') and w.status='active') then
        raise exception 'Only current workspace admins can change SOPs.';
    end if;
end $$;

create function public.create_sop_record(p_workspace uuid,p_actor uuid,p_id uuid,p_title text,p_description text) returns uuid
language plpgsql set search_path=public as $$
declare existing sops;
begin
    perform assert_sop_admin(p_workspace,p_actor);
    perform 1 from workspaces where id=p_workspace for update;
    select * into existing from sops where id=p_id;
    if found then
        if existing.workspace_id<>p_workspace or existing.created_by is distinct from p_actor then raise exception 'Invalid SOP request.'; end if;
        return p_id;
    end if;
    insert into sops(id,workspace_id,title,description,created_by) values(p_id,p_workspace,trim(p_title),p_description,p_actor);
    return p_id;
end $$;

create function public.update_sop_record(p_workspace uuid,p_actor uuid,p_id uuid,p_version integer,p_title text,p_description text,p_archived boolean) returns integer
language plpgsql set search_path=public as $$
declare v integer;
begin
    perform assert_sop_admin(p_workspace,p_actor);
    update sops set title=trim(p_title),description=p_description,archived_at=case when p_archived then coalesce(archived_at,now()) else null end,version=version+1,updated_at=now()
      where workspace_id=p_workspace and id=p_id and version=p_version returning version into v;
    if v is null then raise exception 'This SOP changed. Refresh before saving.'; end if;
    return v;
end $$;

-- Compatibility: old upload tabs and existing /sops/:assetId links keep working.
create function public.link_legacy_sop_asset() returns trigger language plpgsql set search_path=public as $$
begin
    if new.native_kind='sop_document' then
        insert into sops(id,workspace_id,title,created_by,created_at,updated_at) values(new.id,new.workspace_id,left(new.title,200),new.created_by,new.created_at,new.updated_at) on conflict(id) do nothing;
        insert into sop_assets(asset_id,sop_id,workspace_id,role,created_at) values(new.id,new.id,new.workspace_id,'main',new.created_at) on conflict(asset_id) do nothing;
    end if;
    return new;
end $$;
insert into sops(id,workspace_id,title,created_by,created_at,updated_at)
select id,workspace_id,left(title,200),created_by,created_at,updated_at from assets where native_kind='sop_document' on conflict(id) do nothing;
insert into sop_assets(asset_id,sop_id,workspace_id,role,created_at)
select id,id,workspace_id,'main',created_at from assets where native_kind='sop_document' on conflict(asset_id) do nothing;
create trigger link_legacy_sop_asset after insert on public.assets for each row when(new.native_kind='sop_document') execute function public.link_legacy_sop_asset();

create function public.attach_sop_upload(p_workspace uuid,p_actor uuid,p_sop uuid,p_asset uuid,p_title text,p_type text,p_size bigint,p_path text,p_role text,p_notes text) returns uuid
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
    update sops set version=version+1,updated_at=now() where id=p_sop;
    return p_asset;
end $$;

create function public.queue_sop_interpretation(p_workspace uuid,p_actor uuid,p_sop uuid,p_asset uuid,p_schema text,p_model text,p_retry boolean,p_daily_limit integer) returns uuid
language plpgsql set search_path=public as $$
declare job sop_interpretations; n integer;
begin
    perform assert_sop_admin(p_workspace,p_actor);
    -- Serialize budget reservations and duplicate requests across all callers.
    perform 1 from workspaces where id=p_workspace for update;
    perform 1 from sops where workspace_id=p_workspace and id=p_sop and archived_at is null for update;
    if not found then raise exception 'This SOP is unavailable or archived.'; end if;
    if not exists(select 1 from sop_assets where workspace_id=p_workspace and sop_id=p_sop and asset_id=p_asset) then raise exception 'Asset not found.'; end if;
    select * into job from sop_interpretations where asset_id=p_asset and schema_version=p_schema for update;
    if found and (job.status<>'failed' or not p_retry) then return job.id; end if;
    if job.attempts>=3 then raise exception 'Three attempts have been used. Review this file before trying another interpretation.'; end if;
    select count(*) into n from sop_interpretation_attempts where workspace_id=p_workspace and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
    if p_daily_limit not between 1 and 100 or n>=p_daily_limit then raise exception 'The daily interpretation limit has been reached.'; end if;
    if job.id is null then
        insert into sop_interpretations(workspace_id,sop_id,asset_id,schema_version,model,requested_by) values(p_workspace,p_sop,p_asset,p_schema,p_model,p_actor) returning * into job;
    else
        update sop_interpretations set status='queued',attempts=attempts+1,requested_by=p_actor,model=p_model,error_summary=null,lease_token=null,lease_until=null,updated_at=now() where id=job.id returning * into job;
    end if;
    insert into sop_interpretation_attempts(workspace_id,interpretation_id) values(p_workspace,job.id);
    return job.id;
end $$;

create function public.claim_sop_interpretation(p_id uuid default null) returns setof public.sop_interpretations
language plpgsql set search_path=public as $$
begin
    -- An interrupted paid call has an uncertain outcome. Never automatically pay again.
    update sop_interpretations set status='failed',error_summary='Interpretation was interrupted. Review before retrying; the previous request may have incurred usage.',lease_token=null,lease_until=null,updated_at=now()
      where id in(select id from sop_interpretations where status='running' and lease_until<now() order by lease_until limit 20 for update skip locked);
    return query with candidate as(
        select j.id from sop_interpretations j where j.status='queued' and (p_id is null or j.id=p_id) order by j.created_at,j.id limit 1 for update skip locked
    ) update sop_interpretations j set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '6 minutes',updated_at=now() from candidate c where j.id=c.id returning j.*;
end $$;

create function public.finish_sop_interpretation(p_id uuid,p_lease uuid,p_result jsonb,p_hash text,p_input integer,p_output integer,p_error text) returns boolean
language plpgsql set search_path=public as $$
begin
    if p_result is not null and octet_length(p_result::text)>100000 then raise exception 'Interpretation too large.'; end if;
    update sop_interpretations set status=case when p_result is null then 'failed' else 'ready' end,result=p_result,source_hash=p_hash,input_tokens=p_input,output_tokens=p_output,error_summary=left(p_error,500),lease_token=null,lease_until=null,updated_at=now()
      where id=p_id and status='running' and lease_token=p_lease and lease_until>now();
    return found;
end $$;
create function public.review_sop_interpretation(p_workspace uuid,p_actor uuid,p_sop uuid,p_id uuid) returns boolean
language plpgsql set search_path=public as $$
begin
    perform assert_sop_admin(p_workspace,p_actor);
    perform 1 from sops where workspace_id=p_workspace and id=p_sop and archived_at is null for update;
    if not found then raise exception 'This SOP is unavailable or archived.'; end if;
    update sop_interpretations set status='reviewed',reviewed_by=p_actor,reviewed_at=now(),updated_at=now() where workspace_id=p_workspace and sop_id=p_sop and id=p_id and status='ready';
    return found;
end $$;

-- These functions intentionally use invoker permissions and are never exposed to browser roles.
revoke all on function public.assert_sop_admin(uuid,uuid), public.create_sop_record(uuid,uuid,uuid,text,text), public.update_sop_record(uuid,uuid,uuid,integer,text,text,boolean), public.link_legacy_sop_asset(), public.attach_sop_upload(uuid,uuid,uuid,uuid,text,text,bigint,text,text,text), public.queue_sop_interpretation(uuid,uuid,uuid,uuid,text,text,boolean,integer), public.claim_sop_interpretation(uuid), public.finish_sop_interpretation(uuid,uuid,jsonb,text,integer,integer,text), public.review_sop_interpretation(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_sop_admin(uuid,uuid), public.create_sop_record(uuid,uuid,uuid,text,text), public.update_sop_record(uuid,uuid,uuid,integer,text,text,boolean), public.link_legacy_sop_asset(), public.attach_sop_upload(uuid,uuid,uuid,uuid,text,text,bigint,text,text,text), public.queue_sop_interpretation(uuid,uuid,uuid,uuid,text,text,boolean,integer), public.claim_sop_interpretation(uuid), public.finish_sop_interpretation(uuid,uuid,jsonb,text,integer,integer,text), public.review_sop_interpretation(uuid,uuid,uuid,uuid) to service_role;
