# Popup blur removal — 1 October 2026

Base: `04e35ea01d9cdecea302817cce4573f0e787d054` (PR #51).

## Evidence and cause addressed

The supplied physical iPhone recording shows the client-chat header sharp before opening the participants popup, blurred after dismissal, then sharp again after leaving/reopening the chat. The same popup/dismissal reproduces the residue a second time. The message pane is sharp after dismissal, and no member profile is opened. This rules out the nested-profile ownership failure as the trigger in this recording. The popup's full-screen dimming surface disappears; its teardown triggers a persistent header rendering defect.

The participants popup itself contains no blur. The resident workspace top/tab bars do: two `backdrop-filter: blur(8px)` surfaces occupy the upper screen. The earlier mitigation suppressed them only in the open/dismissing-keyboard phases. Matched source fixtures in Chromium and WebKit confirm that both layers still apply 8px blur at rest and during entering/leaving. Popup and viewport changes can therefore recompose a retained blur input over the same header region. This is the rendering mechanism removed by this patch. The exact compositor failure on the recorded iPhone is inferred from its pixels and the source-layer inventory; it was not reproduced in desktop WebKit and must not be reported as a independently confirmed browser bug.

## Change

Workspace navigation is opaque neutral paint and never creates or toggles a backdrop-filter layer. The visibility-dependent filter suppression is retired. A shared CSS rule prohibits backdrop filtering on workspace chrome, native/custom modal roots and loading overlays in every phase, including native `::backdrop`. Full-screen popup/loading dimming surfaces retain their existing tint and remove blur utilities. The two internal modal headers that used backdrop blur become opaque. Marketing headers and small image-edit/drag affordances retain their unrelated styling.

The native/custom modal ownership, immediate dismissal, focus restoration, scrolling, card-entry motion, drafts and saved mutations are unchanged. No header remount, forced repaint, polling, delayed close, request, subscription, viewport owner, dependency, schema, provider call or data migration is introduced. This removes compositor work rather than adding interactive work; no production latency improvement is claimed.

## Regression coverage

The existing actual-component roster/profile suite now requires no navigation filtering at rest and through all four conversation phases. It retains full-viewport pixel equality, thin keyboard-focus-ring allowances, close/Escape/backdrop, nested profile ownership and tab/departure checks. Portal actions add three repeated cycles for each dismissal method and a saved fulfilment-progress change surviving dismissal/reopen. The local I/O is deliberately synthetic and blocks external requests.

Validation results and release identity are appended below after completion. Physical iPhone and Android verification, authenticated isolated-workspace acceptance and sustained-session observation remain separate from emulated browser checks. Rollback restores the previous application revision without changing stored data.

## Completed local validation

- All 1,423 application tests pass; changed-file lint, foundation migration/whitespace gate and production Webpack build pass. No migration added or changed.
- Popup suite: 42/42 cases in Chromium/WebKit at device scale 3 with normal motion. Repeated portal dismissal checks preserve full-viewport pixels; saved progress is retained.
- Full foundation fixture suite: 32 engine/fixture runs and 550 assertions pass. These include conversation motion/layout, departure, retained drafts and search.
- Unchanged-source comparison: both engines report two 8px navigation blur layers at rest, entering and leaving; open/dismissing-keyboard report none. The candidate reports none in all five states. This proves removal of the residual blur mechanism, not independent reproduction of the physical iPhone compositor defect.

Hosted checks and production advancement use the exact candidate commit on the linked pull request.
