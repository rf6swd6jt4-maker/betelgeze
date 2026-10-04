# Comms reference tap selection

Base: `7ebde91a86b69aa979fc25689e39c5f6f5cca8f1`. The user confirmed the internal scrolling repair and reported that tapping a suggestion on iPhone dismissed the popup and keyboard without inserting it. This repair is confined to option activation in `ComposerMentionPicker`.

## Cause and repair

The picker cancelled `pointerdown` to retain editor focus, then depended on a later `click` to insert the suggestion. Browser-generated touchscreen taps exposed an engine difference hidden by the earlier fixtures: Chromium generated the click, while WebKit delivered pointer and touch events without the compatibility click. Person, record and final-row-after-scroll selections all failed in the WebKit baseline. A plain native button control did receive its click, confirming the probe could activate native controls.

Removing pointerdown cancellation alone exposed the other failure path: compatibility `mousedown` blurred the editor, its existing blur handler removed the picker, and selection never ran. The fix leaves pointerdown available for native activation and freezes the existing suggestion choice there. It cancels only the row's `mousedown` focus default. The existing click handler then inserts the chosen identity while retaining editor focus. Native gesture recognition continues to distinguish taps from scrolling; no custom touch recognizer or delayed focus recovery is added.

The composer/editor, footer, top bar, mobile viewport, shared popup/selector, touch-containment helper and scrolling styles are unchanged. No search, API, schema, permissions, reads, alerts, data persistence or panel-loading behavior changes. This replaces event handling only while the picker is present, adding no request, timer, observer, subscription or background work.

## Validation and rollout

The original deterministic fixtures dispatched a synthetic pointerdown followed by `HTMLElement.click()`, bypassing native click suppression and default focus ordering. The regression suite now also drives browser-generated touchscreen taps in touch-enabled mobile contexts and actual mouse clicks on desktop. It checks person and record identity insertion, final-row selection after scrolling, editor focus, popup dismissal after insertion, unchanged surrounding geometry and no accidental send. Dragging/scrolling must leave the draft untouched before the final tap.

Baseline traces are preserved in `/private/tmp/be-reference-native-tap-delayed-baseline-7ebde91a.json` and `/private/tmp/be-reference-native-tap-isolation-7ebde91a.json`. Candidate unit/build/browser, exact-commit hosted CI, deployment and live-file evidence are recorded separately under `/private/tmp/be-reference-tap-*`. These synthetic Chromium/WebKit checks do not establish physical iPhone/Android acceptance. The supplied recording establishes the reported failure; it is not copied into repository fixtures or release evidence.

Release the exact candidate only after the reliability gate. Rollback can restore the base application without changing schema, messages, drafts or permissions; the earlier internal-scrolling repair remains in the base.
