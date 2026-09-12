-- SS-01: additive foundation. No legacy table, policy, trigger or live path changes.
-- Prepared imports are immutable rehearsal snapshots, NOT a runtime cutover.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.service_instance_imports (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    relationship_id uuid not null,
    source_hash text not null,
    report jsonb not null check (jsonb_typeof(report) = 'object'),
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id),
    unique (workspace_id, relationship_id),
    unique (workspace_id, relationship_id, id)
);

create table public.relationship_service_instances (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    relationship_id uuid not null,
    service_id uuid,
    service_revision_id uuid,
    service_key text not null check (length(service_key) between 1 and 200),
    source_key text not null check (length(source_key) between 1 and 250),
    origin text not null check (origin in ('negotiation', 'already_onboarded', 'legacy_import')),
    stage text check (stage in ('negotiating', 'awaiting_payment', 'onboarding', 'setup', 'maintenance', 'completed', 'for_later', 'declined')),
    disposition text not null default 'active' check (disposition in ('active', 'paused', 'cancelled')),
    import_id uuid,
    review_reasons text[] not null default '{}',
    assignee_user_id uuid references auth.users(id),
    seller_user_id uuid references auth.users(id),
    manager_user_id uuid references auth.users(id),
    source_snapshot jsonb not null default '{}' check (jsonb_typeof(source_snapshot) = 'object'),
    version integer not null default 1 check (version > 0),
    change_request_id uuid not null,
    change_reason text not null check (length(btrim(change_reason)) between 1 and 1000),
    changed_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id),
    foreign key (workspace_id, service_id) references public.onboarding_services(workspace_id, id),
    foreign key (workspace_id, service_revision_id) references public.onboarding_service_revisions(workspace_id, id),
    foreign key (workspace_id, relationship_id, import_id) references public.service_instance_imports(workspace_id, relationship_id, id),
    unique (workspace_id, relationship_id, source_key),
    unique (workspace_id, id),
    unique (workspace_id, relationship_id, id),
    check ((origin = 'legacy_import') = (import_id is not null)),
    check (origin = 'legacy_import' or (service_id is not null and service_revision_id is not null and stage is not null and cardinality(review_reasons) = 0)),
    check (stage is not null or cardinality(review_reasons) > 0)
);
create index service_instances_relationship_stage_idx on public.relationship_service_instances(workspace_id, relationship_id, stage, id);
create index service_instances_active_assignee_idx on public.relationship_service_instances(workspace_id, assignee_user_id, stage, id)
    where disposition = 'active' and stage in ('negotiating', 'awaiting_payment', 'onboarding', 'setup', 'maintenance');
create index service_instances_revision_idx on public.relationship_service_instances(workspace_id, service_revision_id);

create table public.service_instance_stage_events (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    instance_id uuid not null,
    version integer not null,
    request_id uuid not null,
    old_stage text,
    new_stage text,
    old_disposition text,
    new_disposition text not null,
    old_assignee_user_id uuid,
    new_assignee_user_id uuid,
    actor_user_id uuid not null references auth.users(id),
    reason text not null,
    created_at timestamptz not null default now(),
    foreign key (workspace_id, instance_id) references public.relationship_service_instances(workspace_id, id),
    unique (instance_id, version),
    unique (instance_id, request_id)
);
create index service_instance_events_history_idx on public.service_instance_stage_events(workspace_id, instance_id, version desc);

-- One purchase line owns an instance. Repeat purchases get new instances.
-- Frozen snapshots stay immutable even when operational assignment changes later.
create table public.service_instance_sale_items (
    workspace_id uuid not null,
    relationship_id uuid not null,
    instance_id uuid primary key,
    sale_item_id uuid not null unique,
    sale_id uuid not null,
    seller_user_id uuid,
    manager_user_id uuid,
    assignee_user_id uuid,
    commercial_snapshot jsonb not null,
    linked_at timestamptz not null default now(),
    foreign key (workspace_id, relationship_id, instance_id) references public.relationship_service_instances(workspace_id, relationship_id, id),
    foreign key (workspace_id, sale_item_id) references public.client_sale_items(workspace_id, id),
    foreign key (workspace_id, sale_id) references public.client_sales(workspace_id, id),
    unique (workspace_id, instance_id)
);
create index service_instance_sale_lookup_idx on public.service_instance_sale_items(workspace_id, sale_id, instance_id);

