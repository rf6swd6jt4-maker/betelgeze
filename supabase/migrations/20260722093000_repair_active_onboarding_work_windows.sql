-- Restore the rolling current/next work-item window for active canonical
-- onboarding sessions. A prior non-atomic hand-off could save a submission
-- and complete its work item before failing to create the next window item.

-- The SQL mirror of lib/onboarding/modules.ts. Keep this list in the same
-- order as getOnboardingStepsForModules().
create temporary table canonical_onboarding_module_steps (
    module_key text not null,
    step_order integer not null,
    step_key text not null,
    title text not null,
    description text not null,
    module_title text not null,
    kind text not null,
    form_key text
) on commit drop;

insert into canonical_onboarding_module_steps values
    ('general-info', 0, 'web-access', 'Website Access', 'Share access to your current website, domain, hosting, or website builder if you have one.', 'General Info', 'form', 'web-access'),
    ('general-info', 1, 'business-info', 'Business Information', 'Tell us where you operate, what services you provide, and the areas you want to target.', 'General Info', 'form', 'business-info'),
    ('general-info', 2, 'cta-information', 'Call-to-Action Information', 'Tell us what you want customers to do, such as call, request a quote, book a visit, or fill out a form.', 'General Info', 'form', 'cta-information'),
    ('general-info', 3, 'usps', 'Why Customers Choose You', 'Tell us what makes your business different, better, faster, more reliable, or more trusted than competitors.', 'General Info', 'form', 'usps'),
    ('general-info', 4, 'competitors', 'Competitors', 'Share competitors or similar businesses so we understand your local market.', 'General Info', 'form', 'competitors'),
    ('general-info', 5, 'accreditations', 'Accreditations and Trust Signals', 'Share qualifications, trade memberships, certifications, guarantees, awards, or insurance details.', 'General Info', 'form', 'accreditations'),
    ('general-info', 6, 'process', 'Your Process', 'Explain how a customer usually works with you from first contact to completed job.', 'General Info', 'form', 'process'),
    ('general-info', 7, 'history', 'Business History', 'Tell us how the business started, how long you have been operating, and anything that builds trust.', 'General Info', 'form', 'history'),
    ('google-search-ads', 0, 'ga-access', 'Google Analytics Access', 'Share Google Analytics access so we can understand website traffic and track important actions.', 'Google Search Ads', 'video', null),
    ('google-search-ads', 1, 'gtm-access', 'Google Tag Manager Access', 'Share Google Tag Manager access so we can set up tracking without repeatedly editing your website.', 'Google Search Ads', 'video', null),
    ('website-lp', 0, 'logo', 'Logo', 'Upload or share your logo so we can use the correct brand assets.', 'Website / Landing Page Assets', 'form', 'logo'),
    ('website-lp', 1, 'before-after-images', 'Job Site Before and After Images', 'Share examples of completed work, especially before and after photos if you have one.', 'Website / Landing Page Assets', 'form', 'before-after-images'),
    ('website-lp', 2, 'team-pictures', 'Team Pictures', 'Share photos of you, your team, vans, workshop, or job sites to make the business feel trustworthy.', 'Website / Landing Page Assets', 'form', 'team-pictures'),
    ('website-lp', 3, 'branding', 'Colours, Slogan, and Branding', 'Share preferred colours, slogans, fonts, existing branding, or examples you like.', 'Website / Landing Page Assets', 'form', 'branding'),
    ('website-lp', 4, 'video-assets', 'Video Assets', 'Share any videos of your team, jobs, testimonials, vehicles, workshop, or finished work.', 'Website / Landing Page Assets', 'form', 'video-assets');

