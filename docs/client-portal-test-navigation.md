> Historical TEST rollout record. On 12 September 2026, the user approved Results / Files / Chat and GHL connections for all relationships. The TEST gate and sample metrics UI are now removed; see `client-portal-ghl.md`.

# TEST client portal navigation

12 September 2026. Scope: top-bar Results / Files / Chat navigation for TEST relationships only.

## Behavior and isolation

- The existing authorized relationship read projects `source_metadata->is_test`; only the boolean `true` enables the layout. No URL or browser-storage override exists. Missing, false, or malformed values retain the existing portal layout.
- Results contains appointments and two static connection placeholders; Files contains the existing uploader and file history. Chat retains its existing side panel and returns to the selected page.
- Switching updates local React state and CSS visibility. Both panels stay mounted, preserving appointment period, scroll position, and queued/running uploads. No routing, remount, additional fetch, animation delay, or dependency is introduced.
- The server read adds one projected JSON boolean to the existing query; no extra request or schema change is needed.

## Verification

- Current-main isolated release: 893 tests passed, changed-file lint passed, production Webpack build passed. The initial sandbox build could not resolve Google Fonts; the network-enabled build passed.
- Rollout regression exercises the server page with true, false, absent, null, string, numeric, and object flags. Only boolean true enables the preview, even when the visitor supplies a preview query parameter.
- Production-built local fixture: Chromium and WebKit at 1440×900, 390×844, 320×568, and 844×390; 12 round trips per case. All eight cases passed.
- Switching made zero extra API requests. Appointment period and both scrollers survived switching. A mocked upload completed while Files was hidden, then appeared in Files. Chat opened and returned to Files. All top-bar buttons stayed inside the viewport with at least 44px height. No page errors occurred. Non-test desktop portals retained both columns; non-test portals had no Results navigation.
- Click-to-two-animation-frame observations averaged 20–34 ms per case, with a maximum observed sample of 132 ms. These small local fixture samples verify responsive switching, not production end-to-end latency or a platform-wide guarantee.
- Screenshots inspected for narrow Chromium and desktop WebKit. Browser/touch emulation is not physical Android, iPhone, Safari Home Screen, or keyboard verification.

## Release and rollback

Release only the portal shell, server TEST flag wiring, rollout regression, and related documentation. Preserve unrelated local changes. Bruce and other non-test relationships retain their existing UI.

Rollback by reverting this scoped change. No data migration, provider connection, or upload-data change is involved. Live deployment and TEST portal checks are reported separately after release.

## Connection placeholders — 12 September

GHL sits above Google Ads to the right of appointments on desktop. Below 1024px, the boxes follow appointments in a scrollable Results view. Both reuse `PortalSection` and have no buttons, provider requests, or connection behavior. The TEST gate remains unchanged.

Validation: 893 tests passed on the isolated release checkout, changed-file lint and production Webpack build passed. Chromium and WebKit checked 1440×900, 390×844, 320×568, 844×390, and 1440×390. All ten cases preserved box order and reachability, added no requests on page switching, and kept placeholders out of non-test portals. Desktop and phone screenshots were inspected. Physical-device checks remain unverified.
