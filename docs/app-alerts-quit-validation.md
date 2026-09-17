# Closed-app notification repair — 17 September 2026

Authorized: keep notifications while quitting; use the latest signed-in account per installation; explicit logout stops them. Protected contract: `app-alerts.md`.

## Diagnosis

The production sample contained 65 delivery records: 56 provider accepted, nine read-resolved, 33 display reports, no reported display failures; six subscriptions had no recorded provider failures. One sampled iPhone delivery reported display roughly 53 seconds after acceptance. These observations do not identify the device's foreground state or prove visible receipt. No production test messages were sent.

The payload's relative icon (`/icons/...`) is rejected by WebKit's declarative JSON parser, which requires an absolute URL. `mutable: true` additionally requests JavaScript processing even though all display content is already prepared server-side. Fix: absolute URLs and immutable declarative display. See [WebKit parser](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/notifications/NotificationJSONParser.cpp) and [Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/).

The old system also associated push with an explicitly enabled account rather than the most recent verified sign-in on that installation, coupled reconciliation to successful worker registration, and ignored logout revocation errors. Those paths are repaired in this pass.

## Behavior and cost

Modern Apple system display avoids starting application JavaScript. Other browsers retain the existing worker path, with no authenticated network request before display. The existing device-presence request performs indexed installation/session checks to transfer only already-enabled subscriptions; no additional request, foreground gate, polling or message-history read is introduced. New indexes cover device selection independently of account. No measured end-to-end speed claim is made.

Stored push is independent of HTTP token expiry. Device permission and explicit off remain authoritative. The production negative-origin check exposed a pre-existing central-auth redirect for `/logout`; proxy now keeps that exact route on its originating platform host, before refresh/MFA redirects. Logout must acknowledge server revocation before clearing the cookie. Provider-accepted messages can already be in transit at logout or account switching; they cannot be recalled. Notification navigation still goes through the application's usual authentication and conversation authorization.

## Validation

- Regression tests check absolute declarative URLs, immutable display, legacy worker display with no window/session, receipt failure independent of display, modern manager without a worker, legacy manager fallback, expired-login logout, failed revocation and same-origin mutation enforcement.
- Executable PostgreSQL fixtures exercise AAL2/session authorization, newest-account transfer, stale-account registration rejection, session expiry/deletion preserving push ownership, explicit off/logout remaining off and no reconciliation re-enrollment.
- Full suite: 1,171 passed. Scoped lint and production webpack build passed. Chromium and WebKit profile fixtures passed at 1280, 390 and 320 pixels, including off/on, failed saves and disabled remote toggles. WebKit uses a mocked declarative manager while worker lookup deliberately throws; Chromium exercises the legacy manager. These are UI/emulation checks, not push-provider or physical-device tests.
- Physical Mac quit, iPhone swipe-away/locked overnight and Android closure/Force stop are not equivalent to browser emulation. Physical-device receipt remains unverified. OS notification permissions, Focus, connectivity and forced-stop policies remain outside the server's control.
- Immutable system display produces no JavaScript receipt. Missing receipt is expected, not grounds for duplicate retries. Provider acceptance remains distinct from visible display.

## Rollout

Database first, application second. The migration was applied successfully in the signed-in Supabase SQL editor. All three production function body hashes match the reviewed migration; the account RPC retains authenticated access and registration/revocation remain service-role-only. Exact deployed SHA and Vercel state are checked separately. No subscription mass transfer occurs during migration; the next verified device observation adopts the latest account. An explicit logout still requires re-enabling notifications after the next login.
