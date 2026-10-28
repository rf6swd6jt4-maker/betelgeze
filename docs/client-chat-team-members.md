# Client chat access from a client's Team chat

Updated 28 October 2026. Isolated candidate based on `64f67633fa9c9e7101c2244934f1aa4078489e7c`. Not deployed; no live membership or client data was changed.

The user requested adding people from a client's internal Team chat to its Client chat and explicitly chose to keep this action limited to the assigned manager.

## Behavior and ownership

Open the client's Team chat, press its title to view members, choose **Add to Client chat**, select people, and choose **Add selected members**. The disclosure explains that selected people gain access to the Client chat history and can message the client. Non-managers receive a permission error without participant choices. Custom, system and archived Team rosters do not offer the action.

The existing Team roster owns the dialog and its departure/focus lifecycle. `TeamClientChatMembers` performs no I/O until the action is requested. It reuses `DeliveryUserPicker`, `List` and `Assignee`; this is a participant settings form, not a record-route collection. There is no new cache, subscription, polling loop, unread owner or navigation owner. Closing the roster aborts its request, and a new roster session cannot accept its late response. Requests have a 30-second deadline.

The existing authenticated participants route derives actor/workspace authority from the session. It passes only the Team identity to the database; the relationship is resolved server-side. The new read/write functions require an active relationship Team, the current assigned manager and current workspace membership. Selected people must still belong to that exact Team and workspace. Choices and writes are capped at 200; an oversized roster fails explicitly rather than silently truncating.

The additive transaction uses the existing relationship lock and participant table. It adds missing members only, preserves existing grants and their attribution, and audits only actual additions. Repeating a request after a lost acknowledgement is safe. The existing Client chat participant editor includes optional members added through Team chat so a manager can explicitly retain or remove them. Its setter remains compatible with prior service-based allocations and retained grants after a Team assignment changes.

No messages, history, read cursors, push jobs, provider sends, files, service assignments or Team memberships are created or rewritten by the feature. Membership affects future client-chat eligibility through the existing policies; prior alerts are not replayed.

## Validation

- `npm test`: 1,702 passed, zero failures, skips or cancellations. Four new route tests execute the real handler with synthetic dependencies, covering trusted actor/workspace scope, malformed/bounded requests, denied writes, and a committed acknowledgement without the discarded roster reads.
- `scripts/validate-client-chat-team-members.mjs`: isolated PostgreSQL/PGlite fixture reproduces the old shared-member rejection and checks the candidate's manager-only authorization, current membership, cross-workspace/Team rejection, archived clients/teams, reassigned/offboarded managers, service-role grants, atomic rejection, duplicate/lost-ack retries, preserved attribution, and explicit removal. A 201-person fixture proves the roster bound fails explicitly. Renaming the Team table during a transaction proves ordinary service-only saves do not plan or execute the broader lookup; unsupported selections fail closed.
- The same script with `--native` runs a new private, socket-only PostgreSQL 18.4 cluster through `scripts/client-chat-members-postgres.mjs`. Two independent connections prove overlapping additions actually wait on the relationship lock, then retain one membership and one addition audit. The cluster is shut down and removed afterward. Both SQL runtimes and the browser flow are registered in Foundations CI; hosted CI has not run here.
- `scripts/browser/run-client-chat-team-members.mjs`: actual Team workspace and shared picker with local synthetic I/O, Chromium and WebKit at 1280×900 and 390×844. All four configurations pass nine cases: on-demand read, access disclosure, selection, lost-ack retry, retained existing member, denied manager, close cancellation, late-response isolation, and the existing Client editor accepting `{ok:true}` while still waiting for its canonical refresh. Screenshots were inspected for the mobile layout.
- Production `npx next build --webpack` passed with loopback placeholder credentials. Changed-file lint, migration immutability validation and `git diff --check` passed.