-- Historical session enrollment is separate from the current-session lease.
create table public.service_instance_sessions (
    workspace_id uuid not null,
    relationship_id uuid not null,
    instance_id uuid not null,
    session_id uuid not null,
    enrollment text not null default 'historical' check (enrollment in ('historical', 'active')),
    created_at timestamptz not null default now(),
    foreign key (workspace_id, relationship_id, instance_id) references public.relationship_service_instances(workspace_id, relationship_id, id),
    foreign key (workspace_id, session_id) references public.relationship_onboarding_sessions(workspace_id, id),
    primary key (instance_id, session_id),
    unique (workspace_id, instance_id, session_id)
);
create unique index service_instance_one_active_session_idx on public.service_instance_sessions(instance_id) where enrollment = 'active';
create index service_instance_session_lookup_idx on public.service_instance_sessions(workspace_id, session_id, instance_id);

create table public.service_instance_module_requirements (
    workspace_id uuid not null,
    instance_id uuid not null,
    session_id uuid not null,
    session_module_id uuid not null,
    required boolean not null default true,
    review_required boolean not null default true,
    foreign key (workspace_id, instance_id, session_id) references public.service_instance_sessions(workspace_id, instance_id, session_id),
    foreign key (workspace_id, session_module_id) references public.relationship_onboarding_session_modules(workspace_id, id),
    primary key (instance_id, session_module_id)
);
create index service_instance_requirements_module_idx on public.service_instance_module_requirements(workspace_id, session_module_id, instance_id);

create table public.service_instance_work_cycles (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    instance_id uuid not null,
    phase text not null check (phase in ('setup', 'maintenance')),
    cycle_key text not null check (length(cycle_key) between 1 and 200),
    template_revision_key text not null check (length(template_revision_key) between 1 and 200),
    template_snapshot jsonb not null check (jsonb_typeof(template_snapshot) = 'object'),
    created_at timestamptz not null default now(),
    foreign key (workspace_id, instance_id) references public.relationship_service_instances(workspace_id, id),
    unique (instance_id, phase, cycle_key),
    unique (workspace_id, instance_id, id)
);
create table public.service_instance_work_items (
    workspace_id uuid not null,
    instance_id uuid not null,
    work_item_id uuid not null references public.work_items(id),
    cycle_id uuid,
    linked_at timestamptz not null default now(),
    foreign key (workspace_id, instance_id) references public.relationship_service_instances(workspace_id, id),
    foreign key (workspace_id, instance_id, cycle_id) references public.service_instance_work_cycles(workspace_id, instance_id, id),
    primary key (instance_id, work_item_id)
);
create index service_instance_work_lookup_idx on public.service_instance_work_items(workspace_id, work_item_id, instance_id);
create index service_instance_work_cycle_idx on public.service_instance_work_items(workspace_id, instance_id, cycle_id);

-- Explicit RLS statements also allow deployment editors to verify every new table.
alter table public.service_instance_imports enable row level security;
alter table public.relationship_service_instances enable row level security;
alter table public.service_instance_stage_events enable row level security;
alter table public.service_instance_sale_items enable row level security;
alter table public.service_instance_sessions enable row level security;
alter table public.service_instance_module_requirements enable row level security;
alter table public.service_instance_work_cycles enable row level security;
alter table public.service_instance_work_items enable row level security;

create function public.reject_service_instance_history_change() returns trigger
language plpgsql set search_path = public as $$
begin
    raise exception 'Service instance history is immutable';
