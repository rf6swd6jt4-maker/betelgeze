# HighLevel sub-account selection correction

Base: `404f544ce668a4ad7884241e753a4097faec4805`.

## Observed failure

On 20 October 2026, production accepted an OAuth start and received a callback at 23:04 UTC. The saved attempt retained two installed-account choices. Two subsequent selection requests returned HTTP 400 before any selected location was retained. The user confirmed the error appeared after **Choose calendar**. HighLevel's authenticated Versions screen showed two installations.

The original handler discarded the underlying exception, so the old logs cannot establish the exact provider response. Later connection starts invalidated and cleared the earlier grant. Do not report a confirmed production root cause from the generic error alone.

## Correction and boundaries

The installed-account parser previously rejected the entire response if any row differed from the requested location, even when the requested, installed location was also present. It now validates the same bounded response and selects the exact matching ID locally. Missing, uninstalled, malformed and duplicate identities still fail closed. Account ownership, user/browser binding, revision fences and token-exchange leases remain in place.

Selection failures now identify saved-authorisation reading, installed-account verification, location-token exchange or calendar loading. Diagnostics contain only fixed stage/error labels and an optional HTTP status, with no credentials, provider bodies, URLs or client identifiers.

There are no additional requests, retries, timers, database queries or startup work. The response remains capped at 50 records; one bounded local lookup replaces the whole-list equality rejection. No schema, integration scopes, existing client connections or notification settings change.

## Validation and rollout

The new multi-account regression fails on the base and passes after the correction. It also checks that the lookup uses one request and rejects missing, uninstalled and duplicate selected identities. Session tests verify safe diagnostic output, preservation of the ready grant after a failed read, and invalidation after an uncertain location-token exchange.

Run the full repository release gate on the exact candidate before advancing main. Deployment status and HTTP smoke evidence belong to the release record. A fresh user-operated authorization and calendar selection are still required to establish live success; fixture success is not provider acceptance or WhatsApp delivery.

Rollback: restore the base application. There is no migration or data conversion to reverse. Preserve existing connections and installed GHL apps.
