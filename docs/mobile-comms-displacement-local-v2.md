# Full-screen Comms displacement: local revision 2

Scope: local candidate only, 24 September 2026. No production deployment, messages, data changes or alert-policy changes.

## Recording evidence

Source: `ScreenRecording_09-24-2026 10-06-04_1.MP4` (12.035 seconds). Local AVFoundation extraction used exact requested timestamps, first at one-second intervals and then at 100 ms intervals for the first keyboard cycle. Contact sheets are in `/private/tmp/mobile-comms-displacement/`.

| Recording time | Visible behavior |
| --- | --- |
| 1.4–1.9 s | Alex Morgan conversation is correctly positioned; keyboard closed. |
| 2.0 s | Keyboard begins opening; conversation header drops far below the browser bar, leaving a large empty region above it. |
| 2.1 s | Header is moving back toward its resting position. |
| 2.2–2.8 s | Header and composer have reached their keyboard-open positions. |
| 2.9–3.0 s | Dismissal displaces the conversation again; at 3.0 s the header is above the visible content area. |
| 3.1–3.3 s | Header returns and layout settles. |
| 6–8 s | A second keyboard cycle in Project team also moves the conversation during the transition. |
| 10–12 s | Another conversation and keyboard cycle show that settled endpoints alone are insufficient evidence. |

This is a displacement of the conversation frame, including its header, rather than only message-list anchoring. The underlying workspace shell is already hidden. Removing the visible shell did not remove the frame's dependence on native fixed-position movement. The recording does not expose JavaScript viewport values or establish one exact internal WebKit bug.

## History and mechanism

Git shows opposing earlier strategies: `0d82817bc041` removed relative viewport-origin compensation; `a5750711e728` restored it and `2cf9e7e5a43` made updates synchronous. `9cfdfc94524d` stopped resetting the document during active keyboard movement. `04546afdc4c8` introduced measured-header correction; `93e7bcca7044` adjusted its ordering. The resident mobile rebuild at `fa7c677c8de4` replaced that correction with `visualViewport.offsetTop` and `height`.

The first full-screen candidate kept that last calculation on a `position:fixed` surface. Its body override also retained inherited full-height clipping. This was a new navigation structure, but did not replace the keyboard coordinate model.

The earlier physical origin-zero experiment displaced the header to −396 CSS pixels; restoring zero origin is therefore not an acceptable repair. The prior absolute-frame experiment had correct sampled endpoints but inconclusive visual acceptance; it is not evidence of a previously complete fix.

## Revision 2

- One absolute conversation frame is positioned in document coordinates: `top = visualViewport.pageTop`, `height = visualViewport.height`. The header, message pane and composer remain in the same flex layout.
- The body is static, has automatic height and does not clip that frame while a conversation owns the screen. The scoped rule also overrides the shell's inline overflow lock. The underlying list, shell and drafts stay mounted.
- The owner listens to document scroll as well as visual-viewport resize/scroll/scroll-end. A document pan can change `pageTop` without changing `offsetTop` or producing a visual-viewport scroll event.
- `scrollY` and `offsetTop` are never added to `pageTop`. Invalid or zoomed samples retain the last valid layout. Without VisualViewport, window scroll position and height are the fallback.
- Layout updates remain immediate with at most one event-triggered next-frame reread. No keyboard-height prediction, active scroll reset, accumulating header correction or production polling loop is introduced.
- Moving a retained editor across the desktop/mobile breakpoint now releases the former composer-height and chat-motion owners. The mobile frame uses normal flex sizing; desktop/legacy ownership resumes when appropriate.

The coordinate distinction follows the [CSSOM View definition](https://drafts.csswg.org/cssom-view/#the-visualviewport-interface) and [WebKit's VisualViewport implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/VisualViewport.cpp). WebKit also tracks [inconsistent keyboard viewport reporting](https://bugs.webkit.org/show_bug.cgi?id=237851) and [visual-viewport scroll event timing](https://bugs.webkit.org/show_bug.cgi?id=218465). Those reports are supporting context, not proof of the exact defect in this recording.

## Local diagnostic evidence

The preview label is `Local v2`. A preview-only recorder captures bounded numeric viewport and element geometry around keyboard events and sends it solely to this Mac's local preview server. It does not record text, conversation identifiers, account details, credentials, URLs or user-agent strings. It changes no production component or message policy. Physical paint remains separate from DOM measurements.

The phone URL remains `http://192.168.0.108:3107/`; a reload is required to receive the new bundle. Use the same Wi-Fi network and keep the Mac awake. Synthetic sends remain local. This HTTP browser preview is not an installed-PWA parity test.

## Verification boundary

The new document-pan regression failed against revision 1 (origin remained 0 instead of 396) and passes against revision 2. Fourteen viewport/ownership unit cases cover independent document/visual offsets, delayed metrics, repeated keyboard cycles, invalid samples, background cancellation, fallback and teardown.

The full application suite passed 1,318 tests. Changed-file foundation lint and `git diff --check` passed. The production webpack build passed with placeholder environment values; `/private/tmp/betelgeze-displacement-build.log` records the build. The phone URL responded HTTP 200 after the server was restarted with the current bundle.

Manual browser checks used the actual preview at 390×844 and 390×416. With a six-line draft at the short height, the header remained at 0–56, the composer bottom was 416 and the editor height was bounded to 116 CSS pixels. The body computed to static/visible and the surface to absolute; no composer inline height remained. Switching to 1280×900 released full-screen ownership; switching back retained the draft, restored header top 0/composer bottom 844 and removed the old inline slot height. These are rendered desktop-browser checks, not a hardware keyboard simulation.

The final foundation browser run passed **160/160 cases in Chromium and 160/160 in WebKit**, with no unexpected network or page errors. This includes 12 new cases using the actual conversation surface/footer/motion components and application CSS: document-coordinate pan, body clipping, retained list/editor, keyboard-close handoff, breakpoint ownership, deactivation and invalid sample recovery. The fixture supplies viewport metrics and an invisible scroll extent because a desktop browser does not open a hardware keyboard. Its deliberately mismatched fixed-position control is a coordinate comparison, not a replay of the phone compositor. The report is `browser-results/foundations.json`.

The initial fixture run exposed two fixture mistakes: a missing real document scroll extent when only viewport metrics were injected, and reading an unset inline top instead of the CSS custom property. Both were corrected while retaining the geometry assertions; no application assertion was weakened. The full pack then passed once in each engine.

Manual Client chat confirmation also retained header top 0 and composer bottom 844. Browser console errors/warnings were empty. The temporary viewport override was reset. The local preview server remains running on port 3107 with revision 2.

These checks cannot establish that an iPhone compositor animation is fixed. Physical iPhone and Android acceptance remains pending. The separate read-acknowledgement recheck risk from the initial local candidate remains unresolved; protected reading/activity code was not changed in this revision.
