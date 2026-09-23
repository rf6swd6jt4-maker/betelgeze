# Database installation before application release

Date: 23 September 2026. Application candidate: `64b175492f4bfc3de6f949b94d17407d0e17dcb0`, from the isolated `/private/tmp/betelgeze-platform-consolidation` worktree. The dirty primary checkout was preserved. The user requested deployment after the three consolidation passes.

**Status at this checkpoint:** the exact A1 and A4 migrations are installed and their live catalog/PostgREST checks passed. This record was captured before application push, hosted Foundations checks and Vercel deployment. Remote main was refreshed and remained `31388081894e6d4143d5bb0d577c0341ec31edf7`, six commits behind the candidate with no divergent commits. This record supersedes the corresponding uninstalled-schema status in the earlier pass reports; it does not turn local fixtures into authenticated application or provider evidence. The subsequent application commit, hosted checks and terminal deployment result are recorded separately in the release handoff.

## Production installation

The integrator executed the complete checksum-guarded batches through the signed-in native Supabase dashboard for project `lhxrgapdrkwdaunwgeje`, PostgreSQL 17.6/Linux aarch64. Each wrapper sets `lock_timeout=2s`, `statement_timeout=30s` and `idle_in_transaction_session_timeout=30s`, verifies the exact embedded migration bytes using SHA-256 before DDL, and retains the migration's own transaction. Both batches completed successfully and returned the expected migration identifier/hash.

| Artifact | Source SHA-256 | Executed wrapper SHA-256 |
| --- | --- | --- |
| A1 — `20260923170000_note_attachment_integrity.sql` | `f528c63317f38dee9891ef085dc1fd3d0d779d1c8feaf033e9ddec12c0755889` | `f27404ab4f0016f1625dbc979e174ac62db4b993de185498d584555e11fe25bc` |
| A4 — `20260923171000_record_attachment_commands.sql` | `a3f45a2ee4e5b2863e71387ff0f7902fc52351a5bcad500e2e2623e68bb0c000` | `394658353b72cc47bf63aa7247b5ffe65bda2631930c1ab71264d4a0654c585a` |

The release pack is preserved at [/private/tmp/be-records-release](/private/tmp/be-records-release), including [manifest.json](/private/tmp/be-records-release/manifest.json), exact installation wrappers, [preflight](/private/tmp/be-records-release/01-catalog-preflight.sql), [postflight](/private/tmp/be-records-release/postflight.sql), the legacy-trigger follow-up query and the local wrapper validator. The manifest's migration and artifact checksums were independently recomputed and matched. Preflight SHA-256: `aa87f3069c4da25eb6b1eddca22974f9e2a696be38ab492a519ac75704d7cf39`; postflight SHA-256: `0290f0532f1caae98ed6419005e230af6a47617db82fe2c0fc441deca53732e6`.

The live preflight returned **83 rows**. Required columns, additional-column compatibility, keys, foreign keys, individual service-role permissions, expected trigger bindings and helper hashes passed. Service-role `BYPASSRLS` and public-schema usage were present. A4's command names and receipt relation were absent before installation. Assets measured 360,448 heap bytes, 458,752 table/TOAST bytes and approximately 159 rows; the choices index was absent. These were metadata/size observations, not a client-row export or exact preservation count.

An additional legacy asset trigger had a body different from the representative fixture. Its live body was inspected: its predicate applies only to `NEW.native_kind='sop_document'`, excluding A4's `manual_upload` inserts. That trigger was not modified.

A1's immediate readback matched body MD5 `66d9ede79912b623424d4189f1b4e1db`, invoker execution and `search_path=public`. Its original ACL remained `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. Existing trigger bindings were retained.

## Live post-install verification

The catalog postflight returned **31 rows**. Every asserted check passed; the informational structures matched the reviewed migration:

- All six function bodies, signatures, result types, default-argument counts, PL/pgSQL language, invoker execution and `search_path=public` matched. All five command RPC grant checks passed, with exactly five command functions present.
- The receipt table has RLS enabled, `force_rls=false`, owner `postgres`, the expected nine columns and six validated constraints. `anon`, `authenticated` and PUBLIC have no effective table privileges, and no receipt policies exist.
- The trusted service role has effective `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` privileges inherited from the pre-existing default ACL, as anticipated in the release pack. A4 explicitly grants SELECT/INSERT; this record does not claim those are its only effective service-role privileges.
- The asset choices index is valid and ready, with the exact `(workspace_id, updated_at DESC, id DESC)` ordering and `metadata->>'archived_at' IS NULL` predicate. Both original A1 trigger bindings, service-role RLS bypass and the unchanged A1 ACL passed.

