# Automatic SOP work: test rollout

Entering **Already onboarded → Setup** for a service attached to a test relationship durably requests work generation when that catalogue service has an enabled SOP source binding. No onboarding session or client profile is required. Normal onboarding transitions into Setup use the same database trigger. Maintenance and Completed entry do not repeat setup. Existing clients are not backfilled. This rollout intentionally accepts only relationships marked Test.

Admins explicitly link a catalogue service and main procedure file in **SOP → Linked services → Link service**. No service/source binding is seeded by the application or migrations. One service has one enabled SOP/source; a conflicting link must be removed on its existing SOP first. The current rollout reads one main source per service, not a synthesis of every SOP asset. Subsequent services reuse a successfully interpreted source.

Generated tasks follow the SOP's generic implementation sequence. Unknown client information becomes instructions to obtain or confirm it when executing the task. Dependencies put preparation before configuration and validation before launch. Missing information alone must not suppress the plan or block every task. Existing assignments are preserved; an unassigned service still gets unassigned work. The generator receives only the SOP interpretation. Relationship profiles, onboarding answers and call notes are excluded. Client-specific blockers and strategic choices are not inferred; unknown decisions become confirmation tasks. This creates work instructions only; it does not execute campaigns, research websites or message the client.

Library, the service chart and the relationship queue reference the same `work_items` rows through `work_item_relationships` and `service_instance_work_items`. Publication inserts the complete graph and original SOP attachments atomically. It does not move the relationship's lifecycle or other services. The graph uses existing dependency and Gantt validation. The group is created inside publication, so failures leave no placeholder or partial flow. Service-work linking rejects a competing generator while SOP generation owns the service.

## Operation and recovery

1. The service transaction inserts one `sop_work_requests` row with a pinned SOP/source. There is no provider call on the foreground save path.
2. A Next.js `after` worker wakes after the service mutation. Supabase cron checks indexed pending work every minute and invokes the same worker only when needed. The endpoint acknowledges immediately and processes with `after`; a closed browser does not lose the request.
3. A workspace budget reservation and exclusive six-minute lease protect each run. Interpretation and generation each record a ledger row before dispatch. Interrupted or failed paid calls require an explicit retry (at most three attempts). Checking progress never calls OpenAI. A saved valid plan retries publication without generation cost.
4. Add service switches the shared dialog to **Generating work…**. A small authenticated status read every 2.5 seconds reports durable milestones, bounded to eight minutes and paused in inactive/hidden tabs. Requests never overlap. On publication it reads the updated queue before closing. Errors remain beneath the progress bar; interrupted status reads offer a read-only check. An unfinished run reopens its progress dialog automatically when the relationship loads; there is no progress link in the queue. The dialog cannot be dismissed while generation is running. Service acceptance does not revalidate the page before the dialog completes. The old work report page redirects to the SOP and its manual start API is retired. Pricing stays in the ledger for reports requested outside the app.
5. Disabling `SOP_WORK_PILOT_ENABLED` stops workers; disabling the service binding stops new acceptance. Existing history and work remain. Source archival, revoked requester access, removed assignee eligibility, archived relationship, moved service stage, and changed evidence prevent later publication.

## Deployment

Apply `20260914110000_sop_work_pilot.sql` after the existing SOP records and service-stage migrations, then `20260914111000_sop_work_scheduler.sql`, `20260914120000_sop_service_generation_flow.sql`, and `20260914121000_sop_progress_access.sql`. The scheduler migration requires Supabase Vault plus `pg_cron`/`pg_net`; it is inert until configured. Production uses the existing OpenAI key unchanged.

Set `SOP_AI_ENABLED=true`, `SOP_WORK_PILOT_ENABLED=true`, `OPENAI_SOP_MODEL=gpt-5.4-mini`, `SOP_AI_DAILY_LIMIT=10`, and a random dedicated `SOP_WORK_CRON_SECRET`. Configure the same worker secret and verified production endpoint with the trusted-server-only `configure_sop_work_scheduler`. Never place the token in source control or a cron command. An admin configures service links through the SOP UI. No automatic runs are backfilled by deployment.

Vercel Hobby cron supports daily invocation, so minute recovery uses [Supabase cron and pg_net](https://supabase.com/docs/guides/functions/schedule-functions). The cron command contains only the database function name; the token is stored in Vault. Idle checks cause no Vercel invocation. See [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Usage evidence

`sop_ai_usage` records each dispatch's stage, model, provider response ID, input/cached/output/reasoning tokens, status and a dated USD rate snapshot. Reasoning tokens are included in output pricing, not charged twice. Source interpretation history and the costs incurred by each generation run are separated. Cached interpretation is not charged again; unknown usage remains unknown. No external web-scraping service is called by this version.

The first production test successfully read 47 SOP steps but failed dependency validation. Its source interpretation and costs are retained. A later pricing report should use that actual ledger after their green light, distinguish first-source processing from repeat-service generation, and explicitly separate provider estimates from hosting/storage/tax and the provider invoice. No live accuracy or measured price is claimed by mocked tests.

## Verification

The isolated SQL fixture uses actual work graph, Gantt, SOP migrations, service-work link guard and relationship queue SQL. It covers transaction rollback, cross-workspace/admin checks, empty onboarding, unassigned work, exactly-once acceptance/publication, source reuse, stale evidence, expiry, revocation, ownership, source attachments, real queue readiness and cost access. A 40-task publication with 5,000 pre-existing work items took about 1.4 seconds in the fixture; a comparable ordinary transaction took about 2.5 seconds. These are fixture observations, not production latency claims. Bounded source/relationship reads use indexes with 30,000 records.

The generic-flow revision validates and stably topologically sorts task dependencies, deduplicates edges, supports up to 39 prerequisites, and rejects self-references, missing tasks and cycles with task-specific errors. Raw output is retained before parsing/validation. No paid repair call is automatic. Structured output uses the [OpenAI supported JSON Schema subset](https://developers.openai.com/api/docs/guides/structured-outputs).

The save wrappers return durable generation acceptance in the existing database round trip. Progress reads use primary/unique keys; service links use a workspace/SOP index and page at 30 records. Source and service choices load only when their selector opens. Changes add no AI call or status polling to navigation. Database fixtures and local Chromium/WebKit UI fixtures are separate from authenticated production or physical-device proof.

The v4 generator supplies explicit numeric step IDs and builds the strict source-reference enum from that exact source. A 47-step source permits only IDs 1 through 47; local and database validation remain in place. This closes the previously unconstrained source-reference output field.
