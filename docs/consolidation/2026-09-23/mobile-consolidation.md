# Workspace mobile viewport correction

## Causal assessment

The workspace locks `html` and `body` while the shell is mounted. The fixed top bar, tab bar and panel start at 0, 56 and 100px; the composer controller owns the panel's keyboard bottom. `createViewportOriginRecovery` deliberately waits until keyboard closure before correcting document scroll, so it cannot keep chrome visible during a keyboard pan. A [WebKit report](https://bugs.webkit.org/show_bug.cgi?id=311821) describes a locked body whose bounding rectangle moves to -84px on iOS keyboard focus while document scroll remains zero. That is a credible mechanism for the reported upward movement, but the report measures its body, not this app's top bar. We have no physical-device measurement proving that the app's top bar rectangle follows the same coordinates.

The local synthetic fixture injects an 84px body pan into the actual locked-shell CSS and runs the real composer controller. Before correction, Chrome measured top bar -84px and panel bottom 416px for a requested 500px keyboard edge, with document scroll zero. With the candidate correction, the top bar measured 0px and the panel ended at 500px. This establishes that measured shell displacement causes and repairs the fixture failure. It does not establish that the iOS compositor exposes its painted displacement through `getBoundingClientRect` on this app.

## Change

`lib/workspace-visual-origin.ts` measures the fixed top bar on the shell's existing viewport events and once in the next frame, then writes one bounded origin offset. Locked-shell CSS shares that offset across the fixed top bar, tab bar and panel. It uses neither document scroll writes during focus nor `visualViewport.offsetTop`, and does not touch editor focus, selection, drafts, message reads, unread counts, activity, push, or subscriptions. Suspension cancels its pending frame; return remeasures; teardown clears the offset. Desktop and zoom release the correction. The standalone client portal keeps its separate composer viewport owner and is unchanged.

## Validation and limits

- `node --test --experimental-strip-types tests/workspace-visual-origin.test.ts tests/viewport-origin-recovery.test.ts tests/composer-viewport-controller.test.ts tests/chat-viewport-state.test.ts`: 35/35 passed, including 250 consecutive pan/unpan transitions on one mounted controller, delayed metrics, suspension, teardown, desktop and zoom. The `tests/communications-interactions.test.ts` CSS contract was updated to assert the fixed chrome's shared offset; its 8/8 tests passed.
- Scoped ESLint for the helper, its tests, the communications interaction test and workspace shell, plus `git diff --check`: passed.
- `node scripts/serve-workspace-visual-origin-fixture.mjs` in desktop Chromium 153 and Playwright WebKit 26.6: candidate 6/6 in each engine, synthetic baseline (`--baseline`) 3/6. The fixture checks real input focus and selection, fixed chrome positions, panel bottom, keyboard close/reopen, and correction release. No client data or remote request is used.
- Synthetic desktop-browser pan is a geometry model, not a real Android/Chrome or iPhone/Safari keyboard. Physical-device browser and installed-app checks remain necessary, especially whether painted top-bar movement appears in its bounding rectangle. No production speed conclusion or authenticated production UI claim follows from these checks.
