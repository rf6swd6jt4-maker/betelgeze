# Google Ads: onboarding and client portal

## Available flow

The same `GoogleAdsConnection` component and server connection runner power both surfaces and both Google Ads service templates. Google Search Ads and Google Local Services Ads therefore require one relationship-level account connection, not two OAuth approvals. Existing inherited manager access is verified against the exact client account. Invitation retries reuse pending links. No ads, budgets or campaigns are modified.

When Google sign-in is configured, the connection opens directly to Google account selection. Selecting **Approve and connect** is the single explicit account-access confirmation. On completion, the popup notifies and closes itself; the originating portal or onboarding page also reconciles on focus or visibility return, so a successfully connected account does not depend on a manual status reload. If automatic acceptance is not permitted or has not propagated, the same UI retains the accurate manager-approval instructions and manual customer-ID fallback.

Onboarding keeps its active-session, block, consent and completion guards. The portal independently checks its active bearer session and relationship. Both use `relationship_google_ads_connections`, with one account per relationship and one relationship per account within a workspace. A portal-origin connection does not require or submit onboarding. Later onboarding can verify that same connection and satisfy its own requirement.

## Reports

The portal offers Last 7 days, Last 30 days and This month, including today in the account's timezone. The relationship's installed service revision determines which report is available. If both Google services are installed, the client switches between them with the shared service selector while keeping one account connection.

Google Search Ads reports only campaigns whose advertising channel is `SEARCH`. They show spend, clicks, impressions, Google Ads conversions and spend per conversion; a zero-conversion period displays a dash for cost per conversion. Fractional conversions are preserved.

Google Local Services Ads reports campaign spend for the `LOCAL_SERVICES` channel, including allowlisted Local Services Performance Max campaigns identified by `pmax_campaign_settings.local_services_enabled`, plus the dedicated `local_services_lead` resource. They show total leads, charged leads, calls, messages, bookings, leads marked booked, credited leads and spend per lead. The query deliberately excludes contact details, notes and conversation content. These fields and filters follow the Google Ads API v25 Local Services reporting reference.

Currency comes from the advertising account, not the workspace. No GHL appointment, revenue or lead-quality attribution is inferred.

Authorized GETs read saved snapshots only. The first connected visit loads only the selected service report, separately from the useful page content; subsequent updates are explicit. A Search refresh performs three bounded provider requests (authentication, account identity/settings and a date-filtered campaign query). A Local Services refresh performs authentication and identity checks followed by two concurrent bounded queries: channel-specific campaign metrics and lead metadata. Pagination or more than 1,000 rows fails visibly instead of returning partial totals. A relationship has at most three snapshots per installed report kind.

Operation leases, one-minute per-period-and-service cooldowns, exact account/manager identity and credential-version checks protect concurrent changes. Search and Local Services snapshots cannot overwrite one another. Cached values survive report failures with visible dates and error recovery. Results/Files switching retains the mounted component and loaded periods. No polling, report work or repeated shell bootstrap is added to navigation.

## Google setup and testing

The workspace manager uses its existing service account. The key's Cloud project must have production Google Ads API access, and the service account must have suitable access in the manager (Admin for requesting invitations). Developer tokens were sunset on 9 September 2026; new setup no longer asks for or sends one. Existing encrypted configurations remain readable.

Google sign-in is available when Production has `GOOGLE_ADS_OAUTH_CLIENT_ID` and `GOOGLE_ADS_OAUTH_CLIENT_SECRET`. Create a Web application client with the exact authorized redirect URI `https://app.betelgeze.com/api/google-ads/oauth/callback`. Its Cloud project must have Google Ads API enabled and approved access. Configure the OAuth audience and test users or publish/verify it as required by Google. Credentials stay in Vercel secrets.

The shared connection opens a separate Google sign-in window. A central start route sets a browser-bound, HttpOnly, Secure cookie before redirecting to Google; this supports custom portal/onboarding domains. Each relationship has one ten-minute attempt, hashed single-use state, PKCE and encrypted context. Every provider action rechecks source authorization and the manager/OAuth configuration version. The account picker uses Google's explicit direct-account and manager-hierarchy responses, with at most eight roots, two concurrent workers and 100 accounts. Missing/limited results offer the existing customer-ID fallback. Installing both service templates still exposes one Google Ads connection block in the onboarding builder.

After the client explicitly selects an account and consents to agency manager access, BE verifies that precise account through the client OAuth session, creates/reuses the agency invitation, attempts client-authorized acceptance, then verifies access through the agency service account. Insufficient approval permissions or propagation delays remain pending with manual approval instructions. OAuth consent alone never satisfies onboarding or enables reporting.

User OAuth access tokens are temporary and encrypted server-side, cleared on completion/failure. No refresh tokens are requested or retained. Expired attempts cannot be used; a bounded cleanup runs on new sign-in attempts (physical deletion is opportunistic, not an expiry-time scheduled job). Source bearer tokens and PKCE verifiers stay encrypted until replacement/cleanup. Routine reporting continues with the existing agency service account; no sign-in/discovery requests run on normal page navigation.

OAuth migration: `20260912100000_google_ads_oauth.sql`, service-only table and preparation RPC. Automated checks cover single-use transitions, expiry, browser mismatch, revoked source, credential rotation, explicit consent, wrong account, manager acceptance and pending approval fallback.

Use a BE TEST relationship and a real Google Ads account with historical activity to verify nonzero metrics. Google's dedicated test accounts cannot serve ads and cannot be linked beneath the production manager; this release intentionally rejects them. Validate onboarding → approved account → submitted onboarding → the same account and metrics in the portal. Separately test Bruce from his portal. Do not mark the Saturday outcome complete until real data has been verified.

## Validation and rollout

Base migration: `20260912090000_client_portal_google_ads.sql`. Split migration: `20260915090000_google_ads_service_reporting_split.sql`. The split adds the trusted Search and Local Services template IDs, separates snapshots by report kind and replaces account-wide historical snapshots that cannot truthfully be relabelled as Search. Existing `google-ads` relationship identities remain a Search compatibility fallback. The migrations were exercised with PGlite for permission denial, revocation, account collisions, leases/cooldowns, report-kind isolation, stale results, credential rotation, snapshot isolation and portal-to-onboarding reuse. Production migration application is verified separately from provider access.

Rollback: revert the application release; retain the additive schema and saved connections/reports. No production account invitations are created during automated validation. Browser fixtures use synthetic account/report data; physical-device and live Google account/report validation remain distinct.

Release checks on 12 September 2026: 939 tests passed, changed-file lint and the production build passed, and the migration returned both connection/report readiness checks as true in production. Browser fixtures verified pending approval, connected metrics, report errors, period switching and onboarding recognition; these are synthetic data checks, not proof of live Google access.


## Disconnecting

The portal's Disconnect button uses the browser/device confirmation dialog. It removes the relationship's BE account binding and saved reports, invalidates unfinished OAuth attempts, and clears Google Ads requirements in active onboarding sessions. Completed onboarding history remains. The agency's manager access in Google Ads is retained and the confirmation explicitly says so. No Google account, campaign, budget or provider permission is modified. A running connection/approval must finish before disconnection; stale report/connection completions cannot recreate the deleted binding. The operation is authenticated, relationship-scoped and idempotent. Migration: `20260912110000_google_ads_portal_disconnect.sql`.
