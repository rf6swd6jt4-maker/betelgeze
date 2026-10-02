# Comms popup edge-bar investigation — 2 October 2026

Base: `155f59f03fae1ae2f7e265c994fb9be27820ebfc`. The user confirmed that removing authored backdrop filters did not fix the physical iPhone effect and added image-preview dismissal as a trigger.

## Evidence and regression

Participants (`useRosterDialog`), image previews (`MessageMediaLightbox`), and portal actions (`useModalDialog`) have separate close owners. Each removes its overlay and restores its captured state. Gallery/roster overflow cleanup predates the latest Comms revamp. No shared retained CSS blur or missing teardown operation was found. The supplied recording shows a progressive blur across the top header after closing, with sharp message content below.

Commit `df022130` changed mobile selected conversations to a body-level absolute surface, with a static body and a static flex header. It hides the previous fixed workspace chrome. This absolute geometry deliberately avoids the physical keyboard displacement caused by a fixed whole-chat surface; preserve it. A popup temporarily adds a fixed surface at the top edge. After dismissal the visible conversation has no fixed/sticky top-bar ancestor.

WebKit implements a browser-owned scroll-edge blur independently of author `filter` and `backdrop-filter`. Its [edge sampling source](https://github.com/WebKit/WebKit/blob/efb116d18fdf3392f3dce60453b9f78b80eb4cb2/Source/WebCore/page/LocalFrameView.cpp) accepts visible fixed or sticky containers on the hit-test ancestor chain, with sufficient width and visible background. A plain absolute surface/static header does not qualify. WebKit's [scroll-pocket policy change](https://results.webkit.org/commit?uuid=175056451300) explains that edge bars suppress native blur in favor of an opaque color extension. Popup removal changes that classification, providing a mechanism consistent with all three reported triggers and the failed CSS-blur removal.

This is a source-supported explanation, not an independently reproduced physical iPhone result. Headless desktop WebKit has no iOS status-bar scroll-pocket UI. Its pixel comparisons cannot establish the native effect is absent. The user's exact OS/version is requested; it is not assumed.

## Narrow correction

The existing direct header of `.mobile-conversation-surface` uses `position: sticky; top: 0; z-index: 20`. Sticky retains its flex slot, height and safe-area padding, and makes the opaque header recognizable as a top-edge bar after overlays disappear. Its nearest overflow container has no scroll range, so the existing absolute surface still owns all visual-viewport placement. Header stacking must stay above the composer because client participants are a fixed descendant of that header.

No viewport controller, document scroll reset, repaint timer, new DOM overlay, remount, request, media preload, subscription, API, reading policy, schema, or stored-data change is added. Work remains bounded to the already present visible header. Desktop/legacy conversations are outside the selector. The expected layout rectangles and all focus/draft/message owners are preserved. No production latency improvement is claimed.

## Validation and release

Completed checks:

- 1,423/1,423 application tests; production Webpack build with isolated placeholder configuration; foundation changed-file/lint checks.
- Full browser foundations: 32 engine/fixture runs, 550 assertions in Chromium/WebKit.
- Existing actual-component full-screen action checks: 40/40. Full-screen edge/keyboard checks: 24/24.
- Independent geometry comparison: 12/12 identical surface/header/message/composer rectangles, Team and Client at 390×844, 390×524, and 844×390 in both engines. Reduced motion isolates layout from in-flight compositor samples; the existing action/edge suites retain ordinary motion.
- Expanded popup suite: 58/58 in Chromium/WebKit at device scale 3, including three image-preview cycles for each close/Escape/backdrop path in Team and Client. Full-viewport comparisons preserve pixels; keyboard cases establish the same focus modality before/after. The original roster fixture remains unchanged, with media injected only for separate gallery cases.
- Roster hit coverage: 4/4. A client-roster control with sticky but no header elevation exposes the composer in both browsers; restoring the elevation restores full coverage.

The popup suite checks top-edge eligibility through real roster/profile, portal-action and image-preview cycles, with a static-header negative control; it does not simulate Apple's native pixels. Existing motion/geometry fixtures cover keyboard samples and retained editors. Physical iPhone Safari/Home Screen, physical Android, and authenticated isolated-workspace acceptance remain separate.

Application rollback is a revert of this correction; preserve all data, files, drafts, accepted writes and immutable migrations.
