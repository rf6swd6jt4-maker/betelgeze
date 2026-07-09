alter table public.relationships
drop constraint if exists relationships_lifecycle_phase_check;

alter table public.relationship_work_items
drop constraint if exists relationship_work_items_lifecycle_phase_check;

alter table public.relationships
add column if not exists industry_value text,
add column if not exists location_value text,
add column if not exists address jsonb not null default '{}'::jsonb,
add column if not exists source_label text,
add column if not exists primary_contact_role text,
add column if not exists notes_summary text,
add column if not exists started_onboarding_at timestamptz;

alter table public.clients
add column if not exists relationship_id uuid references public.relationships(id) on delete set null;

alter table public.client_progress
add column if not exists relationship_id uuid references public.relationships(id) on delete cascade;

alter table public.client_modules
add column if not exists relationship_id uuid references public.relationships(id) on delete cascade;

alter table public.client_notes
add column if not exists relationship_id uuid references public.relationships(id) on delete cascade;

alter table public.client_activity
add column if not exists relationship_id uuid references public.relationships(id) on delete cascade;

alter table public.client_form_responses
add column if not exists relationship_id uuid references public.relationships(id) on delete cascade;

alter table public.client_services
add column if not exists relationship_id uuid references public.relationships(id) on delete cascade;

alter table public.client_communication_channels
add column if not exists relationship_id uuid references public.relationships(id) on delete set null;

alter table public.client_messages
add column if not exists relationship_id uuid references public.relationships(id) on delete set null;

alter table public.client_clickup_items
add column if not exists relationship_id uuid references public.relationships(id) on delete set null;

alter table public.client_sales
add column if not exists relationship_id uuid references public.relationships(id) on delete set null;

update public.relationships
set lifecycle_phase = case lifecycle_phase
    when 'found' then 'lead'
    when 'qualified' then 'lead'
    when 'contacted' then 'potential_client'
    when 'sold' then 'potential_client'
    else lifecycle_phase
end
where lifecycle_phase in ('found', 'qualified', 'contacted', 'sold');

update public.relationship_work_items
set lifecycle_phase = case lifecycle_phase
    when 'found' then 'lead'
    when 'qualified' then 'lead'
    when 'contacted' then 'potential_client'
    when 'sold' then 'potential_client'
    else lifecycle_phase
end
where lifecycle_phase in ('found', 'qualified', 'contacted', 'sold');

alter table public.relationships
alter column lifecycle_phase set default 'lead',
add constraint relationships_lifecycle_phase_check
check (lifecycle_phase in ('lead', 'nurturing', 'potential_client', 'invoiced', 'onboarding', 'onboarding_complete', 'fulfilment', 'retention', 'completed_lost'));

alter table public.relationship_work_items
alter column lifecycle_phase set default 'lead',
add constraint relationship_work_items_lifecycle_phase_check
check (lifecycle_phase in ('lead', 'nurturing', 'potential_client', 'invoiced', 'onboarding', 'onboarding_complete', 'fulfilment', 'retention', 'completed_lost'));

update public.relationships r
set
    industry_value = coalesce(r.industry_value, c.industry_value),
    location_value = coalesce(r.location_value, c.location_value),
    address = case when r.address = '{}'::jsonb then coalesce(c.address, '{}'::jsonb) else r.address end,
    source_label = coalesce(r.source_label, c.source_key),
    primary_contact_role = coalesce(r.primary_contact_role, case when c.owner_name is not null then 'Owner' end),
    source_metadata = r.source_metadata || jsonb_strip_nulls(jsonb_build_object(
        'source_key', c.source_key,
        'lead_score', c.lead_score,
        'owner_identity_points', c.owner_identity_points,
        'owner_phone_points', c.owner_phone_points,
        'business_support_points', c.business_support_points
    ))
from public.leadgen_companies c
where r.leadgen_company_id = c.id;

update public.clients c
set relationship_id = r.id
from public.relationships r
where r.client_id = c.id
and c.relationship_id is null;

update public.client_progress cp
set relationship_id = c.relationship_id
from public.clients c
where cp.client_id = c.id
and cp.relationship_id is null
and c.relationship_id is not null;

