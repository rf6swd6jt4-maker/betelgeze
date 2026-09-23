# Shell departure continuation: browser evidence

The final mounted React fixture passes **32/32 checks in Chromium 153**, compared with **20/32** on baseline `7a35b73d`. Development React with StrictMode replay also passes **32/32**. A completed earlier Safari 27/WebKit 605.1.15 run improved from **20/32 to 32/32** using application callbacks and runtime helpers proven byte-identical to those in the final fixture. The final timing-corrected Safari run has not been verified complete.

All work used loopback servers, synthetic editors and local React bundles. No client records, production settings, provider operations, migrations or deployments were involved.

## Correctness evidence

| Browser/build | Baseline | Candidate | Paint samples missing |
| --- | ---: | ---: | --- |
| Chromium 153, final production harness | 20/32 | 32/32 | 0 in either run |
| Chromium 153, final development StrictMode | Not rerun | 32/32 | 0; development timings excluded below |
| Safari 27 / WebKit 605.1.15, earlier completed harness | 20/32 | 32/32 | Earlier harness had no bounded missing-paint classification; its times are not used |

The twelve failing baseline cases expose accepted late-input loss during native/iframe close, native Retry, renderer replacement, resident eviction/reopening, native push/replace and Suspense transitions, plus insufficient protection against input during a pending native save and native-owner replacement. The candidate passes these probes. Other cases cover refused saves, competing A→B→A intent, account change, checkpoint-only warming, owner-free switching, explicit error recovery and single-effect reopening under development StrictMode.

The fixture runs extracted application callbacks and actual helpers against explicit mocks in a real React tree. It does not mount the complete application component graph or test hook memoization, bootstrap, authentication, real panel reads or actual frame page receivers. Synthetic input is scheduled deterministically around acknowledgement and commit. See [fixture method and boundaries](./workspace-departure-fixture.md).

## Production Chromium timing observations

The final definition starts at the action and arms the application's `afterVisibleWorkspacePaint` helper from the matching committed Body layout effect. Two visible animation-frame opportunities are required. DOM polling does not start or stop the paint clock. These are five observations per path and variant, not p95 measurements or a production speed claim.

| Synthetic action | Variant | Samples | Median | Range |
| --- | --- | ---: | ---: | ---: |
| Warm resident native switch | Baseline | 5 | 28.1 ms | 20.0–29.6 ms |
| Warm resident native switch | Candidate | 5 | 28.3 ms | 3.5–29.6 ms |
| Gated native destination through Suspense | Baseline | 5 | 326.7 ms | 305.0–335.6 ms |
| Gated native destination through Suspense | Candidate | 5 | 312.3 ms | 306.0–312.7 ms |

Both final production runs produced all ten requested samples, with zero deadline-based missing paints and zero failed timing cases. The gated destination uses a synthetic ten-millisecond promise and real React Suspense scheduling; it does not model a production cold request, cache miss or bootstrap. Frame scheduling and browser conditions affect these small samples. They do not establish a platform latency guarantee or a measured production improvement.

Earlier observations armed frames after polling the DOM and contained frame-phase noise. Earlier Safari measurements also included long focus/suspension delays. Those timing cohorts are superseded and are not mixed into this table. Independent review checked all 32 case identities, unchanged non-timing case bodies, seven application source hashes and seven deterministic timing/lifecycle scenarios.

## Safari limit and source parity

The earlier completed Safari reports are retained exactly. The later final harness repeatedly remained in progress while the native app tool reported `noWindowsAvailable` for an operation, although accessibility state could still be read. Foreground execution and final completion could not be established reliably. This is an automation/browser evidence limit; it does not demonstrate an application regression. No final Safari timing comparison or development StrictMode result is claimed.

[Callback parity evidence](./evidence/shell-safari-callback-parity.json) compares the generated declaration bundle and autosave, departure, tabs and frame-navigation modules from the completed Safari candidate against the final candidate: all five are byte-identical. The full NativeWorkspaceTab file hash changed due to a later lint-only stable-ref alias outside the extracted callback. This parity establishes the tested callback/helper identity, not complete-component identity or equivalence of the timing harnesses.

Hard iframe Retry, legacy Next transitions within an iframe and browser unload remain separate boundaries. Authenticated full-app checks, physical Android/Chrome and iPhone/Safari/PWA checks remain unverified.

## Raw reports

- [Final Chromium baseline](./evidence/shell-chromium-baseline-final.json)
- [Final Chromium candidate](./evidence/shell-chromium-candidate-final.json)
- [Final Chromium development StrictMode candidate](./evidence/shell-chromium-candidate-strictmode-final.json)
- [Historical completed Safari baseline](./evidence/shell-safari-baseline-historical.json)
- [Historical completed Safari candidate](./evidence/shell-safari-candidate-historical.json)
- [Historical Safari callback/helper parity](./evidence/shell-safari-callback-parity.json)

Every final report contains the exact application SHA256 source manifest. `missingPaintSamples` counts explicit paint deadlines; an assertion failure in a timing case is reported separately as a failed case and can also prevent a sample. Always read case failures and actual sample counts alongside the missing-paint counter.
