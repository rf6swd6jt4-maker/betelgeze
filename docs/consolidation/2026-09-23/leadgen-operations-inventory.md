# Lead Gen operational inventory and reopening gates

Source rechecked for Pass 3 from local consolidation commit `bd35ea85`. This document records repository evidence and instructions for read-only verification. It does not certify any external worker, scheduler, deployment or installed schema as stopped. The coordinator records live observations separately.

## Execution boundaries

| Owner | Candidate behavior | External evidence required |
| --- | --- | --- |
| `lib/leadgen/availability.ts` | One code-owned `OPERATIONS_ENABLED=false` gate; admin history remains | Exact deployed commit/domain, not merely local source |
| Process API and browser refresh | Paused API returns generic 503 before database/provider work; history does not mount processors | Old browser requests and old deployment URL activity |
| Actions and `processLeadgenPoll` | Stale writes rejected; direct runner returns quarantined | Previously admitted requests cannot be recalled by a new deployment |
| Sunbiz import API/direct helpers | Paused before parsing, clearing, upserting or health writes | Secret-authenticated external uploader ownership, input mode and prior accepted batches |
| Five import/build/upload CLI commands | Guard precedes main environment/loading work | Other checkout versions, local/remote processes, scheduled invocations and R2 uploads |
| NER deployment workflow | Separate path-filtered main/manual Deploy Hook; no polling schedule | Actual NER project, domains, old deployments, token presence and request activity |
| NER service | Retains health/person endpoint; source has no DB client or autonomous queue | Source allows unauthenticated inference when `NER_TOKEN` is absent; live configuration remains unknown |
| Automatic cadence fields | Settings are persisted; no runtime consumer found for `automatic_polls_enabled`/`poll_interval_hours` | A saved interval does not prove a scheduler exists or runs |

Repository entrypoint details remain in [the earlier source inventory](./leadgen-external-source-inventory.md). No callable Supabase, Vercel, Cloudflare or R2 connector was available in the inspected tool metadata; GitHub read tools were available. Tool availability is not provider configuration evidence.

## Accepted work means more than parent polls

Use [catalog preflight](./operations/catalog-preflight.sql) before the [bounded read-only inventory](./operations/leadgen-inventory.sql). The latter groups all four child collections against parent status without returning record IDs or client content. Query errors, absent tables, row-cap hits and timeouts are explicitly incomplete evidence. These queries have not been run against production by this package.

A parent is runnable in retained source only while `queued` or `running`. Child `queued`/`running` under failed/completed/cancelled parents does not establish a currently runnable job. Preserve those rows and statuses. The six-minute parent/two-minute child thresholds in the process API are resume heuristics, not worker leases or authority to cancel work.

Prior Pass 1 parent counts were 49 failed, 19 completed and 2 cancelled; eight queued/one running task rows belonged to failed parents. Those dated counts are not a current inventory of investigations, stages, provider-accepted requests or imports. A paused code branch does not make old work disappear.

The optional source-health row is a summary, not an import receipt. The API and CLI import in separate batches and do not keep a durable import job/checkpoint. In replace mode they clear matching rows before the batch loop. If interrupted, neither parent-poll counts nor a missing success summary proves that nothing was written. `markSunbizOwnerIndexImportHealthy` also does not inspect the returned upsert error, so an import response does not certify that health metadata persisted.

## Material reopening blockers

1. **Worker claim ownership.** The retained runner reads parent status and later sets `running` without an atomic claim/lease. Two requests can pass the same eligibility read. Before enabling operations, establish and test one bounded worker owner, crash/lease recovery and provider idempotency. Do not retry a stale poll solely because its timestamp is old.
2. **Operator authorization.** The retained process route checks AAL2 plus any workspace membership; its membership result does not enforce administrator role. History/actions use narrower Lead Gen administration boundaries. Decide and test the intended process permission before reopening; the current paused branch denies everyone before this code.
3. **Retired import target.** Migration `20260707113000_leadgen_v548_retire_sunbiz_supabase_index.sql` drops `leadgen_sunbiz_owner_index`, while retained import API/CLI code still targets it. Check installed existence and choose the intended DB-versus-shard workflow. Do not replay the historical create/drop migrations or assume switching the gate on restores a coherent importer.
4. **Partial/uncertain imports.** Reconcile known input manifests, completed batches and target state before retrying a replace or an old uploader. Future import restoration needs explicit acceptance/checkpoints and a recovery design that cannot clear accepted data before replacement succeeds.
5. **External execution/configuration.** Identify scheduler IDs/owners, enabled state, exact deployment alias and version, active invocation/process state, authentication presence and last/next run. Retain secret values privately; record presence and ownership only. Provider requests already accepted by an old process need their own reconciliation.

These are dormant-path source findings, not newly introduced bypasses of the disabled gate. No remediation, reopening, status normalization or provider change was performed here.

## Pause and reopen sequence

Keep new admission paused while inventorying accepted work. Record the exact affected deployment and scheduler first. If runnable or uncertain work exists, choose a reviewed bounded drain or reversible pause that preserves IDs, source snapshots, receipts, results and statuses. A global code pause alone is not a drain plan. Refresh the inventory after admission is demonstrably stopped; any new row invalidates an earlier empty-backlog assumption.

Reopening requires closure of the blockers above, accepted-work reconciliation, current scope/authorization checks and a small isolated pilot. Restore only the recorded Lead Gen policy/scheduler state. Keep historical relationship `leadgen_company_id` references, evidence, capability identities, source data, storage shards and dependencies until their callers/retention are reviewed independently.

The five observed DB schedules from earlier passes belong to chat recovery/retention, personal work, SOP recovery and WhatsApp notices. README's cron-job.org job owns onboarding-outbox recovery; ClickUp polling is separate. None is a Lead Gen schedule. Do not disable, repurpose or manually execute these workers as a quarantine or health-check shortcut.
