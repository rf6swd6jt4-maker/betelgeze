# Client Connections history and retirement

Base: `93f08c15`. Candidate and exact production deployment are recorded in the release task and GitHub/Vercel checks.

Client Connections lists retained active bindings, including archived relationships for owners/admins, eligible unconfigured clients, and credential-free retired history. History is paginated by timestamp and revision, 50 per request. The existing 1000-current-client explicit limit is retained; exact relationship access remains available. Historical connections already deleted before this migration cannot be reconstructed.

The standard List uses two single-line bands. Three dots open the editor directly. Refresh and Retire are editor actions; retirement requires confirmation. Retired rows open read-only details. Location replacement requires retirement first, preventing silent loss of a connection's history. An archived relationship can be retired without unarchiving it. Duplicate errors distinguish archived and active conflicts.

Retirement checks current actor/workspace/relationship permissions, locks the existing relationship and portal owners, compares the credential revision, appends a snapshot with actor/time, and deletes the live binding. The existing delete trigger destroys its managed Vault secret and cascades only its derived calendar cache. No sales, onboarding, payments, files, client records or GHL provider records are rewritten. Restoring an archived relationship does not restore credentials. An exact-revision receipt makes retries harmless after reconnection. In-flight writes cannot resurrect the deleted binding. Staff retain existing setup scope; archived relationships require owner/admin access.

Only service_role can call the RPCs; the history table stays private with RLS and no direct grants. No credential or Vault reference enters history or list payloads. Existing confirmed Remove actions use retirement for mixed-version compatibility. Existing save and refresh response reads retain their old bounded path; retirement returns its receipt directly.

## Validation

- Actual historical migrations plus the new migration in an isolated PGlite database: archived conflict/recovery, staff and cross-workspace denial, revision conflicts, Vault deletion, preserved relationship/session records, location reuse, restored relationship conflict, idempotent retry after a new connection, ACLs and nonoverlapping keyset pages.
- 500 current clients and 20,000 historical entries: first wrapper rejected for a measured regression. User approved replacement with a bounded query. Owner median/p95 improved 4.444/4.639 to 3.646/3.813 ms. Staff 0.125/0.175 to 0.227/0.303 ms and scoped 0.083/0.110 to 0.262/0.317 ms were separately disclosed and explicitly accepted; see app_speed.md. Isolated SQL timings are not production/user-perceived latency claims.
- Chromium and WebKit desktop/mobile fixtures exercise direct editor activation, credential-preserving calendar edits, cancellation, confirmed retirement, retained history, sibling preservation and normal row height.
- Full lint/migration checks, unit suite, production build and Foundations browser/hosted gates must pass on the release candidate before main advances.

## Rollout and recovery

Install the additive migration with exact live function fingerprint guards; verify resulting function bodies, ACLs and private history schema. Do not replay historical migrations, modify a migration registry, or alter any client connection as a deployment test. Deploy the exact CI-passed app commit, wait for terminal production READY, verify SHA/aliases and read-only HTTP responses.

Application rollback may use the previous caller: confirmed Remove still retires and retains history, although its old UI does not display that history. Preserve the additive history and retirement functions, audit receipts and credential deletion. Never restore deleted secrets or reservations. Authenticated real-client interaction, provider acceptance, physical iPhone/Android behavior and sustained-session operation remain separate unverified evidence categories.
