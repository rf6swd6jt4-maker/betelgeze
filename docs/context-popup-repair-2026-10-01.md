# Relationship context and popup follow-up

Base: `f45d82db112fe52b7c5c4f7aeb7b971fa0e9b553`. This follow-up addresses the reported roster-dismissal blur, mobile context geometry and onboarding quicklink timeout. It preserves client/user data, stored files, existing access checks, immutable migrations, and the protected speed/alert contracts.

## Findings and changes

- The sole-session onboarding redirect discarded `__betelgeze_tab`. The actual proxy then treated the redirected request as top-level navigation and served another workspace shell inside the iframe. The outer tab remained pending. The redirect now retains its frame identity and bounded source-route metadata. The committed bridge removes the metadata with history replacement, and the shell validates the source, destination, actual frame origin and tab identity before accepting the canonical URL. Existing probes can recover a missed commit acknowledgement; there is no repair reload, new timer or additional data read.
- The mobile relationship context previously used a body portal and `showModal()`, putting the backdrop above the app header. Its shared drawer now lives inside the shell below the header, shares the existing viewport measurements, and slides from the right in 200 ms. The header stays interactive; covered tab/panel wrappers become inert until close. Close, navigation, Escape and unmount synchronously release the drawer and inert state. Left and right navigation exclude each other. Standalone context retains native modal behavior and safe-area padding. Reduced motion disables the animation. Full-shell visual review also exposed native dialog autofocus horizontally scrolling its overflow-hidden wrapper during the slide (342 px in both engines, transiently clipping the WebKit surface to the left). The wrapper uses overflow clipping, which cannot become that scroll container; entry is checked throughout the animation as well as at its final position.
- The supplied roster screenshot matches `ClientChatParticipants`. Headless Chromium/WebKit did not reproduce residual pixels: repeated roster/profile dismissal removed the dialogs and restored identical chat-header pixels. However, already hidden shell headers retained `backdrop-filter: blur(8px)` over the same region. Their filters are now disabled while the conversation hides that chrome, then restored when the conversation closes. This removes the hidden compositor input; confirmation of the original device artifact remains outstanding.

## Validation scope

`run-workspace-linked-detail.mjs` bundles the actual shell, frame guard, bridge and relationship context, executes the actual onboarding redirect and proxy routing with synthetic authorized data, and blocks external traffic. The fixture selects the real framed shell path rather than the native data owner. The displayed detail body and Next client router adapter are fixture code; this is not authenticated production or a complete Next streaming browser session. Runtime tests separately execute the real page branch, request routing and authorization/error boundaries. Baseline inspection reproduced the nested-shell failure before the fix.

`run-context-overlays.mjs` exercises focused drawer geometry, shared viewport faults, nested modal Escape, focus restoration, dismissal before navigation and standalone modality in Chromium/WebKit. Its simplified header is supplemented by the actual shell in the linked-detail fixture. The old drawer baseline failed the below-header boundary.

`run-comms-roster-cleanup.mjs` uses actual Team/client roster and profile components on synthetic mobile conversations. It checks repeated close, Escape, backdrop and nested-profile cleanup, header pixels, overflow and hidden/visible chrome filters at device scale 3. It cannot establish physical-device compositor behavior.

The new browser runners are included in Foundations CI. Local validation completed:

- Full unit suite: 1,423 tests; scoped foundation lint, immutable migration and whitespace gates.
- Production Webpack compilation with local placeholder credentials.
- Foundations: 550 checks across Chromium/WebKit.
- Context overlays: 52 checks across mobile, narrow and desktop viewports.
- Actual roster/profile cleanup: 24 checks across Chromium/WebKit.
- Actual framed shell linked-detail flow: four engine/viewport cohorts; exactly two onboarding document requests each, dropped-ack recovery, usable detail action and retained warm-tab draft without a return request.
- Real-shell drawer timeline: no horizontal scroll throughout normal/reduced-motion entry; final surface x=48 and right=390 at a 390 px viewport. Header focus, covered-panel inert state and dismissal were checked in both engines.
- Existing Communications popup, action, gallery and safe-area browser suites passed.

These are synthetic local checks. Hosted CI and terminal production deployment are verified against the committed candidate separately.

## Performance and release boundaries

The onboarding path retains its one bounded authorized session-page lookup and the source request plus canonical redirect. The metadata is consumed locally without a second route read. Redirect recovery reuses the existing probe, and warm resident tabs retain their document and draft. Drawer state uses local DOM work on open/close; it adds no fetch, subscription, viewport observer or polling. Removing filters from hidden chrome adds no data work. No dependency, database schema, stored record or alert/read policy changes are included.

Synthetic browser timing is local evidence, not a production latency guarantee. Authenticated isolated-workspace testing, physical Android/Chrome and iPhone/Safari/PWA checks, and ordinary-day stability observation remain separate acceptance evidence. Application rollback to the base remains compatible without any data/configuration rollback.