update public.client_modules cm
set relationship_id = c.relationship_id
from public.clients c
where cm.client_id = c.id
and cm.relationship_id is null
and c.relationship_id is not null;

update public.client_notes cn
set relationship_id = c.relationship_id
from public.clients c
where cn.client_id = c.id
and cn.relationship_id is null
and c.relationship_id is not null;

update public.client_activity ca
set relationship_id = c.relationship_id
from public.clients c
where ca.client_id = c.id
and ca.relationship_id is null
and c.relationship_id is not null;

update public.client_form_responses cfr
set relationship_id = c.relationship_id
from public.clients c
where cfr.client_id = c.id
and cfr.relationship_id is null
and c.relationship_id is not null;

update public.client_services cs
set relationship_id = c.relationship_id
from public.clients c
where cs.client_id = c.id
and cs.relationship_id is null
and c.relationship_id is not null;

update public.client_communication_channels ccc
set relationship_id = c.relationship_id
from public.clients c
where ccc.client_id = c.id
and ccc.relationship_id is null
and c.relationship_id is not null;

update public.client_messages msg
set relationship_id = c.relationship_id
from public.clients c
where msg.client_id = c.id
and msg.relationship_id is null
and c.relationship_id is not null;

update public.client_clickup_items cci
set relationship_id = c.relationship_id
from public.clients c
where cci.client_id = c.id
and cci.relationship_id is null
and c.relationship_id is not null;

update public.client_sales sale
set relationship_id = c.relationship_id
from public.clients c
where sale.client_id = c.id
and sale.relationship_id is null
and c.relationship_id is not null;

create unique index if not exists clients_relationship_id_unique
on public.clients(relationship_id)
where relationship_id is not null;

create index if not exists client_progress_relationship_id_idx on public.client_progress(relationship_id);
create index if not exists client_modules_relationship_id_idx on public.client_modules(relationship_id);
create index if not exists client_notes_relationship_id_idx on public.client_notes(relationship_id, created_at desc);
create index if not exists client_activity_relationship_id_idx on public.client_activity(relationship_id, created_at desc);
create index if not exists client_form_responses_relationship_id_idx on public.client_form_responses(relationship_id);
create index if not exists client_services_relationship_id_idx on public.client_services(relationship_id);
create index if not exists client_messages_relationship_id_idx on public.client_messages(relationship_id, created_at desc);
create index if not exists client_sales_relationship_id_idx on public.client_sales(relationship_id);