end $$;

create function public.guard_service_instance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'DELETE' then raise exception 'Cancel service instances instead of deleting history'; end if;
    if new.service_revision_id is not null and not exists (
        select 1 from public.onboarding_service_revisions v where v.workspace_id = new.workspace_id and v.id = new.service_revision_id and v.service_id = new.service_id
    ) then raise exception 'Service revision does not belong to this service'; end if;
    if tg_op = 'INSERT' then
        if new.version <> 1 then raise exception 'Instance starts at version 1'; end if;
        if new.origin = 'negotiation' and new.stage <> 'negotiating' then raise exception 'New opportunities start in Negotiating'; end if;
        if new.origin = 'already_onboarded' and new.stage not in ('setup', 'maintenance', 'completed') then raise exception 'Existing work starts after onboarding'; end if;
    else
        if old.import_id is not null then raise exception 'Prepared imports are immutable; cutover is not enabled'; end if;
        if (new.id, new.workspace_id, new.relationship_id, new.service_id, new.service_revision_id, new.service_key, new.source_key, new.origin, new.import_id, new.source_snapshot, new.seller_user_id, new.manager_user_id, new.created_at, new.review_reasons)
            is distinct from (old.id, old.workspace_id, old.relationship_id, old.service_id, old.service_revision_id, old.service_key, old.source_key, old.origin, old.import_id, old.source_snapshot, old.seller_user_id, old.manager_user_id, old.created_at, old.review_reasons)
        then raise exception 'Service instance identity and original attribution are immutable'; end if;
        if new.version <> old.version + 1 or new.change_request_id = old.change_request_id then raise exception 'Expected next instance version and a new request ID'; end if;
        -- Payment/onboarding transitions will be owned by SS-03/04 transactions.
        if new.stage is distinct from old.stage and not (
            (old.stage in ('negotiating', 'for_later', 'declined') and new.stage in ('negotiating', 'for_later', 'declined'))
            or (old.stage in ('setup', 'maintenance', 'completed') and new.stage in ('setup', 'maintenance', 'completed'))
        ) then raise exception 'This stage transition requires the sale or onboarding transaction'; end if;
        new.updated_at := clock_timestamp();
    end if;
    if new.origin <> 'legacy_import' then
        if not exists (select 1 from public.workspace_memberships where workspace_id = new.workspace_id and user_id = new.changed_by and role in ('owner', 'admin')) then
            raise exception 'An owner or admin must authorize foundation changes';
        end if;
        if new.assignee_user_id is not null and not exists (
            select 1 from public.workspace_member_service_access a join public.workspace_memberships m using(workspace_id, user_id)
            where a.workspace_id = new.workspace_id and a.service_id = new.service_id and a.user_id = new.assignee_user_id
        ) then raise exception 'Choose a current eligible service assignee'; end if;
        if exists (select 1 from public.relationships r where r.workspace_id = new.workspace_id and r.id = new.relationship_id and r.status = 'archived') then
            raise exception 'Archived relationships cannot accept new service work';
        end if;
    end if;
    return new;
end $$;
create trigger guard_service_instance before insert or update or delete on public.relationship_service_instances for each row execute function public.guard_service_instance();

create function public.record_service_instance_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    insert into public.service_instance_stage_events(workspace_id, instance_id, version, request_id, old_stage, new_stage, old_disposition, new_disposition, old_assignee_user_id, new_assignee_user_id, actor_user_id, reason)
    values(new.workspace_id, new.id, new.version, new.change_request_id, case when tg_op = 'UPDATE' then old.stage end, new.stage,
        case when tg_op = 'UPDATE' then old.disposition end, new.disposition, case when tg_op = 'UPDATE' then old.assignee_user_id end, new.assignee_user_id, new.changed_by, new.change_reason);
    return new;
