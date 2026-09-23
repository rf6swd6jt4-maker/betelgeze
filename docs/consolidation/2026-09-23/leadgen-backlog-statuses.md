# Lead Gen backlog status inventory (source only)

Audited source commit: `31388081894e6d4143d5bb0d577c0341ec31edf7`.
No live query was run for this inventory. Installed production constraints must be verified separately.

| Table | Repository SQL states | Source |
| --- | --- | --- |
| leadgen_polls | queued, running, completed, failed, cancelled | supabase/migrations/20260625010000_leadgen_polls_foundation.sql:16 |
| leadgen_poll_tasks | queued, running, completed, failed, cancelled | supabase/migrations/20260625223000_leadgen_real_osm_ingestion.sql:51 |
| leadgen_investigation_tasks | queued, running, completed, skipped, failed | supabase/migrations/20260628170000_leadgen_source_fanout_foundation.sql:28 |
| leadgen_poll_stage_runs | queued, running, completed, failed, skipped | supabase/migrations/20260629153000_leadgen_staged_poll_process.sql:21 |
| leadgen_company_stage_status | queued, running, passed, failed, skipped | supabase/migrations/20260629153000_leadgen_staged_poll_process.sql:43 |

Runtime agreement: `lib/leadgen/staged-poll.ts:6` defines stage states; `:7` models company stage writes as passed/failed/skipped. `lib/leadgen/evidence-scoring.ts:32` models investigation task states. `lib/leadgen/poll-runner.ts:214-215` refuses any parent poll except queued/running. The process endpoint checks running first, then oldest queued (`app/api/leadgen/polls/process/route.ts:58-82`). Running polls become eligible for consideration as stale at six minutes, while a running child task started within two minutes prevents immediate resume (`:10-30`). These are resume heuristics, not proof a job is executing or safe to cancel.

Count grouped states, including unexpected installed values, rather than filtering only an assumed enum. Active/backlog states are queued/running, not pending/processing. Keep parent and child groups separate. `cancelLeadgenPoll` updates parent status only (`app/[workspaceSlug]/leadgen/actions.ts:96-104`), so child queued/running counts can include children of cancelled/terminal parents. A parent-status join distinguishes runnable backlog from abandoned child bookkeeping without modifying either.

Before quarantine, retain an authorized bounded inventory of active parent IDs, workspace IDs, statuses, started_at/created_at and counts by child status. Do not inspect or export message bodies, credentials, or bulk raw source payloads. Use a read-only transaction and a short statement timeout appropriate to production when root runs the approved diagnostics. Preserve every accepted row; an age cutoff alone does not authorize deletion, cancellation, or completion.
