# Google Ads: onboarding and client portal

## Available flow

The same `GoogleAdsConnection` component and server connection runner power both surfaces. Enter an individual advertising account's customer ID, consent to agency manager access, approve the invitation in Google Ads → Admin → Access and security → Managers, then check the connection. Existing inherited manager access is verified against the exact client account. Invitation retries reuse pending links. No ads, budgets or campaigns are modified.

Onboarding keeps its active-session, block, consent and completion guards. The portal independently checks its active bearer session and relationship. Both use `relationship_google_ads_connections`, with one account per relationship and one relationship per account within a workspace. A portal-origin connection does not require or submit onboarding. Later onboarding can verify that same connection and satisfy its own requirement.

## Reports

The portal offers Last 7 days, Last 30 days and This month, including today in the account's timezone. It shows spend, clicks, impressions, Google Ads conversions and spend per conversion; a zero-conversion period displays a dash for cost per conversion. Fractional conversions are preserved. Currency comes from the advertising account, not the workspace. These are whole-account totals, including any campaigns managed by others. No GHL appointment or revenue attribution is inferred.

Authorized GETs read saved snapshots only. The first connected visit loads a report separately, without blocking the page; subsequent updates are explicit. Each report performs three bounded provider requests (authentication, account identity/settings, one date-filtered account aggregate). A relationship has at most three report records. Operation leases, one-minute per-period cooldowns, exact account/manager identity and credential-version checks protect concurrent changes. Cached values survive report failures with visible dates and error recovery. Results/Files switching retains the mounted component and loaded periods. No polling, report work or repeated shell bootstrap is added to navigation.

## Google setup and testing

The workspace manager uses its existing service account. The key's Cloud project must have production Google Ads API access, and the service account must have suitable access in the manager (Admin for requesting invitations). Developer tokens were sunset on 9 September 2026; new setup no longer asks for or sends one. Existing encrypted configurations remain readable.

User confirmed no OAuth web client exists yet. Google sign-in/account selection is **not implemented** in this release. To add it, create/configure a web application OAuth client in the approved Cloud project, implement a fixed callback with single-use state and browser binding, then verify consent/account selection and client-authorized manager acceptance. OAuth consent itself does not grant agency manager access. Keep secrets in the deployment's secure configuration, never in chat or browser-visible responses.

Use a BE TEST relationship and a real Google Ads account with historical activity to verify nonzero metrics. Google's dedicated test accounts cannot serve ads and cannot be linked beneath the production manager; this release intentionally rejects them. Validate onboarding → approved account → submitted onboarding → the same account and metrics in the portal. Separately test Bruce from his portal. Do not mark the Saturday outcome complete until real data has been verified.

## Validation and rollout

Migration: `20260912090000_client_portal_google_ads.sql`. Additive report table and portal functions; onboarding foreign keys become nullable for portal-origin connections. Existing onboarding functions remain compatible. Migration was exercised with PGlite for permission denial, revocation, account collisions, lease/cooldown, stale results, credential rotation, snapshot isolation and portal-to-onboarding reuse. Production migration application is verified separately from provider access.

Rollback: revert the application release; retain the additive schema and saved connections/reports. No production account invitations are created during automated validation. Browser fixtures use synthetic account/report data; physical-device and live Google account/report validation remain distinct.

Release checks on 12 September 2026: 939 tests passed, changed-file lint and the production build passed, and the migration returned both connection/report readiness checks as true in production. Browser fixtures verified pending approval, connected metrics, report errors, period switching and onboarding recognition; these are synthetic data checks, not proof of live Google access.