end $$;
create trigger record_service_instance_event after insert or update on public.relationship_service_instances for each row execute function public.record_service_instance_event();

create function public.guard_service_instance_link() returns trigger
language plpgsql security definer set search_path = public as $$
declare i public.relationship_service_instances%rowtype; line public.client_sale_items%rowtype; sale public.client_sales%rowtype; s public.relationship_onboarding_sessions%rowtype;
begin
    select * into strict i from public.relationship_service_instances where workspace_id = new.workspace_id and id = new.instance_id;
    if tg_table_name = 'service_instance_sale_items' then
        select * into strict line from public.client_sale_items where workspace_id = new.workspace_id and id = new.sale_item_id;
        select * into strict sale from public.client_sales where workspace_id = new.workspace_id and id = line.client_sale_id;
        if sale.id <> new.sale_id or sale.relationship_id is distinct from i.relationship_id or sale.snapshot_frozen_at is null
            or line.service_id is distinct from i.service_id or line.service_revision_id is distinct from i.service_revision_id then
            raise exception 'Sale line must be frozen and match this relationship and service revision';
        end if;
        -- Caller cannot forge prices, currency, cadence or original seller attribution.
        new.seller_user_id := sale.seller_user_id;
        new.manager_user_id := i.manager_user_id;
        new.assignee_user_id := i.assignee_user_id;
        new.commercial_snapshot := jsonb_build_object('line', to_jsonb(line),
            'responsibility', jsonb_build_object('seller_user_id', sale.seller_user_id, 'manager_user_id', i.manager_user_id,
                'assignee_user_id', i.assignee_user_id, 'source', case when i.origin = 'legacy_import' then 'legacy_snapshot_not_certified_historical_assignment' else 'instance_at_sale_link' end),
            'sale', jsonb_build_object(
            'id', sale.id, 'snapshot_frozen_at', sale.snapshot_frozen_at, 'currency', sale.currency,
            'upfront_total_amount', sale.upfront_total_amount, 'recurring_total_amount', sale.recurring_total_amount,
            'billing_interval', sale.billing_interval, 'billing_interval_count', sale.billing_interval_count,
            'seller_user_id', sale.seller_user_id));
    elsif tg_table_name = 'service_instance_sessions' then
        select * into strict s from public.relationship_onboarding_sessions where workspace_id = new.workspace_id and id = new.session_id;
        if s.relationship_id <> i.relationship_id or not exists (
            select 1 from public.service_instance_sale_items l where l.workspace_id = new.workspace_id and l.instance_id = i.id and l.sale_id = s.source_sale_id
        ) then raise exception 'Session must belong to the instance sale'; end if;
        if new.enrollment = 'active' and (s.status <> 'active' or i.import_id is not null) then raise exception 'Only a live active session can acquire enrollment'; end if;
        if tg_op = 'UPDATE' and (to_jsonb(new) - 'enrollment') is distinct from (to_jsonb(old) - 'enrollment') then raise exception 'Session enrollment identity is immutable'; end if;
    elsif tg_table_name = 'service_instance_module_requirements' then
        if not exists (select 1 from public.relationship_onboarding_session_modules m where m.workspace_id = new.workspace_id and m.id = new.session_module_id and m.session_id = new.session_id
            and (m.source_kind = 'mandatory' or m.source_service_revision_id = i.service_revision_id or exists (
                select 1 from public.onboarding_service_revision_modules rm where rm.workspace_id = new.workspace_id and rm.service_revision_id = i.service_revision_id and rm.module_id = m.module_id))) then
            raise exception 'Module must belong to this session and service';
        end if;
    elsif tg_table_name = 'service_instance_work_items' then
        if not exists (select 1 from public.work_items w join public.work_item_relationships l on l.workspace_id = w.workspace_id and l.work_item_id = w.id
            where w.workspace_id = new.workspace_id and w.id = new.work_item_id and l.relationship_id = i.relationship_id
            and (w.service_id is null or w.service_id = i.service_id)) then
            raise exception 'Work must belong to this workspace, relationship and service';
        end if;
    end if;
    return new;
