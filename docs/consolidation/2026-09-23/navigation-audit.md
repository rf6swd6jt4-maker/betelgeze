# Navigation audit evidence and regression coverage

Audited repository: `/private/tmp/betelgeze-platform-consolidation`.

Baseline: `31388081894e6d4143d5bb0d577c0341ec31edf7` (23 September 2026 audit).

No application-source edits, database requests, browser actions, or provider actions were performed by this audit. These evidence files live outside the repository. The dependency symlink was supplied by the parent task; the audit did not install dependencies. `git diff --name-only` was empty at evidence capture.

## Reproduction

- `navigation-audit-probes.mjs`: the three original diagnostics retained as a reusable script, with source-marker assertions, repository argument, and source SHA-256. It executes actual production callback bodies in isolated stubs. The assertions confirm baseline defects; later repairs should make these diagnostic assertions fail. It is not an acceptance suite.
- `navigation-audit-probes.log`: successful reproduction output for all three diagnostics.
- `navigation-lifecycle-tests.log`: the previously unavailable fixture rerun after the dependency symlink became available; **9 passed, 0 failed**.
- `navigation-targeted-tests.sh`: exact reusable command for the bounded navigation test group.
- `navigation-targeted-tests.log`: **91 passed, 0 failed, 0 skipped/cancelled**, across 11 files. Node v24.16.0. This replaces the earlier partial result of 35 passes and one missing-dependency file failure.

