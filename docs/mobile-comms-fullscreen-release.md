# Full-screen mobile Comms UI release

The user approved deployment on 24 September 2026 after the local v7 review:
“I think you can finally deploy this UI. We will next work on ensuring
consistently reliable Comms updates.” This authorizes the reviewed UI release;
the separate update/read/sync reliability work is not included.

## Release scope

Base production commit: `fa7c677c8de41d471814a3dbec5fab97eeb7861d`.
The isolated local worktree was checked against freshly fetched `origin/main`;
the base matched. The primary working checkout and unrelated work remain untouched.

Ship the approved retained-list/full-height conversation surface, native focus
correction, coordinated message/composer motion, coverage and action polish,
and v7 empty-chat/interrupted-action patches. Visual elements retain their existing
styles. Desktop/legacy iframe paths remain supported. No migrations, backend
routes, subscriptions, read predicates, receipt policy or notification rules change.

Local preview/diagnostic scripts and synthetic fixtures are development tools.
They are not imported by application runtime code, and their recording endpoint
exists only in the standalone local preview server. No diagnostic collector or
test transport is deployed as an application endpoint.

## Evidence and limits

The approved application files match the v7 validation hashes. The exact release
passed 1,324 repository tests, the scoped lint/whitespace/migration-history gate,
a production webpack build with synthetic values and the complete foundation
matrix (223 cases each in Chromium and WebKit). V7 also passed 12 empty/short-chat, 16 interrupted-action and
20 routine-action component cases per engine. Local iteration evidence is in
[the v7 report](mobile-comms-edges-local-v7.md).

The user reported no jumps after the focus repair, promising motion afterwards,
requested final edge-case fixes and then approved deployment. This is user
acceptance of the local UI, not proof of all physical Safari/Android/PWA scenarios.
No production client messages are sent or deleted for release verification.

The original local investigation identified that a read visibility check can run
while the entering surface is inert and may wait for a later interaction to
recheck. That existing documented limitation is not represented as resolved by
this UI release. The user explicitly placed consistent Comms updates next.
The historical local report's release-readiness statement is superseded by this
explicit deployment approval; its unresolved findings remain recorded.

## Rollout and rollback

Release through the existing GitHub main → Vercel production integration.
Record the final commit, terminal deployment status and production URL in the
task's release evidence. Approval does not authorize unrelated data or alert
changes. Subsequent read/unread, edit/delete reconciliation, receipts and update
reliability work must trace those existing owners separately.

Rollback is an application-only revert of this release commit. Preserve drafts,
messages, uploads, migrations and stored records. It restores the prior mobile
UI and its known keyboard limitations; it does not erase data.
