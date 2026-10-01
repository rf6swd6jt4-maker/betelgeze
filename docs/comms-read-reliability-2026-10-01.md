# Read acknowledgement recovery — 1 October 2026

The user authorized repairing messages that remain unread after reading them as part of platform consolidation. This changes the existing read queue and visibility observer only. The protected `app-alerts.md` contract, newest-row visibility predicate, two-painted-frame confirmation, cursor ordering, atomic server authorization and acknowledgement rules remain unchanged. No message, cursor, notification, stored file or migration is modified.

## Reproduced failures

- **Save settlement loses newer intent.** A message observed after the queue has completed its drain loop but before its promise cleanup sees the previous running promise. The new position remains in session storage without a save until another recovery event. A deterministic microtask regression failed on base `36747562015eeb88f189097a7229928fae4c0ff1`: only `m1` was attempted where `m1, m2` were expected. The same loss occurs at a failed save's settlement.
- **Closing a retained native dialog does not recheck reading.** The relationship context uses a native dialog that can stay in the DOM after `close()`. The observer watched row/ancestor presentation and direct portal child changes, but neither native `close` nor `toggle`. Closing without removal, a pointer/key event or animation left the uncovered newest row unread. In the actual React hook fixture, the unchanged implementation passed the prior 34 Chromium/mobile cases and failed both added Team/client dialog-close cases.

## Repairs and ownership

The existing queue now checks for unattempted/newer positions once its promise settles, carrying the same attempted-position map into the continued drain. This keeps saves serialized and coalesced. It does not retry a failed position automatically, repeat another failed conversation or drain a disposed owner's new intent. Session-storage durability, the 256-position pending cap and acknowledgement-only broadcast remain unchanged.

The active reader listens for native `close` and `toggle` in capture phase on its local document and same-origin top document. Those events only invalidate visibility evidence: the unchanged predicate must still pass after two frames before any observed position is queued. A covered, hidden, inert, inactive, scrolled-up or unfocused chat remains unread. Listeners are removed by the existing cleanup. There is no popup-specific read bypass.

## Validation and resources

- Focused queue/read-state/unread propagation tests: **30 passed**, including settlement success/failure, unrelated failed chat preservation, disposal, newer arrivals, scope isolation, microseconds, stale summaries and server acknowledgement.
- Actual reader/summary hooks, mobile surface, queue and broadcasts: **144/144 browser checks passed**, 36 each in Chromium mobile/desktop and WebKit mobile/desktop. Team/client paths retain counts under delayed/failed saves and clear shell/row counts only after acknowledgement. Retained native dialog close now reconciles without another interaction. Existing opening cases continue to issue exactly one acknowledged read.
- An initial full repository run passed **1,395 tests** before adding the final unrelated-failed-conversation regression; that final regression is included in the 30 focused tests above. The combined consolidation full suite/build remains an integration gate.
- Changed-file lint, historical migration preservation and whitespace gate passed. No schema changes.
- Source resource comparison: two extra event listeners per active reader document (at most the local and top documents), disposed with the reader; one extra bounded pending-map check per settled drain, at most 256 currently pending positions. No timer, polling loop, socket, metadata/history request, message-body load or provider operation is added. Existing request serialization and quiet recovery remain intact.

All browser account/message I/O is synthetic and external requests are blocked. These fixtures establish behavior, not production latency. Authenticated production reading, background/resume on real devices, Android/Chrome and iPhone/Safari/PWA verification remain outstanding. No real messages or read cursors were generated for testing.

## Release and rollback

Application-only repair. Integration must preserve the current read/summary RPC prerequisites and pass the release gate against the exact combined commit. This report is not deployment or production-schema evidence. No branch was pushed and no production mutation was performed for this workstream.

Rollback the application changes if needed; preserve stored read positions, messages, files and existing migrations. No data reversal or notification-policy change is necessary.
