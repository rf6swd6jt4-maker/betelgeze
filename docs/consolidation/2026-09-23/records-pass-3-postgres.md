# Records SQL: Pass 3 rehearsal and installation plan

This work started from local commit `bd35ea8525215fabec586abbadd5dcf83061eea2`. It changes the **unreleased, uninstalled** `20260923171000_record_attachment_commands.sql` plus an optional PostgreSQL validator and a read-only inventory script. No application dependency, production database, client record, object, provider setting or system service was changed. The integrator confirmed on 23 September that production PostgreSQL is **17.6 on Linux aarch64** and `public.record_attachment_commands` is absent. The broader catalog parity check remains an integrator-owned release gate.

## Result and remaining admission boundary

The final disposable PostgreSQL run passed **58/58** checks. The earlier PGlite validator passed **31/31** again against the refined migration. The real PostgreSQL harness uses distinct backend connections and verifies pending `pg_locks` entries before releasing a competing transaction. Concurrent JavaScript promises alone are not its contention evidence.

Three races were first observed against the Pass 2 candidate and then repaired locally:

- `attach_existing_record` could add a twenty-first relationship to a note while create/edit commands enforced twenty. It now uses the already-held note row lock to enforce the same cap. It examines at most twenty existing links through the note's primary-key prefix; exact duplicate retries still succeed at the cap. Both attach-first/edit-second and edit-first/attach-second last-slot races preserve the twenty existing links and reject the extra addition.
- An actor revoked while waiting for the request advisory lock or note row lock could finish using the earlier authorization decision. All four commands now recheck administrator/active-workspace admission after their known blocking acquisitions. Create checks again after its advisory wait before returning an existing receipt, and after target acquisition before any new record/receipt write. These checks are outside its terminal-rejection handlers, so denied authorization does not manufacture a final rejected receipt.
- Create acquired eligible target locks before its parent-note lock. It now acquires the existing parent note first and rechecks relationship/asset/work-item eligibility after the last known target acquisition. Attach rechecks an earlier owner/asset after later acquisition; the relationship editor checks additions after its locks. An archive committed during a reproduced preceding lock wait is therefore seen before the new write.

These are **write-admission checks**, not commit-time serialization of revocation or archival. Membership and workspace rows are not locked. Existing `FOR KEY SHARE` target locks retain their original strength: they protect keys/existence, not all non-key updates. A revocation/non-key change committed after the final check can race with the admitted write; foreign-key checks, unique insertion and installed triggers can also wait afterward. Accepted requests remain recoverable after later target archival or upload expiry, subject to current actor/workspace authorization. The report makes no stronger revocation guarantee.

Broader `FOR SHARE` locks were deliberately not added. The source review found ordinary presence updates to membership `last_seen_at` in `app/api/workspaces/[workspaceSlug]/activity/presence/route.ts`, inbound WhatsApp-window updates to relationships in `20260919080000_whatsapp_window_state.sql`, asset field updates, and multi-record workflow/onboarding transactions. Stronger locks would newly delay these unrelated updates. The current relationship archive RPC (`20260811150000_fix_relationship_archive_activity.sql`) already acquires `FOR UPDATE`; the original synthetic plain-status-update probe was a wider direct-SQL scenario, not proof that the authenticated archive UI followed that schedule. No protected alerts/presence behavior was edited.

## Runtime and synthetic schema

No PostgreSQL server/client binaries, Docker or Podman were available in the standard inspected locations. With integrator authorization, official PostgreSQL **17.11** source was downloaded and built entirely under `/private/tmp/be-records-postgres-runtime`. Source SHA256:

```text
dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979  postgresql-17.11.tar.bz2
```