create table if not exists public.relationship_assets (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null references public.relationships(id) on delete cascade,
    asset_type text not null check (asset_type in ('file', 'link', 'note', 'message', 'invoice', 'form_submission', 'lead_evidence', 'document', 'other')),
    title text not null,
    description text,
    storage_path text,
    external_url text,
    native_kind text,
    native_id uuid,
    metadata jsonb not null default '{}'::jsonb,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists relationship_assets_relationship_type_idx
on public.relationship_assets(relationship_id, asset_type, created_at desc);

create index if not exists relationship_assets_workspace_type_idx
on public.relationship_assets(workspace_id, asset_type, created_at desc);

create unique index if not exists relationship_assets_native_unique
on public.relationship_assets(workspace_id, relationship_id, native_kind, native_id)
where native_kind is not null and native_id is not null;

drop trigger if exists relationship_assets_updated_at on public.relationship_assets;
create trigger relationship_assets_updated_at
before update on public.relationship_assets
for each row execute function public.set_updated_at();

insert into public.relationship_assets (
    workspace_id,
    relationship_id,
    asset_type,
    title,
    description,
    native_kind,
    native_id,
    metadata,
    created_by,
    created_at,
    updated_at
)
select
    n.workspace_id,
    n.relationship_id,
    'note',
    'Relationship note',
    n.note,
    'client_note',
    n.id,
    jsonb_build_object('legacy_client_id', n.client_id),
    n.author_id,
    n.created_at,
    n.created_at
from public.client_notes n
where n.relationship_id is not null
on conflict (workspace_id, relationship_id, native_kind, native_id)
where native_kind is not null and native_id is not null
do update set
    title = excluded.title,
    description = excluded.description,
    updated_at = now();

insert into public.relationship_assets (
    workspace_id,
    relationship_id,
    asset_type,
    title,
    description,
    native_kind,
    native_id,
    metadata,
    created_at,
    updated_at
)
select
    r.workspace_id,
    r.relationship_id,
    'form_submission',
    'Onboarding submission: ' || r.step_key,
    'Submitted onboarding form response.',
    'client_form_response',
    r.id,
    jsonb_build_object('legacy_client_id', r.client_id, 'step_key', r.step_key, 'response', r.response),
    r.updated_at,
    r.updated_at
from public.client_form_responses r
where r.relationship_id is not null
on conflict (workspace_id, relationship_id, native_kind, native_id)
where native_kind is not null and native_id is not null
do update set
    title = excluded.title,
    metadata = excluded.metadata,
    updated_at = now();

insert into public.relationship_assets (
    workspace_id,
    relationship_id,
    asset_type,
    title,
    description,
    external_url,
    native_kind,
    native_id,
    metadata,
    created_at,
    updated_at
)
select
    s.workspace_id,
    s.relationship_id,
    'invoice',
    'Invoice ' || coalesce(s.stripe_invoice_id, s.id::text),
    s.status,
    s.stripe_hosted_invoice_url,
    'client_sale',
    s.id,
    jsonb_build_object('legacy_client_id', s.client_id, 'currency', s.currency, 'total_amount', s.total_amount, 'stripe_invoice_status', s.stripe_invoice_status),
    s.created_at,
    s.updated_at
from public.client_sales s
where s.relationship_id is not null
on conflict (workspace_id, relationship_id, native_kind, native_id)
where native_kind is not null and native_id is not null
do update set
    title = excluded.title,
    description = excluded.description,
    external_url = excluded.external_url,
    metadata = excluded.metadata,
    updated_at = now();

insert into public.relationship_assets (
    workspace_id,
    relationship_id,
    asset_type,
    title,
    description,
    native_kind,
    native_id,
    metadata,
    created_at,
    updated_at
)
select
    m.workspace_id,
    m.relationship_id,
    'message',
    case when m.direction = 'inbound' then 'Inbound message' else 'Outbound message' end,
    m.body,
    'client_message',
    m.id,
    jsonb_build_object('legacy_client_id', m.client_id, 'provider', m.provider, 'status', m.status, 'direction', m.direction),
    m.created_at,
    m.created_at
from public.client_messages m
where m.relationship_id is not null
on conflict (workspace_id, relationship_id, native_kind, native_id)
where native_kind is not null and native_id is not null
do update set
    description = excluded.description,
    metadata = excluded.metadata,
    updated_at = now();

insert into public.relationship_assets (
    workspace_id,
    relationship_id,
    asset_type,
    title,
    description,
    native_kind,
    native_id,
    metadata,
    created_at,
    updated_at
)
select
    e.workspace_id,
    r.id,
    'lead_evidence',
    coalesce(e.evidence_kind, e.claim_kind, 'Lead evidence'),
    coalesce(e.value::text, e.claim_value::text),
    'leadgen_evidence',
    e.id,
    jsonb_build_object('source_key', e.source_key, 'company_id', e.company_id),
    e.created_at,
    e.created_at
from (
    select id, workspace_id, company_id, source_key, evidence_kind, null::text as claim_kind, value, null::jsonb as claim_value, created_at
    from public.leadgen_evidence
    union all
    select id, workspace_id, company_id, source_key, null::text as evidence_kind, claim_kind, null::jsonb as value, claim_value, created_at
    from public.leadgen_evidence_claims
) e
join public.relationships r on r.leadgen_company_id = e.company_id and r.workspace_id = e.workspace_id
on conflict (workspace_id, relationship_id, native_kind, native_id)
where native_kind is not null and native_id is not null
do nothing;

alter table public.relationship_assets enable row level security;

drop policy if exists workspace_members_can_read_relationship_assets on public.relationship_assets;
create policy workspace_members_can_read_relationship_assets
on public.relationship_assets
for select
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_admins_can_manage_relationship_assets on public.relationship_assets;
create policy workspace_admins_can_manage_relationship_assets
on public.relationship_assets
for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));

