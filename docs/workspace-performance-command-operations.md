# Performance commands and appointment notification jobs

These paths are included in the PR, remain disabled by default, and require staged verification. The legacy actions remain available. No migration, provider delivery, or scheduler configuration was applied to production while preparing this change.

## Enablement order

1. Apply the expand-only migrations `20260910150000_appointment_draft_command_receipts.sql`, `20260910210000_appointment_notification_outbox.sql`, and `20260910220000_relationship_background_command_receipts.sql` to a staging database first. Apply the complete PR migration set in filename order when deploying. Keep the existing submission function and encrypted message triggers.
2. Deploy the application with `WORKSPACE_NATIVE_PANELS` and `WORKSPACE_RELATIONSHIP_DRAFT_COMMANDS` unset. This preserves legacy navigation/save paths. A browser holding an already-dispatched command keeps its original command transport and ID even when the UI flag is turned off.
3. Exercise the rollback-only SQL fixtures and authenticated HTTP permissions in staging. The SQL fixtures require eligible fixture relationships, services, and users. Test wrong account/workspace, staff without assignment, seller/manager changes during an edit, expired session/MFA, changed expected version, and replay after another edit. Test local storage denial, browser reload after server commit but before acknowledgement, account replacement, and tab eviction.
4. Set `WORKSPACE_NATIVE_PANELS` to the exact test workspace UUID (comma-separated UUIDs are supported; `all` is an explicit wider rollout). This enables supported native panels and the durable appointment command clients. Relationship background commands have a separate setting: set `WORKSPACE_RELATIONSHIP_DRAFT_COMMANDS` to the test workspace UUID after its receipt migration passes staging checks. This setting supports the same UUID list or `all` and applies to both native and legacy relationship detail pages. Verify the existing interface and editing behaviour before widening either setting.
5. Before enabling queued appointment delivery, schedule authenticated `GET /api/cron/appointment-notifications` at least once per minute using the deployment's scheduler. Send `Authorization: Bearer <CRON_SECRET>`; keep this secret server-side. There was no repository `vercel.json` scheduler configuration to reuse. Confirm successful invocations in the deployment and monitor failures. Do not assume `after()` guarantees delivery.
6. After the scheduler and notifications have passed staging tests, set `WORKSPACE_APPOINTMENT_OUTBOX_READY=1`. Both this flag and the workspace native flag must be enabled for new submissions to enqueue a notification. Until then, submission retains its synchronous delivery path. The JSON submission endpoint still avoids a current-page server render.

The application records the appointment, its encrypted Communications message and the outbox job in one database transaction. `after()` attempts the specific durable job promptly after the response. The cron endpoint recovers jobs if that process never runs. UI feedback remains “Submitted” plus “Notification pending” until provider results are available.

## What a command receipt means

Draft/background receipts store a request hash, actor, scope and committed timestamp; they do not copy names, notes, message bodies or attachments. The same request identity with the same payload observes the existing commit. Reusing an identity with changed content is rejected. Every request rechecks current access before returning data, including replays.

A replay returns the currently authorized record and the original committed version. If another writer changed the record afterward, the client preserves its remaining local edits for review. A network timeout retains the original request ID. A failed storage checkpoint does not permit the navigation fast path.

Receipts cascade when their underlying record or account is removed. They are not automatically deleted on an arbitrary timer: old offline commands may still need their acknowledgements. Review retention growth using the `created_at` indexes; an explicit retention policy must preserve the promised retry window. Removing an older receipt cannot silently apply a stale edit, because the expected version still has to match, but it can require manual draft review.

## Delivery ownership and recovery

