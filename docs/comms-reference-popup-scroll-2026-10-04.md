# Comms reference popup scrolling

Base: `d827274b4de50bccf83ea198bd1c35be3bdabe90`. The user reported that dragging the mobile reference picker moved the popup, and desktop could not scroll through its choices. Scope is the reference popup only.

## Cause and repair

The screen-reader-only loading status was absolutely positioned relative to the fixed popup, outside the list's scrolling containment. In the short-viewport reproduction, it inflated the popup's measured scroll height to 180px while its client height was 112px. Removing the status did not resize the border box, so the old placement remained until an internal scroll triggered another measurement. Both Chromium and WebKit moved the popup by 68px while the composer, anchor and document stayed fixed.

The picker now contains that status in its own positioned scroll area. A scoped flex/min-height chain passes the existing anchored height limit to that area instead of retaining nested independently overflowing lists. The existing touch-containment helper is attached only to the portalled picker while it is open: native internal scrolling remains available, while drags at its edges or padding cannot pan the surrounding keyboard viewport.

Desktop previously rendered only four total suggestions, which usually fit without overflow. The popup now keeps the same approximately four-row visible size and exposes a bounded eight-choice set from the already available roster and reference response. The server still returns at most four records. Search source windows, requests, authorization, cancellation and database indexes are unchanged.

Runtime changes are limited to `ComposerMentionPicker.tsx` and its local suggestion-merging helper. The composer/editor, footer, top bar, chat viewport, message pane, global CSS, shared `AnchoredPopup`, shared `Selector`, touch helper, reads and alerts are unchanged. There is no migration or additional data request, timer, subscription, background task or panel-loading gate. Touch listeners exist only for the open picker and are removed on disposal.

## Validation and rollout

The actual-component browser fixtures now cover pending and completed search during internal scrolling, stable popup/anchor/composer/header-marker geometry, surrounding scroll preservation, edge containment, a short non-overflowing list, last-row selection and focus retention. The reference fixture runs at mobile and desktop widths in both Chromium and WebKit. Browser-generated wheel and Chromium touch probes are recorded separately from the deterministic in-page gesture-policy tests.

Local validation: all 1,452 unit tests passed; the production webpack build passed with local placeholder settings (`gA-ZUrbq2jtii-7HF1A2O`). The focused reference fixtures passed 88 checks, 22 per viewport/engine combination. Seven native-input probes passed: desktop wheel scrolling advanced the inner list 160px with popup top unchanged at 537px; constrained narrow wheel scrolling advanced 248px with popup top unchanged at 77px; the Chromium touch probe advanced 35px with the same stationary popup. Composer/anchor/header-marker bounds, surrounding scroll and focus were preserved. The old build jumped 68px in the matched constrained cases. These are geometry/interaction observations, not production latency measurements.

Validation logs and before/after geometry are preserved under `/private/tmp/be-reference-popup-scroll-*`. Exact candidate CI, production deployment and live asset checks are recorded separately at release time. Synthetic header markers and browser emulation do not establish physical iPhone/Android behavior; the supplied recording establishes the original failure, not acceptance of the repair.

Release only the tested candidate after the existing reliability gate. Application rollback can restore the base without changing stored messages, drafts, permissions, records or schema.
