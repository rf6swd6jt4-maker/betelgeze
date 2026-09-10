# Performance commands and appointment notification jobs

These paths are included in the PR, remain disabled by default, and require staged verification. The legacy actions remain available. No migration, provider delivery, or scheduler configuration was applied to production while preparing this change.

## Enablement order

1. Apply the expand-only migrations `20260910150000_appointment_draft_command_receipts.sql`, `20260910210000_appointment_notification_outbox.sql`, and `20260910220000_relationship_background_command_receipts.sql` to a staging database first. Communications cursor history uses `20260910200000_communication_history_pages.sql`; the bounded-decoder pilot also requires `20260910230000_bounded_communication_decoding.sql`. Apply the complete PR migration set in filename order when deploying. Keep the existing submission function and encrypted message triggers.
2. Deploy the application with `WORKSPACE_NATIVE_PANELS`, `WORKSPACE_RELATIONSHIP_DRAFT_COMMANDS` and `WORKSPACE_COMMUNICATIONS_BOUNDED_READS` unset. This preserves legacy navigation/save/list-decoder paths. A browser holding an already-dispatched command keeps its original command transport and ID even when the UI flag is turned off.
3. Exercise the rollback-only SQL fixtures and authenticated HTTP permissions in staging. The SQL fixtures require eligible fixture relationships, services, and users. Test wrong account/workspace, staff without assignment, seller/manager changes during an edit, expired session/MFA, changed expected version, and replay after another edit. Test local storage denial, browser reload after server commit but before acknowledgement, account replacement, and tab eviction.
4. Set `WORKSPACE_PERFORMANCE_USERS` to the operator's authenticated user UUID, then set `WORKSPACE_NATIVE_PANELS` to the exact test workspace UUID. This enables supported native panels and durable appointment command clients only for that workspace/actor combination. Relationship background commands have a separate workspace setting, `WORKSPACE_RELATIONSHIP_DRAFT_COMMANDS`, applying to both native and legacy relationship detail pages after its receipt migration passes staging checks. `WORKSPACE_COMMUNICATIONS_BOUNDED_READS` separately selects bounded encrypted list decoding after its migration passes. All UUID settings support comma-separated lists or `all`, but the shared `WORKSPACE_PERFORMANCE_USERS` setting takes user UUIDs while the other three take workspace UUIDs. Blank actor configuration adds no actor restriction; it does not disable an enabled workspace. These rollout gates do not replace server authorization. Verify the existing interface and editing behaviour before widening either scope.
5. Before enabling queued appointment delivery, schedule authenticated `GET /api/cron/appointment-notifications` at least once per minute using the deployment's scheduler. Send `Authorization: Bearer <CRON_SECRET>`; keep this secret server-side. There was no repository `vercel.json` scheduler configuration to reuse. Confirm successful invocations in the deployment and monitor failures. Do not assume `after()` guarantees delivery.
6. After the scheduler and notifications have passed staging tests, set `WORKSPACE_APPOINTMENT_OUTBOX_READY=1`. This flag, the native workspace gate and the optional actor gate must all apply for new submissions to enqueue a notification. Until then, submission retains its synchronous delivery path. Keep the outbox flag off for an initial native/bounded-read pilot. The JSON submission endpoint still avoids a current-page server render.

The application records the appointment, its encrypted Communications message and the outbox job in one database transaction. `after()` attempts the specific durable job promptly after the response. The cron endpoint recovers jobs if that process never runs. UI feedback remains “Submitted” plus “Notification pending” until provider results are available.

The bounded decoder preserves the existing requested history limits: 2,000 client messages across authorized conversations and 4,000 native messages on initial bootstrap; selected conversations request 500 client or 1,000 native messages. Cursor history requests 60 rows with a server maximum of 100. Its internal 128-candidate batches stop only when the requested valid-row limit is satisfied, continuing past undecryptable rows. Unflagged reads make no additive-RPC probe; a flagged older database falls back only when the bounded function is missing. This is separate from an exact-summary/selected-conversation-only redesign. See [bounded read validation and local measurements](communications-bounded-read-validation.md).

## What a command receipt means

Draft/background receipts store a request hash, actor, scope and committed timestamp; they do not copy names, notes, message bodies or attachments. The same request identity with the same payload observes the existing commit. Reusing an identity with changed content is rejected. Every request rechecks current access before returning data, including replays.

A replay returns the currently authorized record and the original committed version. If another writer changed the record afterward, the client preserves its remaining local edits for review. A network timeout retains the original request ID. A failed storage checkpoint does not permit the navigation fast path.

Both appointment and relationship commands reject a workspace that becomes suspended before the database command runs. Their permission checks use the current client allocation; eligibility for a service alone does not grant appointment access.

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

Message preparation and the dispatch lease transition commit together, so an expired worker cannot overwrite a newer worker's prepared text. A targeted job claim only recovers that job; the general cron claim handles all eligible jobs. A provider receipt still marked `sending`, or provider acceptance whose receipt could not be persisted, requires reconciliation. An uncertain destination keeps the aggregate notification uncertain even if another mirror destination succeeded, preventing the ordinary partial-delivery retry from duplicating an accepted send.