-- Create the missing active step. Its actual start is the exact completion of
-- the preceding step (or the session creation instant for Welcome).
with session_steps as (
    select session.id as session_id, session.workspace_id, session.relationship_id, session.created_at as session_created_at,
        0 as ordinal, 'welcome-video'::text as step_key, 'Welcome'::text as title,
        'We’ll explain how this onboarding works and what we need from you.'::text as description,
        'General'::text as module_title, 'video'::text as kind, null::text as form_key
    from public.relationship_onboarding_sessions session
    where session.status = 'active'
    union all
    select session.id, session.workspace_id, session.relationship_id, session.created_at,
        row_number() over (partition by session.id order by module.created_at, step.step_order)::integer,
        step.step_key, step.title, step.description, step.module_title, step.kind, step.form_key
    from public.relationship_onboarding_sessions session
    join public.relationship_onboarding_modules module
      on module.workspace_id = session.workspace_id and module.relationship_id = session.relationship_id
    join canonical_onboarding_module_steps step on step.module_key = module.module_key
    where session.status = 'active'
), step_items as (
    select steps.*, item.id as work_item_id, item.status, item.actual_completed_at, item.updated_at
    from session_steps steps
    left join public.work_items item
      on item.workspace_id = steps.workspace_id
     and item.native_kind = 'onboarding_step'
     and item.native_key = steps.session_id::text || ':' || steps.step_key
), current_steps as (
    select distinct on (session_id) *
    from step_items
    where coalesce(status, 'todo') <> 'done'
    order by session_id, ordinal
)
insert into public.work_items (
    workspace_id, title, description, lifecycle_phase, status, priority, is_key_task,
    native_kind, native_key, native_href, parent_work_item_id, workflow_role,
    actual_start_at, actual_start_has_time, sort_order, metadata
)
select current.workspace_id, current.title, current.description, 'onboarding', 'todo', 3, true,
    'onboarding_step', current.session_id::text || ':' || current.step_key,
    '/' || workspace.slug || '/onboarding/' || current.relationship_id::text,
    stage.id, 'task', coalesce(previous.actual_completed_at, previous.updated_at, current.session_created_at), true,
    current.ordinal * 10,
    jsonb_build_object('session_id', current.session_id, 'relationship_id', current.relationship_id, 'step_key', current.step_key,
        'module_title', current.module_title, 'kind', current.kind, 'form_key', current.form_key, 'auto_created', true)
from current_steps current
join public.work_items stage
  on stage.workspace_id = current.workspace_id
 and stage.native_kind = 'relationship_workflow'
 and stage.native_key = current.relationship_id::text || ':onboarding'
join public.workspaces workspace on workspace.id = current.workspace_id
left join step_items previous on previous.session_id = current.session_id and previous.ordinal = current.ordinal - 1
where current.work_item_id is null
on conflict (workspace_id, native_kind, native_key) where native_kind is not null and native_key is not null do nothing;

-- A previously-created current item may also be missing its exact start.
with session_steps as (
    select session.id as session_id, session.workspace_id, session.created_at as session_created_at, 0 as ordinal, 'welcome-video'::text as step_key
    from public.relationship_onboarding_sessions session where session.status = 'active'
    union all
    select session.id, session.workspace_id, session.created_at,
        row_number() over (partition by session.id order by module.created_at, step.step_order)::integer, step.step_key
    from public.relationship_onboarding_sessions session
    join public.relationship_onboarding_modules module on module.workspace_id = session.workspace_id and module.relationship_id = session.relationship_id
    join canonical_onboarding_module_steps step on step.module_key = module.module_key
    where session.status = 'active'
), step_items as (
    select steps.*, item.id as work_item_id, item.status, item.actual_completed_at, item.updated_at, item.actual_start_at
    from session_steps steps
    left join public.work_items item on item.workspace_id = steps.workspace_id and item.native_kind = 'onboarding_step'
      and item.native_key = steps.session_id::text || ':' || steps.step_key
), current_steps as (
    select distinct on (session_id) * from step_items where coalesce(status, 'todo') <> 'done' order by session_id, ordinal
)
update public.work_items current
set actual_start_at = coalesce(previous.actual_completed_at, previous.updated_at, current_step.session_created_at),
    actual_start_has_time = true,
    updated_at = now()
from current_steps current_step
left join step_items previous on previous.session_id = current_step.session_id and previous.ordinal = current_step.ordinal - 1
where current.id = current_step.work_item_id
  and current.actual_start_at is null;