These checks are distinct from authenticated production use, physical Android/iPhone testing, provider delivery and sustained-session observations; those are not established here. The full hosted Foundations/deployment gate has not run for this candidate.

## Speed assessment

Existing chat bootstrap/read queries and payloads are unchanged. Opening the existing Team member roster makes zero new participant requests in the browser fixture. The new action makes one scoped read; saving makes one additive RPC and returns its authoritative roster without refreshing message history or the whole Team panel. The change adds no index, trigger or write maintenance to ordinary messages or service assignments.

The initial synthetic comparison included repeated function/query planning and showed a 0.555/0.609 ms baseline median/p95 versus 0.611/0.768 ms for the first candidate (50 samples per arm). This triggered the `app_speed.md` gate. On 28 October the user selected **Optimize to preserve existing speed**; no speed exception was requested or added.

The final setter keeps the original service-assignee validation query on its ordinary path and defers the broader Team query to previously unsupported choices. It retains existing grants instead of deleting and reinserting every participant. The existing Client save route also drops four redundant reads (relationship, optional members, service assignees and workspace members). Its only application caller consumes the success acknowledgement and then runs `synchronize`; that authoritative refresh is unchanged. Both old and new versions of that caller accept `{ok:true}`. The shared access helper remains available, but the save route no longer calls it. Closed participant dialogs do not filter the people list during ordinary chat renders.

Final native PostgreSQL observations use the same 20,041 synthetic service rows, permissions and roster state. Each cohort has 100 alternating measured samples per arm following 10 warm-ups. `first-plan` recreates each function before its call; database buffers are still warm. `cached-plan` retains both functions and their query plans. The measured save database path includes the baseline RPC plus four roster reads on independent parallel connections, versus the candidate RPC alone. The subsequent Client refresh is identical in both versions and excluded.

| Existing save | First-plan baseline → candidate median / p95 ms | Cached-plan baseline → candidate median / p95 ms |
| --- | --- | --- |
| Same 20 participants | 0.392 / 0.501 → 0.242 / 0.296 | 0.230 / 0.256 → 0.108 / 0.122 |
| Add one to 20 participants | 0.373 / 0.434 → 0.240 / 0.292 | 0.237 / 0.262 → 0.117 / 0.132 |
| Remove one of 20 participants | 0.359 / 0.432 → 0.229 / 0.298 | 0.225 / 0.241 → 0.105 / 0.112 |
| Add the first participant | 0.239 / 0.264 → 0.188 / 0.211 | 0.126 / 0.143 → 0.075 / 0.081 |

All eight measured paths improve within the same save action. The RPC-only stage remains separately reported: first-plan first-add was 0.178/0.201 → 0.188/0.211 ms; removing the redundant work in that same save reduces its complete database path as shown above. This does not hide that small stage cost behind another user action. No failures or missing samples occurred. PGlite also completed the authorization matrix and showed lower total save-call costs in all eight cases.

These are synthetic database-call observations including local transport, not production browser/network/authentication timings, a cold database test, or an end-to-end latency guarantee. The identified save-path regression is addressed without changing the speed standard; authenticated production and physical-device acceptance remain unverified. Set `CLIENT_CHAT_MEMBERS_SQL_EVIDENCE` to persist the runtime, separate RPC/save observations and sample counts when rerunning the fixture.

## Installation and rollback

Before release, inspect the currently installed definitions and schema independently of repository migration history. The migration depends on the existing relationship Team schema, `relationship_client_chat_members`, workspace memberships, service allocations and Team audit table from `20260909100000_client_delivery_teams.sql`. It adds two service-role-only functions and compatibly replaces the participant setter; it performs no backfill. Existing Team/participant/membership indexes supply the scoped reads.

Apply `20261027120000_client_chat_team_members.sql` before its caller, then run the full reliability release gate and verify the exact application deployment. Production installation is not performed by this work. Roll back application code first; retain the compatible setter, accepted memberships, attribution and audit entries. Do not roll back by deleting participants or messages.
