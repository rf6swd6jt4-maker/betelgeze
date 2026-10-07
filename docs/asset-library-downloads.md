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


## Selection and download polish — 7 October 2026

Candidate base: `ffae9bb6` (the original selection/download implementation).
This pass covers selection and transfer feedback only. The access/sharing roadmap,
Library pagination and a persistent Downloads tab remain separate work.

The shared gallery now keeps the preview and metadata in a stable card container.
Selection changes only sibling action/checkbox controls. The Library offers Select
all visible, Clear selection, selected bytes, unknown-size labels and a visible
explanation for records without downloadable files. More than 24 selected files
or a known ZIP total above 500 MiB is blocked locally; a large individual original
still uses its existing direct download. Removed or unavailable IDs are pruned
from selection rather than silently reappearing checked after a later snapshot.

Ordinary Download preserves the native anchor, exact route and direct-storage/ZIP
path. It makes no preparatory API request and reports only Download requested.
Requested IDs are cleared, with a bounded Select again action that requires the
entire original set to remain present and downloadable. Context-download of one
file retains other choices. A synchronous request identity prevents duplicate
activation without a timer. Failure after browser handoff remains browser-owned;
local feedback cannot establish that bytes reached disk.

For two or more selected files on a browser with `showSaveFilePicker`, Save ZIP as
invokes the native location picker directly in the user gesture. After selection,
it loads `lib/assets/save-archive.ts` on demand, opens a writable, and requests the
existing authorized archive once with redirects rejected. The response must be a
ZIP. `pipeTo` preserves backpressure, cancellation and bounded memory, and success
waits for destination close. Errors and picker dismissal preserve current choices;
there is no automatic fallback download or retry. Unmount aborts the attempt and
late picker results cannot start a transfer; resident-tab hiding can leave an
explicitly requested save running without background polling. There are no
per-chunk React updates, stored file bytes, durable jobs or new persistence.

Single-file location selection remains with the browser. Existing private objects
redirect to storage, whose configured platform CORS rule only establishes PUT;
GET support is not assumed. This pass adds neither a single-file proxy hop nor a
storage configuration mutation. Android/Chrome and iPhone/Safari/PWA native save
flows require physical-device verification; browser capability is detected rather
than inferred from a user agent.

### Speed and validation evidence

The affected owners are `AssetLibrary`, shared `AssetGalleryCard`, and the optional
client-only ZIP writer. List/detail reads, authorization, signing, original and
archive routes, schema, subscriptions, caches, app launch and shell ownership are
unchanged. `app_speed.md` is unchanged and no exception is requested.

- Full `npm test`: 1,498 passing, zero failures. The 19 new streaming-save tests
  cover exact bytes without whole-response buffering, destination-close success
  and failure, denied/late writable handles, HTTP/content/redirect errors,
  interrupted streams, explicit abort and blocked-writer backpressure.
- Production `next build --webpack`: passed for both the exact baseline and the
  reviewed candidate with identical installed dependencies and placeholder
  Supabase settings; no production credentials were copied.
- Resident departure and draft browser regressions: 34 + 25 + 25 per engine,
  168 passing across Chromium and WebKit.
- Independent source review resolved stale selection after access loss and the
  native duplicate-request latch blocking a different remaining selection.

- Asset browser fixture: all eight native-download/save-picker combinations passed
  in Chromium and WebKit, each at 1280x844 desktop and 390x844 touch/mobile.
  Native paths generated five attachment events and exactly five server-counted
  transfers per cohort. Picker tests use a mock OS picker with real browser
  streams; they do not verify an actual operating-system save dialog.
- Coverage includes preview identity, local select-all/clear and size/count limits,
  keyboard/touch, request feedback and recovery, duplicate suppression, retained
  remaining selections, source/destination errors, close-before-success, late
  cancellation, committed access loss while the picker is open, and newer choices
  made during a previous transfer. Desktop and mobile screenshots were inspected.
- Foundation changed-file lint and `git diff --check` pass. No schema or protected
  alert behaviour changed.

Reproduce the matched component observations with
`ASSET_LIBRARY_BASELINE_REF=ffae9bb607f5048d8a1cfa1b81e40da389841c01 node scripts/browser/run-asset-library.mjs --measure-selection`.
Each cohort uses production React, 24 synthetic cards, three warmups, and 30
observations per action, alternating baseline/candidate order. The boundary
includes rendered control state and decoded preview at the following paint;
frame scheduling dominates these local measurements. Median/p95 milliseconds:

| Cohort | Enter baseline → candidate | Toggle baseline → candidate | Exit baseline → candidate |
| --- | --- | --- | --- |
| Chromium desktop | 31.8/32.5 → 32.6/33.7 | 31.5/31.7 → 31.6/33.3 | 31.3/31.7 → 31.4/33.5 |
| Chromium mobile | 32.3/33.8 → 32.6/33.6 | 31.7/32.3 → 31.5/32.3 | 31.0/33.7 → 31.5/32.2 |
| WebKit desktop | 63/65 → 63/65 | 62/65 → 63/64 | 60.5/63 → 61/63 |
| WebKit mobile | 61/63 → 61/64 | 62/65 → 62/64 | 59/62 → 59.5/62 |

Observed ranges overlap. Some candidate medians/tails are higher, so these
frame-based samples do not establish a universal zero-cost or speed-improvement
claim. All cohorts make zero API requests during selection. Baseline image DOM
replacement occurs 66 times across warmup/measured enter/exit loops; candidate
replacement is zero. Both variants make one thumbnail request through browser
resource reuse: this proves preserved DOM, not a measured network reduction.
Raw samples, counters and screenshots live in `browser-results/asset-library/`.

Matched production JS sets, each unique file compressed at gzip level 9:

| Set | Baseline chunks / gzip bytes | Candidate chunks / gzip bytes |
| --- | --- | --- |
| Assets route, root/layout and client boundary | 19 / 294,179 | 19 / 295,260 |
| Communications route control, root/layout and client boundary | 18 / 294,040 | 18 / 293,610 |
| Deferred resident Library module and declared dependencies | 6 / 26,433 | 6 / 27,947 |
| Optional save helper, only on explicit save | absent | 1 / 664 |

The Assets route adds 1,081 gzip bytes and the resident Library set adds 1,514;
these are overlapping sets, not additive totals. Ordinary paths add no chunk
request. The Communications control's raw size changes by 173 bytes while gzip
shrinks by 430; generated chunk references/compression differ, so this is not a
claim of faster Communications. Bundle comparison excludes CSS, media, transfer
headers, hydration, authentication and network latency. Build logs and comparison
script/report are preserved at `/private/tmp/asset-polish-{baseline-build,build-final}.log`
and `/private/tmp/asset-polish-bundles.{cjs,json}`.

Fixture evidence is distinct from production latency, authenticated production
downloads and physical-device acceptance. No deployment or production data
mutation is part of this implementation pass.