-- Maintain one grey next step after the active one, without giving it a
-- fictional planned range. Its dependency makes the Gantt anchor it at now.
with session_steps as (
    select session.id as session_id, session.workspace_id, session.relationship_id, 0 as ordinal,
        'welcome-video'::text as step_key, 'Welcome'::text as title, 'We’ll explain how this onboarding works and what we need from you.'::text as description,
        'General'::text as module_title, 'video'::text as kind, null::text as form_key
    from public.relationship_onboarding_sessions session where session.status = 'active'
    union all
    select session.id, session.workspace_id, session.relationship_id,
        row_number() over (partition by session.id order by module.created_at, step.step_order)::integer,
        step.step_key, step.title, step.description, step.module_title, step.kind, step.form_key
    from public.relationship_onboarding_sessions session
    join public.relationship_onboarding_modules module on module.workspace_id = session.workspace_id and module.relationship_id = session.relationship_id
    join canonical_onboarding_module_steps step on step.module_key = module.module_key
    where session.status = 'active'
), step_items as (
    select steps.*, item.id as work_item_id, item.status, item.parent_work_item_id
    from session_steps steps
    left join public.work_items item on item.workspace_id = steps.workspace_id and item.native_kind = 'onboarding_step'
      and item.native_key = steps.session_id::text || ':' || steps.step_key
), current_steps as (
    select distinct on (session_id) * from step_items where coalesce(status, 'todo') <> 'done' order by session_id, ordinal
)
insert into public.work_items (
    workspace_id, title, description, lifecycle_phase, status, priority, is_key_task,
    native_kind, native_key, native_href, parent_work_item_id, workflow_role, sort_order, metadata
)
select next.workspace_id, next.title, next.description, 'onboarding', 'todo', 3, true,
    'onboarding_step', next.session_id::text || ':' || next.step_key,
    '/' || workspace.slug || '/onboarding/' || next.relationship_id::text,
    current.parent_work_item_id, 'task', next.ordinal * 10,
    jsonb_build_object('session_id', next.session_id, 'relationship_id', next.relationship_id, 'step_key', next.step_key,
        'module_title', next.module_title, 'kind', next.kind, 'form_key', next.form_key, 'auto_created', true)
from current_steps current
join step_items next on next.session_id = current.session_id and next.ordinal = current.ordinal + 1
join public.workspaces workspace on workspace.id = next.workspace_id
where next.work_item_id is null
on conflict (workspace_id, native_kind, native_key) where native_kind is not null and native_key is not null do nothing;

-- Make all repaired work visible on the relationship and restore the two
-- sequential dependency edges around the active step.
insert into public.work_item_relationships (workspace_id, work_item_id, relationship_id)
select session.workspace_id, item.id, session.relationship_id
from public.relationship_onboarding_sessions session
join public.work_items item on item.workspace_id = session.workspace_id
  and item.native_kind = 'onboarding_step' and item.native_key like session.id::text || ':%'
where session.status = 'active'
on conflict (work_item_id, relationship_id) do nothing;

with session_steps as (
    select session.id as session_id, session.workspace_id, 0 as ordinal, 'welcome-video'::text as step_key
    from public.relationship_onboarding_sessions session where session.status = 'active'
    union all
    select session.id, session.workspace_id,
        row_number() over (partition by session.id order by module.created_at, step.step_order)::integer, step.step_key
    from public.relationship_onboarding_sessions session
    join public.relationship_onboarding_modules module on module.workspace_id = session.workspace_id and module.relationship_id = session.relationship_id
    join canonical_onboarding_module_steps step on step.module_key = module.module_key
    where session.status = 'active'
), step_items as (
    select steps.*, item.id as work_item_id, item.status
    from session_steps steps
    left join public.work_items item on item.workspace_id = steps.workspace_id and item.native_kind = 'onboarding_step'
      and item.native_key = steps.session_id::text || ':' || steps.step_key
), current_steps as (
    select distinct on (session_id) * from step_items where coalesce(status, 'todo') <> 'done' order by session_id, ordinal
), edges as (
    select current.workspace_id, current.work_item_id, previous.work_item_id as depends_on_work_item_id
    from current_steps current
    join step_items previous on previous.session_id = current.session_id and previous.ordinal = current.ordinal - 1
    where current.work_item_id is not null and previous.work_item_id is not null
    union all
    select current.workspace_id, next.work_item_id, current.work_item_id
    from current_steps current
    join step_items next on next.session_id = current.session_id and next.ordinal = current.ordinal + 1
    where current.work_item_id is not null and next.work_item_id is not null
)
insert into public.work_item_dependencies (workspace_id, work_item_id, depends_on_work_item_id, source)
select workspace_id, work_item_id, depends_on_work_item_id, 'manual' from edges
on conflict (work_item_id, depends_on_work_item_id) do nothing;
