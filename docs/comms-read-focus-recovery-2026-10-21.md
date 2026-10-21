# Chat read focus recovery

## Scope and diagnosis

The user reported an open Team chat retaining its unread badge, then approved integrating and testing the investigated repair. Base: `64f67633fa9c9e7101c2244934f1aa4078489e7c`. Initial application validation was local; it made no schema change or production test mutation. The user subsequently explicitly approved production deployment.

The original live observation distinguished the installation's badge cursor from the newer account receipt cursor. The badge later cleared after normal pane interaction. That incident was not instrumented, so the precise missed browser event remains unproven.

Two matching failures were reproduced with actual React hooks and same-origin iframe geometry, injecting missing focus lifecycle events:

1. A missed departure leaves the React attention snapshot true. A newer row's synchronous check correctly rejects lost focus, but a subsequent host focus event does not change that snapshot, so the previous reader never rechecks until another visibility event such as scrolling.
2. After the attention snapshot becomes false, a focus event delivered only to the retained iframe does not reach the old hook's host-only listener, leaving observation disabled.

## Repair and preserved behavior

`useChatDocumentAttention` also listens for frame focus/blur when the frame and host differ. It still asks whether the top-level document actually has focus. `observeChatReadingVisibility` listens for host/frame focus, blur and pageshow, plus visibility changes on their documents. All listener registrations are disposed with their existing owners.

The existing two-animation-frame check still verifies exact latest-row geometry and hit testing, foreground attention, active Communications mode and current shell tab. The same durable queue and acknowledged cursor own clearing. Frame focus alone cannot mark background, covered, inactive or scrolled-up content read. Account/device namespaces, failed-save recovery, pending observations and push policy are unchanged.

The attention hook is shared by `useConversationRead` and the two Communications workspaces; the latter consume only its document-visibility value. The reading observer is owned only by `useConversationRead`.

This adds a bounded number of passive event listeners on the current foreground observer and frame attention owner. Checks use existing animation-frame coalescing; there is no polling, new data read, Realtime subscription, timer, database function, write fan-out or eager history fetch. Repeated events must not resend already acknowledged positions. Fixture timings do not establish production latency or physical-device behavior.

## Validation

The preliminary prototype passed 178 synthetic browser checks, including four matching recovery checks, 14 safety checks and 160 existing read checks. Its source was separate from the application.

Final local integration results:

- `npm test`: **1,698 passed**, zero failures, skips or cancellations. The strengthened attention regression is included in this final run.
- The four selected Foundations browser fixtures passed **320/320** checks: existing reading mobile/desktop and retained-frame lifecycle mobile/desktop, 40 cases per fixture in each of Chromium and WebKit. Both Team/native and client chats and both read protocols are covered by the lifecycle suite. No unexpected network or page errors were reported.
- The same new desktop lifecycle suite against base `64f67633` passed 24/40 in Chromium and failed the 16 expected focus-recovery cases across the four kind/protocol combinations. The eight direct host/frame recovery cases and eight dependent recovery/acknowledgement cases timed out at their missing recovery boundary. The repaired version passes all 40. This comparison reported no unexpected network or page errors.
- Production `next build --webpack`: passed, including TypeScript and static generation; build ID `SMBO64BvKkTazFsIrEByI`. Supabase settings were loopback placeholders. The initial sandboxed attempt could not download the existing Google Fonts; the network-enabled retry passed without application changes.
- Foundation changed-file lint and whitespace checks passed. All **283 historical migrations** are unchanged; no migration is added. No application dependency changed.

The first integrated lifecycle fixture miscounted duplicate transports of the same acknowledgement (local event plus BroadcastChannel). Its counter was corrected to count distinct confirmed positions, while retaining exact read-request counts and delayed-ACK assertions. No runtime repair was made to accommodate that fixture failure.

Detailed local evidence is under `browser-results/unread-lifecycle-2026-10-21/`: `integration-browser.json`, `integrated-regression-baseline-chromium.json`, `integration-unit-tests-final.log`, `integration-build-network.log`, `integration-foundation.log` and `integration-assessment.json`. These generated artifacts are gitignored; this report and the permanent regression fixtures are reviewable source.

Permanent lifecycle regression coverage uses both native and client conversations, account and device protocols, mobile and desktop viewports, and Chromium and WebKit. It covers host focus with an unchanged attention snapshot, iframe-only focus, repeated resume events with delayed parent cursor propagation, genuine background focus rejection, local/host overlays, inactive chat/shell tab, scrolled-up history, and delayed server acknowledgement. The existing 40-case reading fixture is also registered in the standard Foundations browser gate for each viewport.

The strengthened unit regression treats host and frame event targets separately and verifies cleanup after disposal. Fixtures use synthetic account/message I/O and reject external browser requests. No real participants or stored messages are used.

## Rollout and rollback

Production deployment was explicitly approved on 21 October 2026. The release candidate preserves the newer main branch through `e576f2bea9bfa840685e26d34d60b4cda8ba1e6d`; those changes do not overlap the repair. No migration is required. The prior local evidence above is from the original base. Release requires fresh candidate checks, the complete Foundations browser collection and successful hosted CI on the exact commit before a non-force promotion to main. Deployment identity and terminal success must then be verified separately. Final run/deployment evidence is recorded in the release task and its `browser-results/unread-focus-release/` artifacts. Authenticated acceptance should use an isolated test workspace when available. Real macOS Safari/PWA focus return and physical Android/Chrome and iPhone/Safari/PWA checks remain separate from injected browser faults. No production latency or sustained-session stability claim is established.

Rollback restores `components/communications/useChatDocumentAttention.ts` and `lib/communications/reading-observer.ts` to their compatible prior behavior. Retain all messages, private and account cursors, device bindings and notification jobs.
