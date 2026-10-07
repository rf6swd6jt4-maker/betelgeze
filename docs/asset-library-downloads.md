# Asset Library downloads

Implemented on 2026-10-07 from base `e4388405301eb73fa54eeeb6bab0c1dc805c005b`.

## Behavior and ownership

Both the standard Assets route and resident Library panel render `AssetLibrary`.
Right-click or Shift+F10 opens Select and Download through `AnchoredPopup`.
Select exposes native checkboxes at the top right of the existing shared gallery
cards. Card clicks toggle selection. Cancel clears it; New asset is replaced by
Download N assets. Records without a stored original cannot be downloaded.

The existing single-file route previously accepted only client-portal resources.
It now accepts authorized stored assets, retaining current session/MFA/capability
and actor-bound RLS checks. Message media and extracted SOP images continue through
their canonical authorization owners. Standard and resident detail links use the
same resolver and native download semantics, bypassing workspace navigation.

Multiple selections use one streamed, uncompressed ZIP with unique filenames.
One RLS query validates the complete selection before storage access. Limits are
24 files and 500 MiB per archive, with one source streamed at a time, backpressure,
a 240-second deadline, and cancellation. A single file uses its direct download
path. Known oversized selections explain that files can be downloaded individually.
Partial ZIP failures fail the stream rather than reporting a successful subset.
Canonical media header work may finish after cancellation; the archive wait ends
and any late response body is discarded without awaiting cloned-stream cancellation.

## Speed and preservation assessment

Listing and detail reads, preview limits, caches, navigation, and signing behavior
on entry remain with their existing owners. Selection and context actions use the
already loaded authorized entries; fixture interactions make zero API requests.
Originals and ZIP code load only on an explicit download. There is no new startup
read, background job, subscription, write, schema change, dependency, or media preload.
Unit fixtures verify at most one upstream archive source at a time and that cancelling
an active source does not start the next file. These are control-flow/resource
observations, not production latency or memory benchmarks.

Existing records, files, relationships, messages, accepted work, immutable migrations,
and protected alerts behavior are preserved. Rollback is application-only: revert
the scoped change while retaining all stored data.

## Validation

- `npm test`: 1,479 passing, zero failures.
- Production `next build --webpack`: passed with documented local placeholder configuration.
- Foundation change checks with changed-file lint and `git diff --check`: passed.
- Asset browser fixture: Chromium and WebKit, each at desktop 1280x844 and touch/mobile
  390x844. All four configurations passed real attachment events and single/ZIP byte
  checks, navigation, selection/count/cancel, checkbox placement, keyboard and context
  actions, unavailable files, size limits, and native/iframe popup cleanup.
- Workspace departure, drafts, and strict-mode drafts fixtures: 34+25+25 checks per
  engine; 168 passing across Chromium and WebKit.
- Independent code review: cancellation, Unicode filenames, authorization boundaries,
  selection markup, and popup/focus lifetime issues resolved.

Browser reports/screenshots are generated under `browser-results/asset-library/`;
workspace fixture reports are generated under `browser-results/`. Reproduce with
`node scripts/browser/run-asset-library.mjs` and
`node scripts/browser/run-foundations.mjs --fixture=departure --fixture=drafts --fixture=drafts-strict`
after installing the separate browser tooling per the reliability release gate.

At implementation handoff, this change was not deployed. Subsequent release evidence
is reported separately. Authenticated production downloads, sustained-session
performance, and physical Android/Chrome and iPhone/Safari/PWA checks remain unverified.
The asset browser fixture also runs in both hosted Foundations browser jobs.
