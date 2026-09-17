# Chat latency pass — 17 September 2026

## Scope and baseline

User-authorized follow-up to the working alert contract and profile release at `d84f78922c7665c50a7a4167e0a52db37d9187de`. Work remains isolated in `/private/tmp/be-app-alerts`; unrelated primary-checkout changes are preserved.

The production metadata inspected before this pass contained four device deliveries from two post-release messages. Three deliveries from one message reached recorded provider acceptance at 9.219, 9.299 and 9.269 seconds; another reached it at 2.297 seconds. Three display reports followed acceptance by 0.135–0.332 seconds. These are tiny observational samples, beginning at database message creation, excluding pre-save work and external inbound provider transit. A service-worker display report does not prove a physical banner. They do not establish a percentile or identify which server stage caused the delay.

## Changes and resource evidence

| Path | Previous | This pass |
| --- | --- | --- |
| First unread event | 250 ms before fetching | Fetch immediately; one in-flight request, coalesced invalidations |
| Chat API authorization | Full service-capability loader after verified workspace access | Verified workspace access and Communications panel gate, no service configuration |
| Read save | Separate conversation access RPC followed by the atomic RPC repeating that check | Atomic RPC retains its complete permission/message validation |
| Exact native message | Decoder RPC, then edit metadata query | One authorized detail RPC |
| Exact client message | Decoder RPC, then delivery metadata query | One authorized detail RPC |
| Normal native push context | Four parallel requests; team name adds a dependent request | One context RPC, same current recipient gate |
| Per-device push preparation | Initial eligibility, subscription lookup, final eligibility | Combined initial eligibility/subscription, then original final eligibility |
| Security | Up to 100 mounted device cards, sorted by activity/current status | Two latest sign-ins rendered initially; explicit expansion, inventory still bounded to 100 |

The sender still confirms its encrypted saved message before the response; `after` runs the push callback after that response. This pass reduces that confirmation work rather than creating a second dispatch owner. The serial read queue, eight-device push batches and existing recovery intervals are unchanged.

Lookups introduced by the wrappers are exact primary-key message joins. Client delivery metadata uses the existing unique `(client_message_id, provider)` index (at most the existing providers for one message). Recipients use existing conversation/team/workspace membership indexes. No history scan or additional body decryption is introduced. Device grouping operates on the user's retained Auth sessions via the existing user index.

## Instrumentation

The shared performance contract adds fixed message receive/read/unread/push/context/claim commands and access/save/push stages. Request logs and `Server-Timing` use cumulative milliseconds from handler entry. The separate push context/claim/per-device samples cannot be summed across different requests as a correlated trace. Provider `external_completed` means the push provider accepted the request; `server_ack` is recorded after persisting that outcome. Deferred/read/revoked jobs have no external-completion mark.

Browser read samples end after cursor validation; unread-fetch samples end after response validation and precede React paint. They are batched using the existing 100-sample buffer/20-sample uploads. Server logs add no database writes and contain no business identifiers or payloads. Message insert-to-event transport, displayed unread paint and sender seen-tick paint are not independently instrumented in this pass; authenticated browser measurements are needed for those boundaries.

## Validation

- Changed-file ESLint (including new server helpers/tests) and `git diff --check`: passed.
- Repository suite: **1,167 passed, zero failed**. New tests cover leading unread refresh, a 50-event burst, stale/superseded failures, disposal, the focused access guard and concurrent content-free timing isolation.
- Push SQL: existing atomic capture, read/suppression, leases, retries, revoked membership, device fan-out, stable subscriptions and scheduler contracts pass with the new preparation/context functions. Service-role-only capability access, incorrect leases and exact-message context scoping pass.
- Real encrypted-decoder SQL fixture: correct bodies/quotes/edit/delivery metadata, corrupt ciphertext, wrong workspace, removed participants, cleared history, AAL1/anonymous/non-member denial and indexed lookup pass. The fixture has 6,000 messages per kind; its pre-existing inbox benchmark is not an old/new measurement of this pass.
- Device SQL: verified sessions, MFA, revocation, expiry, account isolation, installation deduplication and sign-in ordering independent of activity pass.
- Chromium and WebKit profile fixtures at 1280, 390 and 320 px: two initial cards, expansion/collapse, remote-disabled switches, current-device save/failure recovery, centered icons, card proportions and no horizontal overflow pass.
- Chromium and WebKit reading fixtures at desktop 1280 and mobile 390 px: active newest row, hidden/obscured/scrolled-away states, read failure/recovery and departure signaling pass.
- Production Webpack build (including TypeScript) passes using the existing project environment. Build-only Google Font fetches required network access. No dependencies or lockfiles changed.

SQL/browser fixtures use synthetic records and intercepted delivery requests. No real messages were sent. Browser fixtures are development-mode behavior checks, not production latency benchmarks. Physical Android/iPhone delivery and matched authenticated old/new production timings remain unmeasured; only the removed 250 ms scheduling wait and request-count reductions are established here.

## Release

Both migrations applied to production through the existing signed-in Supabase SQL editor before application rollout. Normalized function-body hashes match the local tested definitions:

| Function | Hash |
| --- | --- |
| communication_native_message_detail | f7d940ce5caf192e67393c1adddf6f07 |
| communication_client_message_detail | 426f82e4583061c6302f452e5d2ba6a3 |
| chat_push_context | 029119b9be36b982af65088d5a574cc3 |
| prepare_chat_push_subscription | c30a3657ecb53b30c80ff124a6917413 |
| account_devices | 992f033699b626af652868ccc8479e5b |

Production execution privileges verified: detail functions authenticated-only; context/subscription preparation service-role-only; anonymous execution denied. Existing read and final push-eligibility bodies remain unchanged. Account inventory retains its existing signed-session/MFA checks and role grants.

Application release verification is recorded separately in the local release evidence. Rollback may leave the additive helper functions and compatible device timestamp/order in place.
