# Interrupted panel loading and startup branding — 15 September 2026

## Evidence and cause

The supplied iPhone screenshots show Work Queue in the persistent tab bar while the frame briefly displays BGE-UNEXPECTED, then a banner placeholder, a one-line queue fallback and the BE diamond. A bounded read of production maintenance diagnostics found four error-boundary occurrences; the latest was at 06:26:33 UTC on 15 September, matching the screenshot's 07:26 Irish time. It recorded Safari's `Load failed` on the Appointment Setting frame while the user was returning to Work Queue. No production records were modified by that diagnostic read.

Two control-flow bugs fit that interrupted navigation:

1. The shell cleared `readyTabIdsRef` when issuing a soft navigation. A second click during that transition treated the missing readiness as a missing message receiver and called frame `location.assign/replace`, interrupting the streamed App Router transition and reloading the document.
2. The frame receiver skipped a requested URL when it matched the still-committed address. A -> B (pending) -> A therefore did not reliably cancel B. Asynchronous draft flushes also lacked a generation fence on this legacy path.

The root layout independently painted the BE diamond into **every** document's HTML/body background. Removing the explicit startup component alone could not remove that background. Work Queue supplied only a paragraph as its route fallback, leaving the diamond canvas visible beneath it; shell opening also fell through to a generic record skeleton. SOPs had a catalogue fallback but no corresponding shell variant.

These are source-backed mechanisms and a matching production symptom, not proof that all historic loading failures have one cause.

## Comparison with the original speed baseline

`app_speed.md` establishes the September 11 PR #37–#44 performance work as the starting standard. Its pilot report records 11 warm native Relationships/Work Items navigations at 33–78 ms and three resident tab switches at 101–110 ms, on one Mac/account/network. Two network-backed reads took 3,164 and 3,353 ms. These were limited observations, not universal p95 guarantees.

The current source still keeps the persistent shell, a bounded set of resident frames, and gated native panels with an account/workspace cache. Native routes and user rollout gates are not universal; Communications, SOPs and other compatible routes still use frames. The supplied error explicitly came from the frame path, so comparing it directly with those warm native timings would be misleading. The defective interrupted-frame path can discard router residency and repeat document initialization even though the shell remains visible. It violates the intended reuse standard.

Historical source confirms that the readiness/transport conflation existed in the September 11 implementation. Recent queue/SOP additions exposed further gaps: missing shell registration (fixed in `127352be`) and incomplete loading coverage. The blanket inline diamond background was added by `a8f4146f` on September 11. There is no measured platform-wide regression percentage or evidence here that a database migration is causing these screenshots.

## Patch and resource assessment

- Keep frame navigation in the existing root `WorkspaceTabFrameGuard`, outside page loading/error boundaries. The host checks the live document receiver separately from destination readiness.
- Route frame links and host navigation through one owner. Newest intent wins after draft persistence; returning to a committed URL cancels an in-flight different URL through the router. Repeated pending clicks coalesce. Failed draft persistence stops navigation.
- Preserve commit/location matching and explicit retry. Re-probe the retained bridge after a same-URL cancellation completes, so it can acknowledge without requiring a remount. No timer reload or repeated fetch is added.
- Share panel-specific Work Queue and SOP skeletons across route and shell fallbacks. Cover a pending frame with the requested panel skeleton; keep the frame mounted underneath. All registered shell navigation panels are checked for a specific fallback.
- Scope the early inline startup canvas to top-level BE app launch. A document-local marker permanently retires it once real, non-hidden content appears. Embedded and public pages cannot opt into it. Public portal branding remains token-scoped; public onboarding gains an agency-logo fallback using its existing authorized logo endpoint.

The receiver and latest-intent fence are constant-size client state. No panel read, auth/bootstrap request, prefetch, cache eviction, poll or timeout budget is added. The launch-only observer disconnects when visible content appears; it does not run throughout app use. Native snapshot/draft/account isolation is unchanged. The onboarding logo request runs only while its branded fallback is mounted and does not gate form rendering.

## Verification

Regression tests execute the production host callback with a live receiver and pending readiness, and exercise A -> B -> A, reversed draft-flush completion, duplicate clicks, failed draft persistence/retry, and receiver disposal. They assert zero hard document navigations for the rapid-switch case. Startup bootstrap tests cover app launch, marked/unmarked frames, public/custom-domain token routes, and hidden streamed content. Server-rendered skeleton tests verify Work Queue/SOP structure and the first onboarding agency-logo request.

The full suite, lint, production build and authenticated post-deployment checks are recorded with the release outcome. Physical iPhone/PWA behavior and matched historical performance measurements must be reported separately; screenshots, static markup, HTTP 200 and passing tests cannot establish those results.

Rollback is a code revert. No migration, database mutation, feature-flag widening or provider change is required.
