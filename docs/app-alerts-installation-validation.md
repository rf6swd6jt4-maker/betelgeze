# Installation-wide subscription and recent-visit ordering

The user corrected the product model: enroll the Betelgeze installation once, display that same setting in every account's device history, deliver to its latest signed-in account, pause on logout, and show the two most recently visited devices first. No card-layout redesign is included.

## Diagnosis and scope

A bounded production audit found 76 delivery records (63 accepted, 13 read-resolved), no pending/failed jobs in that sample and five subscriptions with zero recorded provider failures. The reported recipient account had no saved subscription at audit time, despite older accepted deliveries. This confirms an enrollment gap; without the exact failed-message time it does not prove the complete cause of that reported missed banner. No production test messages were sent.

The prior implementation deleted enrollment and its installation cookie on logout, filtered subscription state by recipient account, ordered cards by session creation, and throttled visit recording for five minutes. Repairs address those shared mechanisms for all supported platforms. Existing server-side capture/retry/read suppression and Chromium-worker/Apple-declarative display paths remain.

## Verification

Executable SQL fixtures cover consent across accounts, pause/resume without re-enrollment, session expiry/deletion, stale sessions, A-B-A job revocation and late-enqueue binding-version rejection, global off, unknown legacy enrollment recovery, an off/recovery race, provider-expired transport repair and last-visit ordering. Runtime tests cover browser manager choices, denied permission, missing transport, unknown legacy consent, successful/failed repair publication, logout cookie preservation, host routing and foreground-event coalescing.

The status API returns consent plus transport metadata in one indexed RPC; capability keys stay on the server and only the fingerprint reaches the browser. Foreground observations and reconciliation stay outside launch/useful-content rendering. There is one observation/reconciliation in flight with coalesced follow-up; no polling or message-history request is added. Actual visits can now generate a small indexed write when the old five-minute throttle would have skipped them. No end-to-end speed claim is made.

Validation passed: all 1,176 tests, scoped ESLint, both executable SQL validators, the production webpack build, and Chromium/WebKit fixtures at 1,280, 390 and 320 pixels. Deployment evidence is recorded in the release handoff. Physical iPhone, Android and Mac closed-app receipt remains unverified; provider acceptance and synthetic browser tests are not proof of visible OS delivery. Missing display receipts are expected for immutable declarative system display.

## Release and rollback

The migration was applied atomically in production before application deployment. All eight normalized function hashes matched the reviewed source; grants, installation-table RLS, nullable recipient, account-deletion detachment and both binding-version columns were verified. The migration preserves existing transport IDs and enabled consent, and makes the delivery recipient nullable. Existing pending jobs remain valid until an explicit pause or recipient switch; those transitions permanently revoke obsolete queued jobs. Each job captures the subscription binding version in its insert transaction; the final dispatch check rejects any older version, including a late insert that escaped the cleanup snapshot. Enqueue, claim, preparation and binding changes must be applied atomically. Provider-accepted messages cannot be recalled. SQL functions and privacy grants must be checked against the reviewed source.

Do not roll back to a logout handler that deletes device enrollment. Keep the new pause helper and persistent cookie, installation consent, and nullable routing. A rollback of only the visit ordering or repair event wiring can be isolated without undoing consent. The old registration signature is replaced with an additional defaulted recovery flag; old seven-argument callers remain compatible.
