# Local focus correction from the physical-phone trace

Status: local candidate only; user reports no jumps in the physical v4 test. No deployment, data,
message-reading, activity or notification-policy change.

## Evidence

The preserved `phone-diagnostic-v3-baseline.json` capture in
`/private/tmp/mobile-comms-displacement/` contains 14.415 seconds, 787 frames and
three keyboard cycles. Focus occurs at 2662, 7243 and 12116 ms. The first viewport
resize follows at 2810, 7341 and 12210 ms; application layout commits follow
within 0–1 ms. Each opening jumps directly from height 666/origin 0 to height
346/origin 320. pageTop, offsetTop and window scrollY all report the same 320.

All 523 open-state frames retain header/surface y=0. Header height remains 56,
footer 83 and editor 44. Element identities change with chat navigation, not with
keyboard cycles. The app's settled geometry is consistent. The recording and
earlier physical observations still show a jump: native compositor motion is
not continuously exposed in these samples. Sampling cost is p95 1 ms/max 4 ms;
opening frame gaps reach 98–105 ms. These are diagnostic costs, not a product
performance benchmark. The capture includes no text input or noncollapsed
selection, so those paths are not physically verified by this trace.

## Change and rationale

`ChatComposerInput` previously focused on touch/pen pointerup with preventScroll,
before the browser finished native tap handling. In the visible full-screen
conversation only, pointer focus now belongs to the browser. A synchronous
focusin handler reasserts preventScroll on the already-active editor; click
covers native refocus without another focusin. Both paths preserve native
selection and leave the gesture uncancelled. Hidden/inert/disabled editors and
the desktop, legacy-frame and client-portal paths retain their previous scope.

The rationale is supported by current WebKit source: focusin follows the initial
focus notification; same-element refocus can update pending focus options before
the native input session consumes them. This is an inference about the phone's
failure mechanism, not proof of its exact WebKit build or compositor behavior.

- [Focus event ordering](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Document.cpp)
- [Pending focus options](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/WebProcess/WebPage/WebPage.cpp)
- [Deferred focus information](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/WebProcess/WebPage/ios/WebPageIOS.mm)
- [Native reveal guard](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm)

There is no new viewport owner, animation, polling, synthetic keyboard size,
blur/refocus cycle, selection replacement, hidden editor or document scroll
reset. Two listeners are installed per existing editor and released at disposal;
their work is bounded to focus/click and the ancestor lookup. No requests,
subscriptions, data fetching or editor remounts are added. The existing pageTop
fallback remains necessary for other legitimate browser pans.

## Local acceptance

The preview title and initial recorder control identify Local v4. Open
`http://192.168.0.108:3107/?v=4`, tap **Local v4 · Record test**, open/dismiss the
keyboard, then test long-press selection with the keyboard closed. Return to the
list and **Stop & save**. The recorder retains its 45-second cap and numerical,
content-free schema; the trace build is `comms-focus-v4`. The original capture
has been preserved separately so another capture cannot replace the baseline.

Physical iPhone Safari/Home Screen and Android Chrome/installed-mode acceptance
remain separate from the automated checks. Existing local-candidate read-hook
recheck concerns documented in the earlier validation remain outside this focus
patch; no protected hook was edited. Rollback removes this narrow helper and its
integration, preserving the full-screen prototype, drafts and all data.

## Validation completed

- Repository suite: 1,324/1,324 passed, including six new focus lifecycle cases.
- Foundation browser suite: 184/184 Chromium and 184/184 WebKit, no unexpected
  network/page errors. Eight new mounted-CodeMirror cases run under normal,
  reduced-motion and desktop configurations, preserving native DOM ranges,
  editor identity, content, undo/redo, inactive exclusions and legacy focus.
- Production `next build --webpack`: passed with synthetic environment values.
- Changed-file lint and `git diff --check`: passed.
- Actual preview rendered the Local v4 label and retained an editable draft.
  Its v4 diagnostic endpoint saved a 45-second desktop timeout capture (2,699
  frames, sampling p95 0.4 ms/max 1.7 ms). The in-app browser control intermittently
  timed out before dispatching later input/Back commands; those attempts do not
  establish successful manual navigation. The separate browser fixture covers
  navigation and both engines. The subsequent physical v4 test reported no jumps;
  its trace is preserved as `phone-focus-v4-accepted.json`. Smooth message/composer
  motion is the separate [Local v5 candidate](mobile-comms-motion-local-v5.md).

Evidence: `focus-v4-unit-final.log`, `focus-v4-build.log`, `focus-v4-lint.log` and
`focus-v4-browser.log` under `/private/tmp/mobile-comms-displacement/`, plus
`browser-results/foundations.json` in the isolated worktree. The running local
server has been rebuilt from the candidate; production remains unchanged.
