# Automatic SOP work: test rollout

Entering **Already onboarded → Setup** for a service attached to a test relationship durably requests work generation when that catalogue service has an enabled SOP source binding. No onboarding session or client profile is required. Normal onboarding transitions into Setup use the same database trigger. Maintenance and Completed entry do not repeat setup. Existing clients are not backfilled. This rollout intentionally accepts only relationships marked Test.

The production binding is **Meta Ads Setup → Meta Ads → SCAYLUP META ADS SOP.pdf**. Other services need their own explicit source binding via the admin-only `set_sop_service_source` command. The current rollout reads one main source per service, not a synthesis of every SOP asset. Subsequent services reuse a successfully interpreted source.

Generated tasks follow the SOP's generic implementation sequence. Unknown client information becomes instructions to obtain or confirm it when executing the task. Dependencies put preparation before configuration and validation before launch. Missing information alone must not suppress the plan or block every task. Existing assignments are preserved; an unassigned service still gets unassigned work. A concrete known blocker may be marked Blocked. This creates work instructions only; it does not execute campaigns, research websites or message the client.

Library, the service chart and the relationship queue reference the same `work_items` rows through `work_item_relationships` and `service_instance_work_items`. Publication inserts the complete graph and original SOP attachments atomically. It does not move the relationship's lifecycle or other services. The graph uses existing dependency and Gantt validation. The service's reserved group cannot be overwritten by a competing generator.

## Operation and recovery

1. The service transaction inserts one `sop_work_requests` row with a pinned SOP/source. There is no provider call on the foreground save path.
2. A Next.js `after` worker wakes after the service mutation. Supabase cron checks indexed pending work every minute and invokes the same worker only when needed. The endpoint acknowledges immediately and processes with `after`; a closed browser does not lose the request.
3. A workspace budget reservation and exclusive six-minute lease protect each run. Interpretation and generation each record a ledger row before dispatch. Interrupted or failed paid calls require an explicit retry (at most three attempts). Refreshing a queue/report never calls OpenAI. A saved valid plan retries publication without generation cost.
4. The relationship queue shows pending, published or failed generation with an admin report link. It checks a pending run every ten seconds for at most four minutes, only while visible and in the active tab; requests do not overlap. Refresh remains available. The report has existing bounded five-second polling and a JSON download.
5. Disabling `SOP_WORK_PILOT_ENABLED` stops workers; disabling the service binding stops new acceptance. Existing history and work remain. Source archival, revoked requester access, removed assignee eligibility, archived relationship, moved service stage, and changed evidence prevent later publication.

## Deployment

Apply `20260914110000_sop_work_pilot.sql` after the existing SOP records and service-stage migrations, then `20260914111000_sop_work_scheduler.sql`. The latter requires Supabase Vault plus `pg_cron`/`pg_net`; its scheduler is inert until configured. Production uses the existing OpenAI key unchanged.

Set `SOP_AI_ENABLED=true`, `SOP_WORK_PILOT_ENABLED=true`, `OPENAI_SOP_MODEL=gpt-5.4-mini`, `SOP_AI_DAILY_LIMIT=10`, and a random dedicated `SOP_WORK_CRON_SECRET`. Configure the same worker secret and verified production endpoint with the trusted-server-only `configure_sop_work_scheduler`. Never place the token in source control or a cron command. Configure the Meta Ads binding using a current workspace admin. No automatic runs are backfilled by deployment.

Vercel Hobby cron supports daily invocation, so minute recovery uses [Supabase cron and pg_net](https://supabase.com/docs/guides/functions/schedule-functions). The cron command contains only the database function name; the token is stored in Vault. Idle checks cause no Vercel invocation. See [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Usage evidence

`sop_ai_usage` records each dispatch's stage, model, provider response ID, input/cached/output/reasoning tokens, status and a dated USD rate snapshot. Reasoning tokens are included in output pricing, not charged twice. Source interpretation history and the costs incurred by each generation run are separated. Cached interpretation is not charged again; unknown usage remains unknown. No external web-scraping service is called by this version.

The user will run the first production relationship. A later pricing report should use that actual ledger after their green light, distinguish first-source processing from repeat-service generation, and explicitly separate provider estimates from hosting/storage/tax and the provider invoice. No live accuracy or measured price is claimed by mocked tests.

## Verification

The isolated SQL fixture uses actual work graph, Gantt, SOP migrations, service-work link guard and relationship queue SQL. It covers transaction rollback, cross-workspace/admin checks, empty onboarding, unassigned work, exactly-once acceptance/publication, source reuse, stale evidence, expiry, revocation, ownership, source attachments, real queue readiness and cost access. A 40-task publication with 5,000 pre-existing work items took about 1.4 seconds in the fixture; a comparable ordinary transaction took about 2.5 seconds. These are fixture observations, not production latency claims. Bounded source/relationship reads use indexes with 30,000 records.

Release validation: 999 repository tests, 15 focused SOP work tests, 13 SQL fixture check groups, changed-file ESLint and production Webpack build pass. Chromium and WebKit fixtures pass at 320/390/768/1280 widths for the generation UI, including lost acknowledgements and hidden-tab pausing; the relationship queue passes at 320/1280 with pending-to-published updates and shared work links. Browser fixtures use mocked provider responses, not real OpenAI or authenticated production sessions. Physical-device and first real generation results remain for the user's test.

The two migrations and Meta Ads source binding are installed in production. The existing OpenAI key was verified present and unchanged; the five additional production variables were configured. Scheduler activation follows the successful application deployment.
