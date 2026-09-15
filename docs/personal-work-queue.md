# Personal Work Queue

The `/queue` panel is the workspace landing page. It combines explicitly owned Admin work and assigned client work; administrative visibility alone never creates responsibility. Existing Library, Admin planning and relationship context remain available.

## Execution

The featured item uses the same List identity/state bands as following records, with a larger goal/rationale/action area. Accept & start records the actual first start. Pause and resume preserve it. Completion requires confirmation of the instructions' completion requirements, uses an optimistic version check and a database transaction, and unlocks dependent tasks. Parent-workflow completion reuses the existing rules through a durable follow-up and retries independently of the saved task completion.

A centered native-top-layer dialog contains the dispute reasons and optional details; Other requires details. There is deliberately no submit control, persistence, chat delivery or learning behaviour in this release. Opening it does not change the underlying list geometry.

## Ranking and reuse

* SQL checks current membership, record visibility, execution ownership, dependency completion, service disposition, relationship archive and scheduled start before eligibility. Canceled prerequisites do not count as completed, consistent with the status-transition guard.
* Explicit execution owners win; otherwise task assignees win; otherwise current service assignment applies. No unassigned-task claim is inferred from admin visibility.
* The background assessor receives bounded task instructions, parent objective, direct prerequisite/downstream work, related service goals and client notes. It evaluates impact, the operational cost of delay, active effort and uncertainty on calibrated scales. This is richer than the previous Admin OKR scoring, but its usefulness still needs a real delivery rehearsal.
* GPT-5.4 mini with low reasoning is the sole model. There is no stronger-model routing. Context fingerprint includes model and policy version so a later explicit model change can invalidate reuse.
* Source changes enqueue durable work. The worker fingerprints context; unchanged input reuses the stored result without another provider request. Ordinary reads, visits and Refresh cannot run an assessment. Existing results remain usable while refreshed; readiness is always live.
* Time-sensitive ordering is computed cheaply from existing assessments: explicit overrides, deadline slack, impact, urgency and bounded age. Effort is a small tie preference, never a value-per-minute ratio that lets tiny chores dominate important work. Started work stays first.
* Context from other client scopes is excluded. Multi-client work omits client notes rather than mixing access scopes. Scores are comparable across services; the model cannot create deadlines, change assignment/dependencies, rewrite instructions or mark work complete. Optional inherited urgency and a more extensive dependency horizon can be evaluated later.
* A changed revision during inference prevents publication and queues the current context. Expired/uncertain calls do not retry automatically; usage stays unknown when provider usage cannot be confirmed. Real content changes permit a new assessment.

## Runtime setup

Apply `20260915120000_personal_work_queue.sql` and then `20260915121000_personal_work_queue_scheduler.sql` before deploying the UI. Existing records are seeded for assessment without making provider calls.

Production requires the existing `OPENAI_API_KEY`, `QUEUE_AI_ENABLED=true`, and the existing `SOP_WORK_CRON_SECRET` (or `CRON_SECRET` fallback). `QUEUE_AI_DAILY_LIMIT` defaults to 500 reservations per workspace per UTC day (maximum 5000); reuse reservations also consume this conservative safety quota. The Supabase schedule checks every five minutes and invokes `/api/cron/work-queue` only when unfinished work exists, processing up to four assessments and one parent completion follow-up. It reuses the existing SOP worker authentication in Vault and the same app host; no credential is copied into cron text. Enable the initially disabled `work_queue_scheduler` row after deployment. The endpoint acknowledges immediately and processes existing durable jobs with Next `after`. The Vercel Hobby daily cron limit makes Vercel cron unsuitable here. Additional parallel scheduler calls are lease/lock protected. This is a throughput limit, not a $35 guarantee or target to spend to.

Usage is stored per work item/workspace in `work_queue_ai_usage`, including billable output and uncertain requests. Model cost uses uncached standard rates conservatively. Relationship allocation can be joined through `work_item_relationships`; shared work must not be counted once per relationship when totaling spend.

The database's actor-taking functions and assessment/usage/follow-up tables are service-only. Application endpoints authenticate with the existing AAL2 workspace session. POST checks same origin, current user, ownership and record version. The native snapshot cache uses the existing user/workspace/route identity.

## Performance and validation

The view reuses the native workspace cache and lazy panel code. No full workspace history, model call, provider poll or new shell bootstrap blocks queue reads. SQL paginates 30 visible rows after global ranking and uses indexed open-work, assignee, dependency and service-link paths. Context extraction and inference run off the interactive path. The refresh control performs one authorized GET, preserving usable content on error.

Local SQL fixture: ownership, private Admin work, prerequisites, one started item, pause/resume timestamp preservation, stale writes, inactive service denial, concurrent assessment edits, context updates, read-only cost behaviour, ordinary-role denial and pagination. The 1000-task read is a fixture measurement, not production end-to-end latency.

Chromium/WebKit component fixtures at 320, 390, 768 and 1440px cover popup geometry, no submit/request, Other details, Escape, start/pause/resume/completion, filtering and overflow. This is browser emulation, not physical-device or authenticated production evidence.

Rollback: revert the app/navigation commit and disable `QUEUE_AI_ENABLED` and `work_queue_scheduler.enabled`; retain additive tables/usage for recovery. Do not drop user work or completion history. Queue triggers can be removed if necessary without deleting assessments. Restore the prior landing route when rolling back the UI.

## Release evidence — 2026-09-15

- Both additive migrations applied to the production schema; the first was rehearsed inside a rolled-back transaction. The scheduler is installed disabled until the application deployment is ready.
- Live authorized reads returned 40 owner-assigned items (20 ready, 20 deferred) and zero eligible assigned items for the other current workspace members. Forty-two open records were queued for initial assessment. These counts are a point-in-time observation.
- Production Webpack build, focused ESLint and all 1,038 repository tests passed. Eleven PostgreSQL fixture scenarios and eight Chromium/WebKit viewport cases passed.
- The actual worker code passed five isolated provider/DB fixture checks: stored-context reuse makes no new provider call, changed context makes one, unknown dispatch records unknown usage, malformed responses retain billed usage but cannot publish, and disabling AI prevents claims.
