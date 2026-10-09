# Independent device unread badges — candidate evidence

Status: local candidate, not merged, migrated or deployed. User explicitly approved independent device counts, additive migrations and deployment on 9 October 2026. Notification policy and the measured speed departure remain pending; deployment approval itself does not need to be requested again.

## Behavior

A browser/PWA installation owns its unread positions, scoped by workspace and authenticated account. Reading on installation A advances A and same-installation sibling tabs only. B remains unread through refresh/restart until it reads those messages. Account-level receipts still advance monotonically so colleagues see that the person has read a message. They never clear device badges. Message ordering retains timestamp microseconds and UUID tie breaking.

Shell, mode and chat-row badges consume one device summary. Selection alone does not imply reading: the newest saved row must be painted, visible and unobstructed in the active foreground chat, followed by a successful server acknowledgement. Failed/stale responses retain known counts. Pending read intent is installation scoped; legacy shared pending intent is not reinterpreted as a device read. Existing drafts and chat layout are preserved.

## Schema and rollout

The additive migration is `20261009120000_device_communications_unread.sql`. It preserves existing messages, receipt tables, RPCs and migration history. Four RLS-protected tables hold the known installation registry at cutover, frozen account boundaries, initialized device/workspace scopes, and device cursors. The authenticated RPC validates MFA, live session, current session-to-installation binding and existing conversation access. Client-supplied device identity alone grants nothing; direct table writes and private helper execution are denied.

Known installations initialize lazily from the frozen migration-time boundary, so a sleeping device does not inherit another device's later reads. A genuinely new installation initializes once from the account's then-current position. An installation absent from all prior device registries cannot be recognized as old. Clearing browser cookies creates a new installation identity.

Apply the complete migration transaction before the application, then independently verify tables, PKs, RLS, grants and function definitions against the reviewed source. Never rerun or reset cutover seeding. Account-only reads from old application instances during the schema/application transition cannot establish device-specific reads. An old retained shell opening a new iframe is a confirmed incompatible transition. The proposed coalesced fallback and update guidance remain pending the speed decision: it adds one device metadata path alongside the old account path temporarily. No automatic reload or forced draft loss is permitted. This must be resolved and validated before release. Application rollback preserves the new tables and returns to the previous shared badge semantics; it must never erase read history or pending delivery jobs.

## Performance evidence

These are matched isolated SQL/production-React fixture measurements, not authenticated production timings. Routine reconciliation returns counts only; full cursor positions are requested on initialization and recovery. No new history download, realtime subscription or polling loop is added. A healthy read still has one read POST and one coalesced summary reconciliation per owning browser tab.

| Operation | Prior median / p95 | Device candidate median / p95 |
| --- | --- | --- |
| Read save, 200 chats | 0.170 / 0.183 ms | 0.246 / 0.283 ms |
| Routine all-read summary, 100 chats | 4.431 / 4.481 ms | 4.332 / 4.392 ms |
| Routine all-read summary, 1,000 chats | 115.386 / 119.004 ms | 113.394 / 114.415 ms |
| Full recovery, 100 chats | 4.431 / 4.481 ms | 5.150 / 5.218 ms |
| Full recovery, 1,000 chats | 115.386 / 119.004 ms | 121.508 / 130.210 ms |

Routine all-read response is 94 bytes at both tested sizes. Full initial/recovery metadata at 1,000 cursors is 325,109 bytes (44,745 bytes gzip), versus the old empty-count array. The extra read save and recovery costs are departures from `app_speed.md`; its strict rule remains unchanged and release is held for the explicit decision. Faster populated-history summaries do not cancel these regressions. The SQL report is reproducible with `scripts/validate-device-communications-sql.mjs`.

## Validation and remaining gates

- Full unit suite: 1,542 passed, including bounded installation recovery. Mixed-version compatibility remains pending.
- Production webpack build with loopback placeholder configuration: passed, including the installation-recovery follow-up.
- Device HTTP/cookie browser fixture: 136/136 across Chromium/WebKit and mobile/desktop; device A clears only after acknowledgement, B stays unread through reload, wrong identity/failed save/offline/late requests preserve safety. Initial/recovery requests retain full metadata requirements across races. Acknowledgement-to-React badge commit was 1.5–3.0 ms in this synthetic fixture.
- Existing reader/visibility fixture: 144/144; receipt isolation/draft/scroll fixture: 52/52.
- Exact SQL fixture passed authorization, cutover, deleted boundaries, timestamp ties, monotonic reads, rollback and summary cases. It does not prove concurrent PostgreSQL sessions; the dedicated fresh socket-only PostgreSQL harness remains a separate gate.
- Full Foundations browser suite: 650/650 (325 per engine). Changed-source lint and immutable migration checks pass. Hosted exact-commit checks remain pending.
- No production migration, production read mutation, provider send, authenticated UI verification or physical Android/Chrome and iPhone/Safari/PWA verification has been performed for this candidate. Production latency and sustained-session stability are unverified.

Browser automation currently cannot start because its configured writable roots include the symlinked legacy Documents checkout. The signed-in Supabase/Vercel windows therefore remain inaccessible; do not bypass browser credentials or claim a deployment occurred.
