# Pass 2 mobile motion repair

`lib/chat-viewport-motion.ts` now retires gesture ownership together with temporary animation geometry when a resident surface hides or the existing shell visibility event deactivates it. Retirement cancels both timers and discards the obsolete motion without applying its endpoint. It also handles a lost gesture that did not yet own an animation. An active visible gesture still defers final scroller resizing until touch and momentum settle.

The helper consumes the existing tab event and does not change tab selection, message reading, unread state, activity leases, subscriptions, push, scroll anchoring, keyboard geometry ownership or provider behavior. There is no new poll, network request, observer or eager import of an application component. A single event listener and constant import replace stale ownership; cleanup removes the listener.

## Validation

- **47/47** related unit tests pass, including five new regressions covering hidden return, deactivation before CSS hide, lost touch without a pending animation, active gesture preservation and disposal. Scoped ESLint passes.
- A local browser fixture serves the actual transpiled helper and a synthetic 390px resident-frame document. Through the supported computer-use interface, the candidate passed **5/5 in Chromium 153** and **5/5 in Safari 27 / WebKit 605.1.15**.
- The identical fixture with the baseline helper from `31388081894e6d4143d5bb0d577c0341ec31edf7` passed **2/5 in each engine**. Hidden return, deactivation and lost-touch recovery failed; normal motion and active-gesture deferral passed. Chromium retained an 800px applied height instead of the requested 500px/450px. WebKit could suspend animation completion while stale gesture ownership also prevented its fallback from resolving.
- Fixture development corrected two test-harness assumptions: a normal completion can cancel the animation promise when the helper releases its transform, and WebKit can suspend animation finish events. The final active-gesture case waits through the existing 440ms fallback deadline before releasing the touch, then asserts final geometry. Neither correction changes application code or weakens the final geometry/deferral assertions.

Reproduce from the worktree using `node scripts/serve-chat-viewport-fixture.mjs`; open its loopback URL in Chromium and Safari. Use `--baseline` for the unchanged helper. The fixture contacts no remote host and uses no client data. Both temporary servers and browser tabs were closed after validation.

These are synthetic desktop-browser engine checks with mobile-width documents and synthetic gestures. They do **not** establish physical Android keyboard/Chrome, iPhone keyboard/Safari/PWA behavior, authenticated production behavior, or a production latency improvement. Those remain Pass 3 release checks.

## Baseline suite repair

The pre-existing failing OKR test required an obsolete exact font-class string. The shared TrendChart had already changed in `9da41e93`. The test now renders the actual component in both supported light/dark surfaces and verifies labelled value/period positions and its empty state. No chart or OKR product code changed. All **26** tests in that file pass at this stage; the final combined suite remains the integrator's gate.
