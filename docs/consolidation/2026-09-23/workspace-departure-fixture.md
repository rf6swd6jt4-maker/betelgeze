# Mounted workspace departure fixture

`node scripts/serve-workspace-departure-fixture.mjs` serves a synthetic workspace on a randomly assigned `127.0.0.1` port. Add `--baseline` for commit `7a35b73d`; add `--development` to use development React and exercise StrictMode effect/updater replay. Production mode uses the installed React/ReactDOM 19.2.4 and Next's bundled webpack. No dependency installation, authenticated account, production records, provider calls or deployment is needed.

The fixture copies application declarations through TypeScript AST extraction, then runs them against explicit shell mocks and real React state in a mounted tree. It uses the real autosave registry, frame departure transport, identity checks, error boundary and visible-paint helper. `useCallback` memoization, the complete host/native component trees, shell bootstrap, data reads, authorization and actual frame page receivers are not exercised. A small synthetic frame receiver implements the real transport protocol.

The 32 cases include native and iframe close, native Retry, renderer replacement, full-pool eviction/reopening, ordinary native push/replace, refused saves, input during/after acknowledgement, competing intent, account/owner changes, speculative checkpoint-only warming, owner-free switching, Suspense, error recovery and StrictMode-sensitive reopening effects. Synthetic input is injected deterministically around the final checkpoint. These are mounted commit-boundary regressions, not authenticated application or physical-device tests. Hard iframe Retry, legacy Next transitions inside an iframe and actual browser unload remain separate boundaries.

## Timing definition

The five warm and five gated-destination samples in each production run start immediately before the action. A layout effect in the fixture's committed `Body` recognizes the requested active tab or route and arms the application's unchanged `afterVisibleWorkspacePaint` helper. That helper requires two visible animation-frame opportunities. The clock stops in its completion callback. Polling DOM assertions do not schedule the paint measurement.

The gated destination waits on a synthetic ten-millisecond data promise, and React's actual Suspense scheduling is retained. This is not a production cold network/cache/bootstrap measurement. Warm timing is also a small synthetic observation, not proof of platform latency or a p95 benchmark. Development-mode times must not be used for performance conclusions.

A two-second deadline cancels the paint listener/frames. Missing paint is explicitly counted and includes document visibility, focus, elapsed time and whether a matching DOM commit occurred; it is never replaced with a fabricated duration. Correctness checks use separate bounded DOM assertions, so suspended browser painting does not hang all subsequent cases. Safari app focus can prevent animation frames even when DOM work proceeds.

Earlier fixture development used a 35ms assertion for Suspense settlement, then a DOM poll before starting animation frames. The first could prematurely fail correct suspended content; the second added polling/frame-phase noise. The final harness waits for the correct committed DOM and arms the actual lifecycle helper at commit. Those changes affect fixture observation only and preserve all 32 correctness cases.

## Evidence and isolation

Every completed run posts a bounded JSON report to its own loopback server. The server rejects other origins and payloads over 256 KiB, writes a unique result file in its temporary bundle directory and prints that path. Each report contains exact SHA256 hashes of the application sources used in its bundle, case results, build mode, React/browser versions, samples, and missing-paint details.

The integration report records which completed baseline/candidate browser runs are authoritative. Source callbacks with injected dependencies cannot establish full-app hydration, authenticated route behavior, actual browser-unload handling, iOS/PWA behavior or Android-device behavior.