- `queued`: durable work has not been claimed.
- `processing`: a worker is preparing context under a five-minute lease. An expired lease can be reclaimed; the old worker's token cannot start dispatch.
- `dispatched`: a provider call may have started. This state is written before invoking providers. A lost process/response becomes `uncertain`; the cron never blindly resends it.
- `sent`: acceptance was confirmed; delivery/read webhooks retain their later status.
- `failed`: a definite pre-dispatch failure or a returned failed/partial provider result needs review. Communications exposes failed or partial delivery for the existing explicit retry flow.
- `uncertain`: inspect the provider and stored `communication_message_deliveries` receipt before any retry. The existing UI says “Delivery unconfirmed” and does not offer the ordinary automatic resend path. Reconcile a known provider receipt/status first. Do not change the job back to `queued` merely because it is old.

Read-only operator query (run through the normal trusted database/admin tooling):

```sql
select id, workspace_id, appointment_id, message_id, status, attempt_count,
       created_at, updated_at, lease_expires_at, error_summary
from public.appointment_notification_outbox
where status <> 'sent'
order by created_at;
```

Review queued age, expired preparation/dispatch leases, failed/uncertain counts, provider receipt IDs, and cron failures. Old dispatched jobs become visible `send_uncertain` messages on the next cron run. Provider bodies and credentials are excluded from job diagnostics. Delivery prepares the current destination, checks that the workspace and relationship remain active, rechecks SMS consent in the existing send implementation, and uses the current portal URL. It never grants service-role access to general encrypted chat reads.

## Rollback

1. Remove the affected workspace UUID from `WORKSPACE_NATIVE_PANELS` and `WORKSPACE_RELATIONSHIP_DRAFT_COMMANDS`, and unset `WORKSPACE_APPOINTMENT_OUTBOX_READY` to stop creating new queued submissions. Refresh affected pages so they receive the changed settings; already-dispatched requests keep their original transport until resolved. Deploy the compatible previous UI if necessary.
2. Keep the new command endpoints, receipt tables, outbox worker and cron available while existing browser queues/jobs drain. Reverting the UI must not delete a locally persisted draft or a server-accepted notification job. Receipts and queued jobs remain meaningful after the flag changes.
3. Do not drop these tables or revoke the worker while pending work exists. Do not run a destructive down migration as a quick rollback. The new schema is compatible with legacy conditional updates and synchronous submission.
4. Confirm pending/failed/uncertain jobs and locally recovered drafts before later cleanup. An unconfirmed external send always requires reconciliation; rollback is not permission to send it twice.

## Verification boundary

The new migrations and rollback SQL checks were executed in a local PGlite fixture. This exercised real PostgreSQL command/receipt transactions, current queued submission wrapper, leases, stale requests, wrong identities, replay and recovery. The fixture modeled existing scope/permission helper contracts and did not reproduce the full Supabase/Vault encryption stack or provider callbacks. Full-schema staged migration, authenticated browser, concurrency across separate browser windows, delivery integration, and physical iPhone checks remain release gates. The regular unit suites exercise lost acknowledgements, local persistence failure, account clearing during a request, and editor unmount/reopen without contacting real providers.

The local results are reproducible without changing application dependencies or connecting to any database. From the repository, install the optional test engine outside the checkout and run both included fixtures:

```sh
npm install --prefix /private/tmp/be-performance-sql-tools --no-save @electric-sql/pglite@0.5.8
BE_PGLITE_ROOT=/private/tmp/be-performance-sql-tools node scripts/validate-performance-commands-sql.mjs
BE_PGLITE_ROOT=/private/tmp/be-performance-sql-tools node scripts/validate-communication-history-sql.mjs
```

Each runner starts an empty, in-memory PostgreSQL instance and creates only synthetic users/records. The command runner applies the actual three command/outbox migrations, imports the current retained submission function, and executes their `tests/sql/` suites. The Communications runner applies the actual history-page migration and cursor suite. Its access helpers and single-message adapters are explicit stubs: it verifies cursor ordering, limits, AAL2, participant and cleared-history checks, but cannot establish real Supabase RLS or Vault/encryption correctness. The command fixture likewise models existing permission helpers instead of proving the complete production permission system. Run the SQL suites against the complete schema in staging before enabling the flags.