Run from any directory:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON /private/tmp/be-consolidation-evidence/navigation-audit-probes.mjs /private/tmp/betelgeze-platform-consolidation
sh /private/tmp/be-consolidation-evidence/navigation-targeted-tests.sh /private/tmp/betelgeze-platform-consolidation
```

SHA-256 of `components/workspace/WorkspaceTopBarClient.tsx` used by the diagnostic run:
`53e13a8792de7ab6f07649d444536aef459a95411846c4b60cb061259f27e652`.

## Findings and evidence strength

1. **Failed frame draft persistence is bypassed by shell Retry.** `WorkspaceTabFrameGuard.tsx:30-40` correctly runs the registered flush and reports failure. `WorkspaceTopBarClient.tsx:2457-2469` then implements Retry as forced iframe location replacement without another flush. Diagnostic 1 invokes the actual frame navigator and actual shell callback: the first flush returns false, no router navigation occurs, then Retry issues `ensureTabFrameLocation(tab, destination, "replace", true)` without another flush. This is a reproducible control-flow defect, not proof of a production record being lost.

2. **Iframe-to-native renderer replacement is not gated by the iframe draft owner.** `WorkspaceTopBarClient.tsx:470-478` checks native owners only. At `1918-1939` the host updates tab URL before sending the frame navigation request, while the render branch near `2715` selects a native component from that new URL. Diagnostic 2 executes the current preparation/navigation callbacks and confirms that target renderer selection proceeds with no iframe acknowledgement. It stubs the state setter and does not simulate React commit timing. The immediate close path beginning around line 2191 has the same native-only guard, based on source inspection. Actual frame blockers exist in `SopAssetUpload`, `WorkspaceAutosaveForm`, and `ManualSettingsForm`.

3. **Optional UI-state storage errors propagate through shell initialization/navigation.** `WorkspaceTopBarClient.tsx:618` writes session storage unguarded. Bootstrap invokes it at 1010 before scheduling the hydration update at 1011-1015. Diagnostic 3 invokes the actual storage callback against a throwing storage fixture and observes `QuotaExceededError`. Other unguarded context/sidebar accesses exist at approximately 1020, 1122, 1693, 1710, 1819, and 2176. This finding concerns shell restoration metadata; durable draft checkpoint failure must continue to block destructive departures.

4. **Native shell Retry does not reset the component error boundary.** `NativeWorkspaceTab.tsx:69-74` retains `failed` state until the boundary's own button resets it. Shell Retry only sends activation/refresh; the native handle at 232-234 only reruns the read. The boundary key at 315 stays the route key. Source/control-flow finding; no mounted React fixture was run for it.

5. **Closed-tab bookkeeping is unbounded.** New tabs append stable IDs around `WorkspaceTopBarClient.tsx:1116` and 2167; close does not prune that list or the stored per-tab context key. `lib/workspace-tabs.ts:234-239` reconstructs the positions Map from all retained IDs. Open-tab/residency limits do not bound this auxiliary list. Source finding; no long-session latency/memory claim.

6. **Sidebar framework prefetch bypasses the native-link safeguard.** The shell imports `next/link` directly and the sidebar link at 2778 has no `prefetch={false}`. `WorkspaceLink.tsx` disables route prefetch inside native navigation. Installed Next documentation at `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md:294-304` confirms production viewport/hover prefetch under the default `auto` behavior. The duplicate/unused route request mechanism is supported by source and local framework documentation; the actual number, payload, server work and latency require a production-mode network fixture. No browser measurement was performed.

Potential failed-lazy-import recovery, background shell-secondary retry activity, stale deployment behavior, and presence/Realtime reconnect issues remain separate investigation items. Do not describe them as established causes of the reported production slowdown.

## What tests protect today

| Test file/group | Actual evidence | Boundary not covered |
| --- | --- | --- |
| `workspace-record-cache` | Runs the production cache class with deferred reads and fake timers. Covers hung-request expiry, dedupe release, stale generations, error retention, subscriber/LRU interaction, account clearing and rollout keys. | HTTP/browser transport and mounted React consumption. |
| `workspace-navigation-lifecycle` | Runs deadline/paint helpers with controlled clocks/events; executes extracted production shell begin/complete callbacks. Covers foreground budgets, queued stale callbacks, hidden commits and matching late recovery. | Real browser suspension, actual paint, iframe process scheduling. |
| `workspace-interrupted-navigation` | Runs the production navigator; executes extracted host navigation callback. Covers A-B-A, out-of-order flushes, duplicate intent, blocked flush, dispose and root receiver selection. | Composition of failed frame flush with the shell Retry/close/renderer change. This gap permits findings 1 and 2. |
| `workspace-autosave-navigation` | Runs the production flusher registry and flush function. Covers durable checkpoint success, checkpoint failure and network timeout. | Whether every destructive shell action consults the owner before unmounting it. |
| `workspace-frame-recovery` | AST-extracts actual callbacks/effects, supplies stubbed hooks/state/frames and executes them. Covers stable launch/ref identity, renderer readiness reset, probe-only fallback, stale messages and late replacement. | React mount/unmount, streaming App Router, real message queues. |
| `workspace-native-ready-handshake` | Extracts actual host/native/Ready effects and manually executes a child-before-parent layout/passive scheduler. Covers the historical passive-registration defect and hidden cached commits. | Actual React scheduler and error-boundary behavior. The fixture models React order rather than mounting React. |
| `workspace-loading-failures` | Executes extracted auth/read/refresh functions with mocked responses and real cache. Covers transient versus definitive access failures, identity mismatch, cancellation and exact retry failure. | Supabase/network integration; error boundary reset or lazy-module failure. |
| `workspace-navigation-performance` | Runs production measurement/tracker logic against a fake clock. Covers exact destination paint and failure/supersession accounting. | Measured application latency or device performance. |
| `workspace-tabs`, `workspace-tab-scroll`, `workspace-cold-entry` | Pure production helpers, plus an extracted bootstrap URL expression. Covers route identity/history limits, ordering, scroll bounds and launch destination. | Full tab lifecycle/churn and failed storage. |
| `workspace-background-runtime`, `workspace-progressive-loading`, part of `workspace-shell-performance` | Predominantly source-string/regex guards (with some pure-helper behavior tests). Check that expected constants, attributes, hooks and source patterns exist. | They cannot prove that the visible UI follows the expected lifecycle, that flush results are respected, or that network work is bounded at runtime. |

The current helper/callback tests do prevent regressions in several previously repaired mechanisms. They are materially stronger than source-text assertions. However, they stop at component seams, so separately correct helpers can still be connected unsafely. Both the existing 91 passing tests and the three defect probes pass at this baseline.

## Release enforcement and missing coverage

- `package.json` exposes `npm test` as Node's test runner. `app_speed.md` requires tests, changed-file lint, diff checks and an applicable production build.
- The only checked-in GitHub workflow is `.github/workflows/deploy-ner.yml`. It triggers the NER deployment hook and does not run application tests or builds. No checked-in application CI gate enforces these safeguards. This says nothing about uninspected external Vercel/project settings or branch rules.
- `scripts/benchmark-workspace-browser.mjs` supports controlled Chromium/WebKit measurements, isolates remote origins and blocks writes by default. It is opt-in and expects user-supplied fixture cases/auth. It starts each iteration with `page.goto`, so it is not itself an aged-session or tab-churn regression test.
- Documentation records historical authenticated observations and repaired causes. Those records are not current browser evidence and must not substitute for rerunning the affected interaction.

Needed focused acceptance coverage before repairing/promoting these findings:

1. A component/frame fixture covering a false or pending frame checkpoint followed by shell Retry, close, renderer change and eviction; no owner may be discarded, and the old usable panel must remain reachable. Add late, stale and missing acknowledgements, rapid intent replacement, and successful safe departure.
2. Real mounted native error-boundary recovery through the visible shell Retry, while ordinary refresh preserves usable content/drafts. Handle module-load failures separately from data failures.
3. Storage-denied and quota-exhausted shell entry/switch/close fixtures; optional restoration failure must not bypass durable draft failures.
4. Repeated tab open/close/reopen while measuring listener/timer/metadata bounds and stable iframe/native identity.
5. Production-mode Chromium and WebKit network fixtures for sidebar navigation/prefetch, then long-lived/background/offline-resume sessions. Android/Chrome and iOS/Safari physical-device evidence remains separate.

Any common-shell change must preserve the protected tab-activity/read/alerts contract. No test result here authorizes modifications to that behavior or proves client-message delivery.