The hash matched the checksum downloaded from the same [official source directory](https://ftp.postgresql.org/pub/source/v17.11/). This verifies archive integrity against that published checksum; it is not an independent signing-key verification. The [official build instructions](https://www.postgresql.org/docs/17/install-make.html) describe the user-selected installation prefix. Configuration used `--prefix=/private/tmp/be-records-postgres-runtime/install --without-icu --without-readline --without-zlib`; no system installation, service, PATH edit or real database configuration was made. Build/install logs remain in that temporary runtime directory.

The final server identified itself as `PostgreSQL 17.11 on aarch64-apple-darwin27.0.0, compiled by Apple clang version 21.0.0 (clang-2100.1.1.101), 64-bit`. This matches production's **major version only**; patch, OS, extensions, collation and surrounding schema differ. Optional CI PostgreSQL 16 coverage, if run, must be reported separately.

Each validator invocation creates a fresh private temporary cluster. It accepts only an explicit binary directory, never a database URL. The child environment contains only fixed PATH/locale/time-zone values; app credentials, `PGHOST`, service files and user psql configuration are not used. `listen_addresses=''` disables TCP, the UNIX socket directory is private, host authentication rejects access, and the data are synthetic. Bounded query/start/stop timeouts prevent indefinite waits. The final report confirms the server stopped, after which its temporary data/socket directory was removed. Downloaded build binaries remain available for an explicit rerun.

The fixture executes the actual historical notes schema and policies, note-work-item/note-note trigger migration, private-work-item link trigger, both exact candidate migrations, and relevant canonical asset/work-item table definitions. It uses the actual MFA-aware `is_workspace_member` and `current_session_is_aal2` bodies with synthetic auth helpers, users, memberships and profile fields. It is a representative fixture, **not a full Supabase production-schema clone**. The unrelated canonical historical backfill is not executed. Supabase extensions, all installed triggers/default privileges, R2 and PostgREST are not simulated as proven equivalents.

## Verification

Run from the repository root, as a non-root OS user:

```sh
BE_RECORDS_PG_BIN=/private/tmp/be-records-postgres-runtime/install/bin \
BE_RECORDS_PG_EVIDENCE=/private/tmp/be-records-postgres-pass3.json \
node scripts/validate-records-postgres-concurrency.mjs

PGLITE_PACKAGE_ROOT=/private/tmp/be-pglite-relationship-fixes/node_modules/@electric-sql/pglite \
node scripts/validate-record-attachment-commands.mjs

./node_modules/.bin/eslint scripts/validate-records-postgres-concurrency.mjs
node --check scripts/validate-records-postgres-concurrency.mjs
git diff --check
```

The final scoped lint, syntax and whitespace checks passed. The integrator owns the combined application suite/build and any hosted CI result. The optional validator filename is intentionally outside automatic Node test discovery, and needs no npm PostgreSQL dependency.

Coverage includes:

- Both original trigger row-shape failures; exact A1/A4 installation; pre-commit failure injection restoring A1's original function and removing A4's uncommitted table/functions/index; retained pre-existing record counts.
- Same-request advisory contention, one committed parent/receipt, conflicting payload rejection, first-transaction rollback and waiting retry, a discarded acknowledgement recovered on a new connection, and unrelated request progress while another transaction stays open.
- Same-field conflict, independent-field preservation, link delta preservation, unique concurrent attachments, opposite note-link directions without deadlock, twenty-link races across both command paths, and exact duplicate success at the limit.
- Rollback after a late private-work-item trigger failure, durable rejected replay after the target is repaired, invalid upload actor/path/size, and both orderings of acceptance versus upload-expiry rejection.
- `anon`/`authenticated` RPC and receipt denial; staff/foreign-workspace/revoked/inactive-workspace denial; actual notes RLS with staff, aal1 admin and aal2 admin; revocation during advisory wait and note waits for all four commands; archival during parent/later-target waits.
- Unexpected internal SQL failure leaves no partial parent or terminal receipt and can safely retry the same intent after fixture repair. The read-only catalog inventory executes successfully against the disposable candidate.

Evidence is retained in [the JSON result](./evidence/records-postgres-pass-3.json) and [the run log](./evidence/records-postgres-pass-3.log). JSON contains source hashes and installed candidate function-body fingerprints. A passing synthetic run establishes the tested schedules, not absence of every possible deadlock, exact production permissions, real transport-loss behavior or an end-to-end speed target. No production load test or R2 operation was performed.

## Narrow installation sequence — not executed

1. **Recovery gate.** Retain the integrator's verified Pro scheduled-backup evidence. A completed restore rehearsal and storage/R2-object recovery remain separate and unverified. Do not use client records as smoke-test fixtures. Keep any schema installation approval distinct from provider actions or deployment.
2. **Read-only inventory.** Run `scripts/records-sql-preflight.sql` only against the explicitly selected project. It starts `BEGIN READ ONLY`, uses a ten-second statement timeout and queries catalogs only. Review server version, exact prerequisite tables/columns/keys/triggers, RLS/policies/grants/default privileges, function definitions, index definitions and table-size estimates. Confirm no unexpected overload or object already exists. The prior live registry check found `supabase_migrations.schema_migrations` absent; reconfirm rather than inferring migration history from files.
3. **Freeze exact artifacts.** Review the final migration bytes and application callers together. A1 SHA256 is `f528c63317f38dee9891ef085dc1fd3d0d779d1c8feaf033e9ddec12c0755889`; the refined A4 hash is recorded in the accompanying final JSON. Do not replay all historical migrations or edit an already-installed migration to disguise parity. This refinement is allowed only because A4 has not been installed. If that fact changes, use a separately reviewed additive migration instead.
4. **A1 independently.** Apply only `20260923170000_note_attachment_integrity.sql` in its existing transaction under bounded session lock/statement timeouts. It replaces one function and leaves bindings/rows unchanged. Read back the body fingerprint and both original trigger bindings before calling it installed. A1 does not require a backfill or replay of failed customer submissions.
5. **A4 additive objects.** Verify all prerequisite roles/functions/table shapes and service privileges before applying only `20260923171000_record_attachment_commands.sql` in its transaction. Use bounded session lock/statement timeouts and stop on the first error. Its ordinary `CREATE INDEX` can block asset writes while building; inspect actual size and activity and schedule a low-traffic window. The fixture proves transactional rollback, not live DDL duration. If this lock cannot be bounded acceptably, stop and separately review a concurrent-index rollout; do not silently alter the migration during execution.
6. **Read back before callers.** Compare exact signatures and `prosrc` fingerprints, invoker/search-path attributes, service-only RPC grants, receipt RLS, actual default-privilege effects, primary keys and choice-index definition. A timeout or connection loss is an unknown installation outcome: inspect catalogs before retrying. A4's table/function creates intentionally fail on conflicting existing objects; never remove those objects or receipts merely to make a rerun pass.
7. **Record history deliberately.** Preserve the reviewed SQL hash, operator, timestamp, result and post-install catalog evidence in the release record. A successful SQL editor run is not Supabase migration-registry parity. Do not mark hundreds of historical files applied or create/repair the registry without a separate exact-baseline plan.
8. **Caller acceptance.** Deploy matching guarded callers only after schema verification. Missing schema must keep a visible failure, never sequential-create/blind-note fallback. In an approved isolated authenticated workspace, verify draft/retry recovery, same-field conflicts and the actual upload PUT/HEAD/CORS contract using synthetic objects. These browser/provider checks and actual write latency remain open release gates.

## Rollback and partial failure

If installation fails before transaction commit, PostgreSQL rolls that migration back; the exact A1/A4 injected-failure cases verify this locally. If the connection disappears, inspect the catalog before deciding whether it committed. A1 and A4 are independent: an A4 failure need not undo a successful trigger repair.

After any accepted writes, retain the additive command table, accepted/rejected receipts, record/link rows, corrected trigger and uploaded objects. Application rollback must preserve the guarded write paths or temporarily disable affected creation/edit actions; deploying old sequential creation or blind replacement restores the audited defects. Never revert A1 to the broken function, drop receipts, delete an uncertain record, clear local recovery drafts or clean up uploaded objects as a rollback shortcut. Prefer a small forward SQL correction when installed behavior needs repair.