create or replace function public.sync_relationship_from_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_relationship_id uuid;
begin
    v_relationship_id := new.relationship_id;

    if v_relationship_id is not null then
        update public.relationships
        set
            workspace_id = new.workspace_id,
            client_id = new.id,
            primary_person_name = coalesce(nullif(primary_person_name, ''), nullif(new.name, ''), nullif(new.email, ''), nullif(new.phone, ''), 'Unknown relationship'),
            primary_email = coalesce(nullif(new.email, ''), primary_email),
            primary_phone = coalesce(nullif(new.phone, ''), primary_phone),
            business_name = coalesce(business_name, nullif(new.name, '')),
            lifecycle_phase = case
                when new.archived_at is not null then 'completed_lost'
                when lifecycle_phase in ('lead', 'nurturing', 'potential_client', 'invoiced') then 'onboarding'
                else lifecycle_phase
            end,
            status = case when new.archived_at is not null then 'archived' else status end,
            started_onboarding_at = coalesce(started_onboarding_at, new.created_at),
            source_metadata = source_metadata || jsonb_build_object('auto_wrapped_from', 'clients', 'is_test', coalesce(new.is_test, false)),
            updated_at = now()
        where id = v_relationship_id
        and workspace_id = new.workspace_id
        returning id into v_relationship_id;
    end if;

    if v_relationship_id is null then
        insert into public.relationships (
            workspace_id,
            client_id,
            source_type,
            primary_person_name,
            primary_email,
            primary_phone,
            business_name,
            lifecycle_phase,
            status,
            started_onboarding_at,
            source_metadata,
            created_at,
            updated_at
        )
        values (
            new.workspace_id,
            new.id,
            'client',
            coalesce(nullif(new.name, ''), nullif(new.email, ''), nullif(new.phone, ''), 'Unknown relationship'),
            nullif(new.email, ''),
            nullif(new.phone, ''),
            nullif(new.name, ''),
            case when new.archived_at is not null then 'completed_lost' else 'onboarding' end,
            case when new.archived_at is not null then 'archived' else 'active' end,
            case when new.archived_at is not null then null else new.created_at end,
            jsonb_build_object('auto_wrapped_from', 'clients', 'is_test', coalesce(new.is_test, false)),
            new.created_at,
            now()
        )
        on conflict (client_id)
        where client_id is not null
        do update set
            workspace_id = excluded.workspace_id,
            primary_person_name = excluded.primary_person_name,
            primary_email = excluded.primary_email,
            primary_phone = excluded.primary_phone,
            business_name = excluded.business_name,
            lifecycle_phase = excluded.lifecycle_phase,
            status = excluded.status,
            started_onboarding_at = coalesce(relationships.started_onboarding_at, excluded.started_onboarding_at),
            source_metadata = relationships.source_metadata || excluded.source_metadata,
            updated_at = now()
        returning id into v_relationship_id;
    end if;

    update public.clients
    set relationship_id = v_relationship_id
    where id = new.id
    and public.clients.relationship_id is distinct from v_relationship_id;

    insert into public.relationship_work_items (
        workspace_id,
        relationship_id,
        title,
        description,
        lifecycle_phase,
        status,
        priority,
        is_key_task,
        native_kind,
        native_id,
        native_href,
        actual_start_at,
        sort_order,
        metadata
    )
    values (
        new.workspace_id,
        v_relationship_id,
        'Onboarding relationship opened',
        'Created from the onboarding session record.',
        'onboarding',
        case when new.archived_at is not null then 'done' else 'doing' end,
        2,
        true,
        'client',
        new.id,
        '/admin/client/' || new.id::text,
        new.created_at,
        10,
        jsonb_build_object('auto_created', true)
    )
    on conflict (workspace_id, relationship_id, native_kind, native_id)
    where native_kind is not null and native_id is not null
    do update set
        title = excluded.title,
        status = excluded.status,
        updated_at = now();

    return new;
end;
$$;

drop trigger if exists sync_relationship_after_client_insert_update on public.clients;
create trigger sync_relationship_after_client_insert_update
after insert or update of workspace_id, name, email, phone, archived_at, is_test, relationship_id
on public.clients
for each row execute function public.sync_relationship_from_client();