end $$;
create trigger guard_service_instance_sale_item before insert on public.service_instance_sale_items for each row execute function public.guard_service_instance_link();
create trigger guard_service_instance_session before insert or update on public.service_instance_sessions for each row execute function public.guard_service_instance_link();
create trigger guard_service_instance_module before insert on public.service_instance_module_requirements for each row execute function public.guard_service_instance_link();
create trigger guard_service_instance_work before insert on public.service_instance_work_items for each row execute function public.guard_service_instance_link();

-- New tables only: old ownership checks and communications rosters stay unchanged.
create function public.can_read_service_instance(p_workspace_id uuid, p_instance_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
    select public.current_session_is_aal2() and exists (
        select 1 from public.relationship_service_instances i join public.workspace_memberships m on m.workspace_id = i.workspace_id and m.user_id = auth.uid()
        where i.workspace_id = p_workspace_id and i.id = p_instance_id and (
            m.role in ('owner', 'admin') or (i.import_id is null and m.user_id in (i.seller_user_id, i.manager_user_id, i.assignee_user_id))
            or (i.import_id is not null and public.workspace_user_can_access_relationship(i.workspace_id, i.relationship_id, m.user_id)
                and (public.workspace_user_fully_covers_relationship(i.workspace_id, i.relationship_id, m.user_id) or i.assignee_user_id = m.user_id))
        )
    )
$$;
revoke all on function public.can_read_service_instance(uuid, uuid) from public, anon;
grant execute on function public.can_read_service_instance(uuid, uuid) to authenticated, service_role;

-- Restrict writes to server commands. RLS applies to every authenticated read;
-- service-only migration reports and price snapshots do not leak to staff.
do $$
declare t text;
begin
    foreach t in array array['service_instance_imports', 'relationship_service_instances', 'service_instance_stage_events', 'service_instance_sale_items', 'service_instance_sessions', 'service_instance_module_requirements', 'service_instance_work_cycles', 'service_instance_work_items'] loop
        execute format('revoke all on public.%I from public, anon, authenticated', t);
        execute format('grant select, insert on public.%I to service_role', t);
        if t = 'relationship_service_instances' then
            execute format('grant update on public.%I to service_role', t);
            execute format('grant select on public.%I to authenticated', t);
            execute format('create policy instance_read on public.%I for select to authenticated using (public.can_read_service_instance(workspace_id, id))', t);
        elsif t = 'service_instance_sessions' then
            execute format('grant update(enrollment) on public.%I to service_role', t);
        end if;
        if t not in ('service_instance_imports', 'relationship_service_instances', 'service_instance_sale_items') then
            execute format('grant select on public.%I to authenticated', t);
            if t = 'service_instance_work_items' then
                execute format('create policy instance_read on public.%I for select to authenticated using (public.can_read_service_instance(workspace_id, instance_id) and public.workspace_user_can_access_work_item(workspace_id, work_item_id))', t);
            elsif t = 'service_instance_module_requirements' then
                execute format('create policy instance_read on public.%I for select to authenticated using (public.can_read_service_instance(workspace_id, instance_id) and public.workspace_user_can_access_session_module(workspace_id, session_module_id))', t);
            else
                execute format('create policy instance_read on public.%I for select to authenticated using (public.can_read_service_instance(workspace_id, instance_id))', t);
            end if;
        end if;
        if t not in ('relationship_service_instances', 'service_instance_sessions') then
            execute format('create trigger immutable_history before update or delete on public.%I for each row execute function public.reject_service_instance_history_change()', t);
        end if;
    end loop;
end $$;
revoke all on function public.reject_service_instance_history_change(), public.guard_service_instance(), public.record_service_instance_event(), public.guard_service_instance_link() from public, anon, authenticated;
commit;
