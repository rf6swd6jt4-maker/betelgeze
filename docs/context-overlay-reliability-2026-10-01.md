# Relationship context and popup lifecycle — 1 October 2026

## Behavior and owners

`WorkspaceTopBarClient` remains the navigation owner. Context publishers now include their route; the shell rejects late context updates and cleanup from another route. The existing activation/probe handshake replays a legacy frame's context after canonical redirects. Asset and work-item detail routes retain their authorized context when their location acknowledgement arrives; the old allowlist incorrectly cleared it. Navigation to an unsupported page no longer overwrites the desktop open/closed preference. This changes local messages only, with no additional request or timer.

`ShellRelationshipContextPanel` presents identity and lifecycle, contact actions, services/team, notes and optional metadata. Permission-aware quick links sit in a compact two-column area outside the scrolling content, with the current destination identified. Client Connections uses the existing collection route with a selected-relationship filter; the former `client-connections/<id>` route did not exist. Filtering reuses the authorized list. Opening Add connection captures the current eligible selection; changing the query cannot silently retarget an existing form or choose an unrelated client.

Mobile uses the shared `SideDrawer` with a right-edge 200ms entrance, a stationary backdrop and visible dismissal gutter, native focus containment, immediate close/Escape/backdrop dismissal, and reduced-motion support. Opening explicitly focuses its trigger for Safari restoration. Desktop resizing, navigation and tab changes release the mobile drawer. Desktop retains its existing companion width and preference.

`CenteredDialog` and onboarding previews now share native modal lifetime handling that recognizes both native and legacy iframe tab activity. Inactive tabs release their top-layer overlay while preserving their mounted form/draft. Cleanup does not focus a hidden/inert frame or disconnected trigger. No body styles, scroll locks or extra viewport owner are introduced.

## Regression evidence

- 41 focused context, navigation, frame-recovery and shell-launch tests passed before integration.
- 40 actual-component/CSS browser checks passed: Chromium and WebKit at 390×844, 320×568 with reduced motion, and 1280×900. Cases cover right-edge geometry, motion policy, current/canonical links, close/Escape/backdrop, focus restoration, breakpoint change, owner unmount, native and iframe inactivity, retained drafts and selected-client changes. All requests were loopback synthetic data.
- The original `CenteredDialog` from base `36747562` fails the new iframe-deactivation check: its portalled modal stays open after the owning frame is hidden. The candidate passes.
- Existing UI reconciliation suite passed 28/28 checks, including immediate native dismissal before deferred parent cleanup and blocked busy-dialog dismissal.
- The panel matrix includes the actual framed opening wrapper: exactly one shared banner on eligible collection routes, none on Communications, Settings or record details.

Integration test/build and hosted evidence are recorded in `consolidation-validation-2026-10-01.md`.

## Limits and rollback

No schema, client/user data, stored file or alert policy changes. These are synthetic production-React/CSS checks, not a full authenticated shell session, production latency comparison or physical Android/iPhone test. They prove the specific repaired lifecycles, not that every possible popup is defect-free. Revert the application changes to roll back; no data conversion is required.
