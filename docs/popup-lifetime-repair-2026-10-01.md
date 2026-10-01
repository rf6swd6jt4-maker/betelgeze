# Popup lifetime repair — 2026-10-01

Base: `a685f6ec65a8c8e734d8501109bc18916377dbd5` (PR #50).

The reported lingering vignette after ordinary touch dismissal remains unconfirmed on the user's device. The previous hidden-chrome filter mitigation did not resolve their report. This follow-up fixes reproduced ownership failures; it does not treat an emulated clean screenshot as physical-device acceptance.

## Reproduced failures

- Opening a member profile from a roster left both custom modals listening for keyboard input. The roster captured Tab; Enter could dismiss the underlying roster while the profile's 8px blur backdrop remained. Escape could dismiss both owners. The profile now uses the shared native dialog lifecycle, and the underlying roster yields keyboard ownership. Avatar triggers explicitly focus before opening so Safari can restore the right control.
- A dialog or anchored menu opened by a same-origin embedded tab was portalled into the parent document. Removing or navigating its source frame did not run its React cleanup, leaving the parent popup and any dimming layer open. The source document's page lifecycle now retires its exact owned portal, including parent-document event listeners. OKR dialogs use the same native modal lifecycle as the other shared dialogs.
- Service catalogue, invitation and branding popups portalled into the shell without respecting their retained tab's active state. They now retire presentation on departure, keep appropriate unsaved form state, and require an explicit reopen. Hidden owners release their keyboard and scroll effects.

## Scope and performance

This is client-side popup ownership only. No schema, API, permissions, message-read, push or stored-data changes. Cleanup is event-driven and targets the owned popup; no polling, document-wide overlay deletion, reload, additional provider call or rendering loop is introduced. Existing shared opening motion and immediate dismissal remain. Browser fixtures use synthetic records and block external requests.

## Validation and limitations

The reviewed source passes changed-file lint, the foundation change gate, `git diff --check`, all 1,423 unit/contract tests, and the isolated production Webpack build. Browser dependencies were freshly installed from the existing lockfile. Focused Chromium/WebKit results:

- Native owner lifetime: 18/18, including removal/navigation/reload of both active and inactive frames. Browser-cache retention is an explicitly simulated persisted-event sequence.
- Anchored menu lifetime: 16/16; iframe-owned parent listener counts return from six to zero after departure.
- Settings/admin custom popups: 88/88; initial service dialogs in development React StrictMode: 4/4. The old source fails all six actual custom-popup frame-removal cases.
- OKR dialog lifecycle: 14/14, including retained draft, close/Escape, and frame removal/navigation/reload.
- Full-viewport touch roster/profile cleanup: 32/32 with normal motion and device scale 3. Only the thin boundary of an intentional keyboard focus ring is excluded from pixel equality; visible filters and pseudo-element layers are inventoried separately.
- Existing relationship drawer/modal regression: 52/52. Full Foundations and hosted candidate checks are recorded on the pull request before production advancement.

Two legacy source-pattern assertions were extended to require the new explicit editor-open state; they remain in place. The browser matrix additionally exercises the template chooser's transition to the custom service editor.

Before the patch, full-viewport normal-motion touch diagnostics in Chromium and WebKit, plus a headed WebKit subset, did not reproduce residue from ordinary roster close/backdrop/reopen. These checks are broader than the earlier title-only screenshot test but cannot reproduce every physical browser compositor.

The signed-in browser automation surface is unavailable in this session because its configured writable root is a symlink rejected by the executor. No authenticated production or physical-device verification is claimed. Final release checks and deployment evidence are recorded with the pull request.
