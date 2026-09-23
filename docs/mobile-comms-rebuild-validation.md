# Mobile Comms rebuild — release evidence

Date: 23 September 2026. Base: `93e7bcca704425839845e8471ad1e1b33c959aeb`.

The user authorized rebuilding and deploying the mobile experience for their phone test. The screen recording from the preceding release showed the workspace chrome displaced during keyboard transitions and the composer temporarily covered by the keyboard. This release replaces the mobile staff Comms host and geometry path. It does not establish physical-device acceptance.

## Candidate scope

- Select a same-document, resident Communications host before the mobile tab mounts. Preserve shell tab identity, drafts, loaded conversations, authorized bootstrap reads, departure checkpoints, link routing and readiness reporting. Desktop-opened Comms keeps its iframe renderer; the chosen renderer survives rotation.
- Use one visual-viewport owner for the workspace header, tab bar and remaining panel height. Remove the independent chat translation and animated footer sizing from this mobile path. Do not estimate the keyboard from focus or replay delayed geometry.
- Bound the rich editor and accessory area to the available conversation space. Long attachments/stickers/replies can scroll while the editor and Send remain reachable, including short landscape viewports.
- End obsolete gestures, media playback and portal menus when a mode or tab becomes inactive. Keep drafts and editor ownership. Send preserves existing editor focus and refuses submission during IME composition.
- Retain one Realtime transport per resident Comms tab, sharing the existing authentication owner. Preserve private topics and existing reconnect, read/unread, active-chat and notification policy.

No migrations, dependency changes, production data writes, provider messages, uploads or credential changes are included. All networked browser fixtures use synthetic loopback data.

## Local checks

The application code passed the full repository suite: **1,304 tests, zero failures**. The changed-file foundation gate, scoped ESLint, immutable migration-history check and whitespace check pass. Production webpack compilation passes with local placeholder service values; it makes no claim about production credentials or authenticated APIs.

Commands:

```sh
npm test
node scripts/check-foundation-changes.mjs --base 93e7bcca --lint
npx next build --webpack
npm ci --prefix scripts/browser --ignore-scripts
node scripts/browser/run-foundations.mjs
```

## Browser acceptance evidence

- Mobile geometry/interaction fixtures pass **18 cases per engine** in Chromium and WebKit: 17 portrait cases and one actual `844 × 390` landscape viewport. Each engine records 402 geometry samples. Cases include nonzero visual-viewport origins, interrupted/reversed keyboard geometry, latest/history anchors, native scrolling ownership, long draft selection and undo, attachments, menus, media growth, hidden owners and IME-safe Send.
- The short `320px` usable viewport case exposed a **73px clipped Send button** before the footer bound was added. The corrected candidate keeps the editor and Send hit-testable at the keyboard edge while the accessory area scrolls.
- With 60 and 300 synthetic message rows, 60 continuous geometry updates produce zero React chat renders, zero editor replacements and zero draft loss. Observed synchronous owner p95 values were Chromium `0.5/0.6ms` and WebKit `1/2ms`. These small local samples describe the geometry helper only; they are not end-to-end phone latency or production benchmarks.
- The actual native host/panel fixture passes six cases per engine: resident retention and local selections, hidden-tab isolation, delayed explicit navigation/readiness, stale-result rejection and workspace record-link routing. Child conversation workspaces and network boundaries are mocked; the composed mobile fixture separately exercises the real editor/layout helpers.
- Four additional cases per engine exercise the actual Communications runtime with mocked Supabase boundaries: shared transport inside a tab, separate transports across tabs with shared authentication and fresh token lookup, witnessed development StrictMode replay without destroying the retained transport, and one-time cleanup on real unmount. These establish owner lifecycle, not a live Realtime/provider connection.
- The actual reader/activity hooks pass all **eight configurations**: Chromium/WebKit × mobile/desktop × native/iframe host. Checks cover latest-visible reads, older-history unread retention, hidden tabs, overlay coverage and failed-read persistence followed by online retry. No protected read/alert policy was changed.

The full foundations runner passes **148 cases per engine (296 total)**, including the existing departure, draft recovery, legacy viewport, reduced-motion and desktop layout cases. Its machine-readable output is `browser-results/foundations.json`; focused reports are `browser-results/mobile-comms.json`, `browser-results/native-comms.json` and `/private/tmp/mobile-comms-alerts-results/browser-results.json` in the validation workspace. The runner rejects missing cases, page errors and unexpected non-loopback requests.

## Hosted release gate

Run Foundations against the exact candidate branch commit before advancing main. Require all hosted test/build/lint, Chromium, WebKit and isolated PostgreSQL jobs to pass. Advance main without force only after verifying its base has not moved. Record the exact commit, hosted run, terminal Vercel production status and read-only HTTP smoke separately in the release handoff. A compilation, CI pass or Ready deployment does not replace authenticated or device testing.

## Phone acceptance still required

Reload the app document to acquire the release. Use an isolated test conversation for sending or uploads.

1. Open/close the keyboard repeatedly, type immediately, reverse a close with another focus, use emoji/dictation, and rotate with the keyboard open.
2. Grow a draft past the visible limit; select, copy/paste and undo; add/cancel reply and attachment/sticker previews; verify Send stays visible and the keyboard stays open after sending.
3. Read older history while the keyboard moves, continue momentum scrolling, return to latest, and open/dismiss media and message menus.
4. Switch conversations, Clients/Team and workspace tabs; return to drafts; background/foreground and lock/unlock; check reconnection and offline retry.
5. Cover physical iPhone Safari/Home Screen and physical Android Chrome/installed mode equally. Repeat ordinary desktop workflows. Review a normal working day before claiming sustained-session stability.

Authenticated production flows, real provider delivery and physical-phone acceptance were not exercised by the synthetic suite. The user is performing the phone acceptance after deployment.

Rollback is application-only to a reviewed compatible revision; preserve all data, drafts, accepted/pending messages, storage and migration history. Returning to the base restores its known mobile keyboard defect as well.
