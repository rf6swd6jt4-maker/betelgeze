# Lead Gen external execution inventory — repository evidence only

Inspected candidate worktree `/private/tmp/betelgeze-platform-consolidation`, baseline `31388081894e6d4143d5bb0d577c0341ec31edf7`, on 2026-09-23. No provider/dashboard/process inventory or production calls were made for this review. No external configuration was changed.

## Source-proven execution paths

| Surface | Evidence | Candidate behavior / external boundary |
| --- | --- | --- |
| Browser-driven poll processing | `components/leadgen/PollsAutoRefresh.tsx:7-49`; `app/[workspaceSlug]/leadgen/polls/page.tsx:167` | Existing widget POSTs the process route after 250 ms and at five-second intervals when the tab is active. The candidate paused polls page returns before mounting it. Old clients can still issue HTTP requests. |
| Poll worker HTTP entry | `app/api/leadgen/polls/process/route.ts:33-84` | New candidate returns paused 503 before auth/reads/provider work. The retained enabled branch uses authenticated AAL2 membership, not a cron-secret mode; its runner calls are lines69/84. |
| Poll actions / direct runner | `app/[workspaceSlug]/leadgen/actions.ts:37-39,112-127`; `lib/leadgen/poll-runner.ts:209-215` | Candidate guards actions and runner. Source creation is manual. Retry invokes runner. No separate dispatch loop found outside these paths. |
| Automatic cadence settings | `lib/leadgen/settings-page-data.ts:99`; `app/[workspaceSlug]/leadgen/settings/actions.ts:249-254`; `app/[workspaceSlug]/settings/page.tsx:222-225` | Values are persisted and rendered, but repository search finds no runnable consumer of `automatic_polls_enabled` / `poll_interval_hours`. Stored flags alone are not scheduler evidence. |
| Sunbiz import HTTP | `app/api/leadgen/sunbiz/import/route.ts:17-22,64-84` | Candidate returns paused503 before body/auth/import. Retained enabled branch is secret-authenticated using `LEADGEN_SUNBIZ_IMPORT_SECRET`; an external uploader is possible. |
| Five local import/build/upload commands | `package.json:11-15`; `scripts/import-sunbiz-owner-index.ts:469-470`; `scripts/build-sunbiz-shards.ts:279-280`; `scripts/upload-sunbiz-shards.ts:149-150`; `scripts/build-arizona-owner-shards.ts:314-315`; `scripts/upload-arizona-owner-shards.ts:149-150` | Candidate guards at main entry before env/read/provider mutation. The import script retains both HTTP and direct Supabase paths (lines273,350). Upload scripts retain R2 PutObject calls (line134). A previously launched process or older checkout is outside the new policy. |
| Separate NER deployment | `.github/workflows/deploy-ner.yml:3-10,25,31-36`; `services/ner/vercel.json:3-5`; `services/ner/README.md:24-47` | Repository describes a separate Vercel project. Git auto-deploy is disabled in its config; path-filtered main push or workflow_dispatch invokes the production Deploy Hook through a GitHub secret. The existing service remains deployed between releases. This is deployment automation, not a polling schedule. |
| NER requests | `lib/leadgen/person-name-gate.ts:166-175,191-212`; `services/ner/app.py:45-79` | Main runner can call configured LEADGEN_NER_ENDPOINT; candidate stops upstream runner admission. Separate service retains `/health` and `/person-ner`; it authorizes if NER_TOKEN exists and accepts no-auth if absent. Source alone cannot establish production token state. No timer, scheduler, DB client or autonomous queue consumer exists in this small service source. |
| Repository scheduler files | Tracked root has no `vercel.json`, Docker/Compose, Procfile, systemd/launchd config, Railway/Render/Fly/Wrangler job config. The inspected baseline has only the NER deployment workflow. Search of Lead Gen migrations finds no cron.schedule/net.http_* dispatch. | Absence of tracked config does not establish absence of externally managed schedules or manual workers. |

## Protected unrelated schedules

`README.md:288-315` documents an external cron-job.org onboarding-outbox job every15minutes. `README.md:200-202` documents optional external ClickUp polling. These are not Lead Gen ownership evidence and must not be disabled as part of this quarantine. Parent separately owns the database cron inventory and protected alerts/outbox contracts.

## Still unknown / promotion limits

- Whether an external scheduler calls the import or process route, the exact job IDs, owners, domains/aliases, authentication method, enabled state and last/next run.
- Whether old Vercel deployment URLs remain callable, or accepted requests in an old process are still executing.
- Whether any local/remote cron, CI elsewhere, long-running import, direct-Supabase uploader, or R2 uploader uses a different checkout.
- Current NER project/domain/deployment status, configured token/enabled flags, external callers, request activity and costs. No claim that NER is disabled.
- All grouped child/backlog state and active import receipts require the coordinator's separate live inventory. Terminal parent rows with queued/running children are preserved, not normalized.

The bounded reversible action implemented here is source admission/runner pause with all accepted records/statuses intact. There is no justified external scheduler mutation from repository evidence alone. New deployed guards cannot recall a provider request already accepted by an old process.