At **2026-09-23T17:38:58.505Z**, a service-role PostgREST OpenAPI **GET returned HTTP 200** and exposed the receipt relation and all five expected RPCs with their expected parameter names. This was metadata only: no command invocation, data query or write was used to check the schema cache.

No installation statement rewrote or deleted existing client records, links or stored objects. No client smoke-test write, real message, worker invocation, provider operation or storage cleanup was performed. The migration registry remains absent; no historical migrations were replayed and no guessed history was seeded. Exact SQL hashes, installation results and readbacks establish these two installations, not parity for the entire historical migration directory.

## Storage prerequisite before application release

A read-only S3 `GetBucketCors` found the existing platform rule missing `if-none-match`, which the new conditional upload requires. At **2026-09-23T17:46:53.716Z**, the integrator added that one header to `betelgeze-onboarding-platform` using one S3 `PutBucketCors` request. The reviewed baseline hash bound the target and complete policy; a fresh read matched before the update. Every other rule, origin, method, header and field was preserved. HTTP 200 acknowledged the update, and exact readback matched expected policy SHA-256 `50a326c036da27a7563fe2c93a1f1d52b160f00626bddbd1542c2de311de0c32`. Before/after evidence is retained at [/private/tmp/be-consolidation-evidence/r2-cors-plan-2026-09-23T17-46-53.714Z-apply](/private/tmp/be-consolidation-evidence/r2-cors-plan-2026-09-23T17-46-53.714Z-apply).

A separate **17:47:07 UTC** read-only OPTIONS request for `https://betelgeze.com`, method PUT and headers `content-type,if-none-match` returned HTTP 204 with the requested origin, method and headers allowed. Its synthetic path was never written. This verifies the CORS preflight only; no object was read, uploaded, overwritten or deleted, and conditional PUT/HEAD behavior remains separate evidence. Production Cloudflare management-token availability was not assumed; the existing S3 credential performed the narrow configuration update.

## Local validation and checks remaining at this checkpoint

Existing [Pass 3 validation](./evidence/pass-3-validation.txt) records **1,353/1,353 tests**, strict changed-source lint, migration/whitespace checks and the webpack production build. The [PostgreSQL rehearsal](./records-pass-3-postgres.md) passed **58/58** checks; PGlite passed **31/31**, the operating-query fixture **8/8**, and the exact release-wrapper validator **10/10** in its own disposable PostgreSQL cluster. The latter also proved corrupted/split batches fail before migration DDL. These are synthetic local results, separate from the production catalog evidence above.

The default `npm run build` also completed successfully with Next 16.2.11/Turbopack using `env -i` and dummy loopback Supabase configuration, after retrying public-font downloads with network access. No source change was required. The retained log is [/private/tmp/be-consolidation-evidence/pass-3-build-default-network-retry.log](/private/tmp/be-consolidation-evidence/pass-3-build-default-network-retry.log); it contains Yjs duplicate-import warnings, so successful completion is not a claim of warning-free execution.

| Remaining step | Status |
| --- | --- |
| Push the exact reviewed application revision from the isolated checkout | Pending; no application push recorded yet |
| Observe both hosted Foundations jobs at that revision | Pending; the workflow does not itself make Vercel wait for its result |
| Observe terminal Vercel production deployment and exact deployed commit | Pending; a prior Ready deployment is not this release |
| Authenticated navigation and permitted synthetic write/upload acceptance | Pending; no client records or messages are test fixtures |

The [mounted draft suite](./workspace-draft-browser.md) passed 25/25 in Chromium production and 25/25 in development StrictMode; final Safari completion remains unverified. Real R2 conditional PUT/HEAD behavior, physical Android/iPhone/PWA behavior and sustained production performance remain separate, unverified evidence. The earlier Pro backup observation was through **23 September 2026 at 05:24:03 UTC**; Storage API objects are excluded. No restore rehearsal or separate storage/configuration recovery has been demonstrated by this installation.

## Rollback

Keep the corrected A1 trigger and A4's additive table, functions, index and any accepted/rejected receipts. An application rollback must retain guarded command paths or disable affected writes; returning to blind note replacement or sequential create/link restores the known defects. Preserve accepted records/links, stored objects, queued work and browser recovery copies. Do not drop additive schema, delete an uncertain record, purge drafts, disable unrelated recovery schedules or restore the defective trigger as a rollback shortcut.

If a later operation's outcome is uncertain, inspect its authoritative catalog/receipt state before retrying. A1 and A4 committed independently; no registry repair or destructive rollback is required. Follow the [operations runbook](./operations-runbook.md) and record the hosted release outcome separately when it is available.
