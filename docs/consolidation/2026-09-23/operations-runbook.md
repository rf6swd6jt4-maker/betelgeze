# Betelgeze operational foundations

This is the Pass 3 operating and extension contract for the local consolidation candidate. It complements, and does not replace, [app_speed.md](../../../app_speed.md) and the protected [app-alerts.md](../../../app-alerts.md). It is not deployment or production-write authorization. Source, local fixtures, installed schema, deployed commit, authenticated UI, provider acceptance and physical-device receipt remain separate evidence.

## Everyday recovery

| Observed problem | Preserve / inspect first | Supported next action |
| --- | --- | --- |
| Panel is loading, timed out or failed | Existing tab/editor, current requested URL, save/error state | Use the affected panel's explicit Retry after draft safety is confirmed. Do not reset unrelated tabs or trigger a timer-based reload. |
| Save acknowledgement is missing | Original actor/workspace/request identity and exact local draft | Retry the same saved request. A timeout or transport failure is not proof of non-commit. Do not create a replacement request or delete a possible accepted record. |
| Create request is authoritatively rejected | Terminal receipt and preserved draft | Use the supported Edit saved draft flow. Corrected intent receives a new request only after the old request is known to be terminal; an asset may need file reselection. |
| Note field conflict | Local text plus current server value/baseline | Review and resubmit through the versioned field operation. Do not overwrite the complete stale form or replace unseen relationship links. |
| Attachment saved but list refresh failed | Confirmed write, current list/cache owner | Retry the bounded list read. Do not relink as if the successful write failed. |
| Storage denied or draft corrupt | Browser/account/context and existing recovery entries | Retain the open editor and report the precise error. Do not clear localStorage, remove entries or silently start a new create to dismiss the error. |
| Upload PUT outcome is uncertain | Same file, request ID, signed receipt and immutable object key | Reconcile that upload via the supported flow before record creation. Never overwrite the key or garbage-collect possibly accepted objects as a retry strategy. File bytes before the durable create checkpoint are not recoverable after browser termination. |
| External notification/send outcome is unknown | Durable job state and provider receipt, with recipient scope | Reconcile provider acceptance before retry. Queue acceptance, provider acceptance and actual receipt are different facts. Do not manually set jobs back to queued because they are old. |
| Lead Gen is paused | Historical parents, child states, imports and provider work | Read authorized history. Follow the [inventory/reopening gates](./leadgen-operations-inventory.md); do not normalize statuses or flip a single flag to “fix” paused processing. |

Use the existing owning UI/action/worker, not ad hoc database repair, for routine recovery. A logged-in administrator can still have stale account/workspace state: every retry must recheck current access. If supported recovery remains blocked, retain evidence and make a narrow, identified repair proposal instead of inventing a success state.

Do not test production by calling worker routes. A GET method is not evidence of read-only behavior: `/api/cron/onboarding-outbox` claims jobs and can process both deliveries and storage cleanup. Likewise, generic asset upload preparation calls `ensurePlatformDirectUploads`; with Cloudflare credentials this can update bucket CORS before signing. These are operational mutation/provider boundaries, not passive health probes.

## Read-only diagnosis

1. Verify the project/deployment/account being inspected. Record commit, UTC observation time and the affected operation; exclude client bodies, tokens, upload URLs and raw command payloads from diagnostics.
2. Run [catalog preflight](./operations/catalog-preflight.sql) through trusted database tooling. It returns relation presence, estimated row counts, columns, function signatures/hashes/grants, trigger bindings and indexes. Estimates are not exact counts. It deliberately returns no function source or cron command text.
3. When needed, run [Lead Gen inventory](./operations/leadgen-inventory.sql) after confirming its tables and `cron.job` exist. It preserves one read-only snapshot and reports parent/child counts with explicit completeness caps. Row limits bound returned/materialized rows, not all heap pages visited; its five-second statement timeout is intentional. A timeout, missing relation or cap hit is unknown, not an empty backlog.
4. For a specific unresolved record command, inspect only its authorized workspace/actor/request key, status, record ID and created time. `record_attachment_commands.payload` contains private intent and must not be exported with `SELECT *`. Do not delete receipts or change terminal status. Investigate one identified request rather than scanning client histories.
5. Keep operational dependencies separate: DB cron enabled state does not prove successful invocation, a dispatch function's success does not prove the HTTP request succeeded, and HTTP/provider acceptance does not prove end-user receipt. Inspect only permitted execution/status metadata through the actual owner's tools.

The SQL files contain no DDL, data writes or worker calls; both explicitly start read-only transactions and roll back. They assume standard Supabase roles. The isolated validator proves parsing, redaction-by-projection, parent/child distinctions, cap disclosure and read-only write rejection against synthetic PGlite data. It does not prove installed schema, RLS, live query cost or provider state.

```sh
PGLITE_PACKAGE_ROOT=/path/to/node_modules/@electric-sql/pglite node scripts/validate-operations-inventory.mjs
```

This package's local result is 8/8. Optional test tooling belongs outside the application dependency graph. The queries are reviewed diagnostics, not a new polling job or application read path.

## Schema, release and rollback order