## Rollback

1. Remove the affected workspace UUID from `WORKSPACE_NATIVE_PANELS`, `WORKSPACE_RELATIONSHIP_DRAFT_COMMANDS` and `WORKSPACE_COMMUNICATIONS_BOUNDED_READS`, and unset `WORKSPACE_APPOINTMENT_OUTBOX_READY` to stop creating new queued submissions. Do not clear the optional actor list as a way to disable the pilot: a blank `WORKSPACE_PERFORMANCE_USERS` removes that restriction. Refresh affected pages so they receive changed settings; already-dispatched requests keep their original transport until resolved. Deploy the compatible previous UI if necessary.
2. Keep the new command endpoints, receipt tables, outbox worker and cron available while existing browser queues/jobs drain. Reverting the UI must not delete a locally persisted draft or a server-accepted notification job. Receipts and queued jobs remain meaningful after the flag changes.
3. Do not drop these tables or revoke the worker while pending work exists. Do not run a destructive down migration as a quick rollback. The new schema is compatible with legacy conditional updates and synchronous submission.
4. Confirm pending/failed/uncertain jobs and locally recovered drafts before later cleanup. An unconfirmed external send always requires reconciliation; rollback is not permission to send it twice.

## Verification boundary

Local validation includes both focused PGlite fixtures and the complete migration-history runner below. The smaller fixtures exercise command/receipt transactions, the retained submission wrapper, leases, stale requests, wrong identities, replay and recovery using simplified existing permission/encryption contracts. The stronger runner additionally exercises the actual complete application schema and real `pgcrypto`. Hosted Supabase migration/permission checks, authenticated browser comparisons, concurrent browser windows, provider integration and physical iPhone checks remain release gates. The regular unit suites exercise lost acknowledgements, local persistence failure, account clearing during a request, and editor unmount/reopen without contacting real providers. These local results do not claim live database validation or deployment.

The local results are reproducible without changing application dependencies or connecting to any database. From the repository, install the optional test engine outside the checkout and run both included fixtures:

```sh
npm install --prefix /private/tmp/be-performance-sql-tools --no-save @electric-sql/pglite@0.5.8
BE_PGLITE_ROOT=/private/tmp/be-performance-sql-tools node scripts/validate-performance-commands-sql.mjs
BE_PGLITE_ROOT=/private/tmp/be-performance-sql-tools node scripts/validate-communication-history-sql.mjs
```

Each runner starts an empty, in-memory PostgreSQL instance and creates only synthetic users/records. The command runner applies the actual three command/outbox migrations, imports the current retained submission function, and executes their `tests/sql/` suites. The Communications runner applies the actual history-page migration and cursor suite. Its access helpers and single-message adapters are explicit stubs: it verifies cursor ordering, limits, AAL2, participant and cleared-history checks, but cannot establish real Supabase RLS or Vault/encryption correctness. The command fixture likewise models existing permission helpers instead of proving the complete production permission system. Run the SQL suites against the complete schema in staging before enabling the flags.

### Complete migration-history validation

The stronger runner successfully replayed all **183 repository migrations** in an empty PostgreSQL instance with actual `pgcrypto`, then executed the same synthetic rollback script intended for the deployed schema. The final bounded decoder refinement passed and the rollback left **zero fixture users**:

```sh
node scripts/build-performance-rollout-validation.mjs /private/tmp/be-performance-rollout-validation.sql
BE_PGLITE_ROOT=/private/tmp/be-performance-sql-tools node scripts/validate-performance-full-schema.mjs /private/tmp/be-performance-rollout-validation.sql
```

This uses the actual application permission helpers, table constraints, configuration validation, locked delivery-team synchronization, encrypted message and quote triggers, and participant-authorized message RPCs. It checks assignment versus eligibility, revoked workspace access, command receipts, stale writes, targeted lease recovery, notification encryption and exact old/new bounded-decoder JSON parity, including corrupt-row continuation, timestamp ties and cleared-history exclusion. Synthetic Auth/JWT and Vault adapters supply platform objects that PGlite does not bundle; Vault's platform root-key protection and the Auth HTTP service are not reproduced. Replaying historical migrations also needs one missing historical Leadgen industry seed and a compatibility Vault-view column; the old column is removed after the existing Vault repair migration so current functions must use `decrypted_secret`.

Before executing the generated script on Supabase, review `tests/sql/performance-rollout-prerequisites.sql` results for deployed function versions and unexpected trigger/event-trigger external calls. The generated script contains one outer transaction, a one-second lock timeout, only synthetic users/workspace/records, no permission-helper replacements, and a final rollback. Trigger work and encrypted content stay transactional; database webhooks or externally calling custom triggers require separate review. The result proves sequential compare-and-swap and lease fencing, not simultaneous independent database sessions. It must not be reported as an authenticated application or provider-send test.
