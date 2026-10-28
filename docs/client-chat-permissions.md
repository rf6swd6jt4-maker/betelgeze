# Client chat participant View/Edit permissions

Candidate based on `560cc4c2902216ebf016820e07b50079f231aa64`, branch `codex/client-chat-member-permissions`. This correction is not deployed. No live client memberships, messages or files were changed during validation.

## Requested behavior

The existing Client chat participant button opens one list containing the current client Team, fixed seller/manager and retained optional grants. Each staff member has View and Edit checkboxes. Edit enables View; clearing View clears Edit. Only the assigned manager can change these settings. Seller and assigned manager remain checked and locked. The Team chat's extra “Add to Client chat” button is removed.

The form reuses `List`, `ListItem`, `Assignee`, native checkboxes and the existing dialog/focus owner. It uses the roster already loaded by Client chat; opening it adds no request. Save makes one mutation request and then waits for the existing canonical refresh. Failed/uncertain saves retain the selection; retries are idempotent. Late completion cannot close a newer dialog session. The mutation request has a 30-second deadline.

## Authorization and data

The additive migration `20261028120000_client_chat_view_edit.sql` gives existing optional members `can_edit=true` without rewriting their attribution or history. A membership row still grants View. The new write predicate uses the same workspace/current-membership/active-relationship checks, with Edit required for optional participants; seller/manager stay automatic. Only the current assigned manager may save permissions, under the existing relationship lock. The function validates current Team/service eligibility or a retained grant, rejects cross-workspace users, and accepts at most 1,000 selected IDs. Removal and permission changes are atomic and audited only when something changes.

All staff write endpoints replace their existing authorization call in place: messages, reactions, attachment preparation/deletion, typing, reconfirmation, pins and checklists. Restrictive database policies also reject direct authenticated writes to messages/reactions/deliveries; upload-key creation requires Edit. Read authorization, private media/file-key reads, read cursors, unread/receipt behavior and notification recipients remain unchanged. The application exposes an independent `canWrite` flag; provider availability stays in `canSend`. Drafts survive permission refresh; copy/download and history remain usable. Existing queued work is retained and server authorization still applies on retry.

Legacy participant RPCs and API operations remain for already mounted old clients. They cannot promote a retained View-only grant through an additive retry. Historical migrations are unchanged. Old client UIs may show editable controls until refreshed, but server and RLS restrictions apply immediately after installation.

## Performance and validation

Local SQL timings measure database/loopback execution, not authenticated production latency or physical devices.

- Unit suite: 1,874 tests passed. Fifteen focused route cases cover malformed/bounded requests, trusted session authority, compact one-RPC saves and denial before any provider/database side effect on every affected write route.
- The production webpack build passed with placeholder credentials. Changed-file lint, immutable migration history and whitespace checks passed.
- Actual workspace browser tests passed in Chromium and WebKit, each at 1280×900 and 390×844: all members, locked roles, View/Edit dependencies, no dialog fetch, failed/lost-ack saves, canonical refresh, late completion, view-only controls, retained draft and non-manager restrictions. Desktop and mobile screenshots were inspected.
- Isolated PGlite 18.3 and private socket-only PostgreSQL 18.4 validate preserved row identity/attribution/defaults, read/write separation, current membership and manager authority, workspace boundaries, invalid input, retained grants, removal/reassignment/archive handling, idempotence, direct authenticated RLS and upload-key denial. A successful editable upload also checks the corrected Vault field. Native PostgreSQL uses two connections to prove concurrent saves wait on the relationship lock.
- The broader Foundations browser pack passed all 970 assertions across 48 configurations in both engines, including read visibility/lifecycle, references, navigation/departure, drafts and mobile/desktop layouts. Authenticated production, physical Android/iPhone acceptance, provider delivery and sustained-session stability are not established by these fixtures.

The roster uses a relational permission predicate, materializes only the authorized relationships, aggregates their Team members together, and computes fixed-role membership once. Its extra permission array contains only View-only exceptions. Both the HTTP save and its RPC omit that array entirely for full-access saves, retaining the existing number of arguments and avoiding duplicate IDs. No extra read or authorization request was added. There are no new subscriptions, polling loops or background timers.

The final isolated native comparison used 201 workspace clients, 20,000 unrelated clients/Teams, 60 retained grants and up to 21 selected members; 10 warmups followed by 80 alternating samples. Roster median/p95: manager 3.141/4.278 → 1.733/2.535 ms; staff 2.663/2.746 → 0.786/0.897 ms. Existing send authorization: manager 0.021/0.028 → 0.020/0.028 ms; member 0.037/0.044 → 0.020/0.025 ms. Save medians ranged from 0.037–0.171 ms before and 0.039–0.172 ms afterward (per-case median differences 0–0.003 ms); these microsecond differences in a local transport benchmark do not establish production action latency. The measured roster regression in the discarded initial query was removed before completing the candidate. The scoped plan uses the existing workspace/relationship Team index and Team-member primary key; no write-maintained index or trigger was added.

## Rollout and rollback

Install and verify the additive migration before deploying the application. The baseline migration `20261027120000_client_chat_team_members.sql` and the corrected Vault-key function must already exist. Verify function bodies/grants, the new column default and write policies without editing live memberships. Release through the existing exact-commit GitHub/Vercel gate.

Rollback application code first and retain the migration/permission flags. Older application code does not render View-only controls; its server routes use the old read predicate, so it must not be used as a safe write-enforcement rollback after View-only grants exist. A corrective application rollback must preserve the new write helper on mutation routes. Never undo this feature by deleting memberships, messages, files, attribution or audit history. Physical-device acceptance and sustained production behavior remain separate checks.