| Gate | Required evidence |
| --- | --- |
| Preserve baseline | Exact app commit; installed function signatures/hashes, grants, trigger bindings and relevant counts; bounded current accepted-work inventory |
| Rehearse | Isolated schema and realistic constraints; cross-workspace/role denial; atomic rollback; same-request and competing-writer behavior; later archive/access changes |
| Confirm installation plan | Exact additive migration files and expected before/after definitions; lock/index cost; no historical replay or backfill hidden in the release |
| Install schema before callers | A1 `20260923170000_note_attachment_integrity.sql`, then A4 `20260923171000_record_attachment_commands.sql`, with reviewed installed-schema compatibility and any subsequently required repair migration |
| Verify installation | Exact definitions/signatures and service-only commands; preserved old rows and link constraints; explicit migration-history reconciliation |
| Release compatible application | Exact reviewed commit and terminal deployment status; required functions absent must fail visibly, with no fallback to unsafe multi-write or blind overwrite |
| Verify behavior | Authenticated read/navigation; isolated permitted write fixtures; real storage header/CORS/conditional behavior; matched timing and separate browser/device results |
| Reconcile | Accepted/unconfirmed browser requests, queued/uncertain provider work, scheduler health and the final release record |

The earlier live audit found no `supabase_migrations.schema_migrations` relation. Verify again, but never repair this by replaying the entire migration directory or inserting guessed history. That directory includes destructive historical Lead Gen migrations; installed production can differ from chronological source assumptions. A SQL Editor success is not recorded migration parity. A1/A4 are local candidates until separately installed and verified.

Rollback the application first with a compatible build that retains safe command handlers. Keep additive receipt tables/functions, the corrected note trigger, accepted records/links, stored objects, pending jobs and local drafts. Returning to a build with blind note replacement or sequential create/link would restore known defects; disable the affected writes or retain guards instead. Do not roll back by deleting accepted work, restoring unsafe trigger behavior, truncating caches/drafts, undoing immutable sale/service revisions or disabling unrelated recovery schedules.

Protected read/unread/activity/push behavior and its schedulers remain governed by `app-alerts.md`. Its explicit authorization requirement also applies to indirect changes in tab visibility, account handling and shared retry/recovery code. This document grants no exception.

## Backup and restore evidence

Pro plan backup availability was observed in the signed-in dashboard: scheduled physical DB backups through 23 September 2026, latest observed at 05:24:03 UTC. This is availability evidence, not a successful restore rehearsal. The dashboard states Storage API objects are excluded. R2 assets, encryption dependencies, auth/provider settings, deployment configuration and local unsent drafts require their own recovery plan.

Before treating recovery as verified, record all of the following:

- Backup identifier/time, retention and the required data-loss/recovery window; identify the exact database target and separate object stores.
- A restore rehearsal into an isolated destination with external workers, webhooks, schedules and real delivery disabled; never use production overwrite/Restore as a routine test.
- Schema/constraint/function/grant consistency and authorized access after restoration; validate record references and immutable sale/onboarding history without exporting client content.
- Authorized verification that referenced Supabase/R2 objects and required decryption/configuration dependencies are recoverable. A DB row, object listing or ETag alone is not restored readable content. Never publish secret material in the runbook.
- A measured elapsed recovery result and explicit missing scope. Browser-only unsubmitted File bytes or drafts erased by the user are not restored by a database backup.

No restore rehearsal, storage-object recovery or disaster-recovery time objective has been established by these consolidation passes. Keep this gap visible; do not infer safety from the Pro subscription or a Healthy project label.

## Contract for future additions

Before implementation, name the existing owner, scope and acceptance boundary for each read, write and background action. The review must answer these with behavior evidence:

| Extension | Required contract and regression |
| --- | --- |
| New list/detail read | Authorized minimal projection; bounded page/search and deterministic cursor; account/workspace/query cache scope; timeout including parsing; stale response cannot replace current data |
| New editor | One mutation owner; honest pending/error/conflict states; durable intent or retained owner before discard; storage/account failure and late-input navigation tests |
| New command | Atomic domain update and receipt; same-key/same-payload replay; changed payload rejection; current access on retry; explicit unknown versus terminal failure |
| New provider action | Durable accepted work, one claim owner/lease, idempotency or uncertain-outcome reconciliation, bounded retry/lifetime, verified scheduling and separate provider/receipt evidence |
| New upload | Server-issued actor/workspace provenance; immutable key and matching signed headers; bounded authoritative object validation; no delete/overwrite compensation after uncertainty |
| New scheduler | Identified owner/environment/job, auth presence without exposing values, bounded work/leases, last successful execution, failure signal, and rollback preserving accepted work |
| New migration | Additive verified prerequisite order, immutable historical files, installed-schema comparison, permissions/concurrency/rollback tests and explicit recorded-history status |

Reuse the existing commands, outboxes, UI primitives and performance vocabulary; do not create a second implicit ownership or retry framework. Prefer regression tests that reproduce stale responses, simultaneous requests, lost acknowledgements and access changes over source-text assertions alone. Relevant existing suites include `record-create-actions`, `note-concurrency`, `record-attachments-loading`, `asset-upload-provenance`, `leadgen-quarantine`, and the workspace navigation/alert-preservation suites. [Foundations CI](./foundations-ci.md) records the migration/scoped-lint/test/build and isolated PostgreSQL checks; a document or workflow file is not proof that branch protection or deployment checks are active.
