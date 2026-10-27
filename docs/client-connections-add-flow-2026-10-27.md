# Provider-first Client Connections

Status: user approved the measured advertising-query cost, including the approximately 6 ms tested worst-case increase, and authorized deployment. The selected query uses existing indexes and compact JSON tuples; the experimental registry is excluded. The selected query is integrated; release execution and exact-commit hosted checks are tracked in `/private/tmp/client-connections-add-release/manifest.json`. No production client/provider records, invitations, tokens, report bindings or accepted work have been changed during this revision.

Base: `4ae418ee016b286d2d4543449df4cc280ed29783` (the prior provider-summary and Windsor-return release).

## Requested behavior

- Each actual GHL, Meta Ads or Google Ads connection has its own List item. Meta's existing account access and Windsor reporting records remain distinguishable as separate saved connections.
- The operational list omits unconfigured relationship placeholders, archived relationships and retired snapshots. Current relationship means non-archived, matching the canonical Relationships screen; other relationship lifecycle statuses remain current until archived.
- Add connection opens GHL, Meta Ads and Google Ads cards with local company logos. Selecting a card loads authorized current relationship choices on demand. Explicit prefix search and UUID cursor pagination return at most 50 choices.
- GHL reuses its existing OAuth/manual/calendar owner; an exact authorized lookup restores a not-yet-connected relationship after a callback reload. The fresh picker revision takes precedence over a mounted list revision.
- Meta reuses Windsor maintenance, including automatic authorization-return discovery, explicit account preview and confirmation.
- Google uses the existing provider runner through a new staff scope, without onboarding or portal bearer tokens. Invitation and verification are explicit actions. Existing different customer IDs cannot be replaced through this Add flow. Failed or uncertain writes reconcile the dialog's metadata; a failed reconciliation cannot retain a green success status.

## Ownership and data

The new current GHL reader avoids historical placeholders and history downloads. The old command/history readers and immutable snapshots remain stored. Advertising reads stay independent of the initial GHL list and never contact providers. Setup dialogs are lazy loaded; there is no new startup provider call, background poll or timer.

New migration `20261027170000_current_client_connections.sql` supplies current GHL and relationship-choice RPCs and a new service-only current advertising reader with filtering before pagination. It adds no indexes or record rewrites. Existing name/company indexes serve explicit prefix search. The old advertising RPC stays unchanged for rollback; the new reader returns at most 51 ordered tuples and the server produces the existing 50-record public response.

New migration `20261027180000_staff_google_ads_connections.sql` supplies service-only staff read/begin/finish RPCs. They require current membership and a non-archived relationship, preserve the existing staff setup scope, recheck authority after the shared relationship lock, and validate the current configuration and attempt when completing. The staff scope cannot cancel a prior account invitation or replace a saved customer ID. Reports, onboarding provenance, requirements and accepted work remain untouched.

The GHL logo is a local copy of the official HighLevel homepage asset: https://assets.cdn.filesafe.space/knES3eSWYIsc5YSZ3YLl/media/6a3d48e8e4daecfbb47f2a0b.svg . Meta and Google use existing repository brand assets.

## Validation

- 1,855 unit tests passed. The legacy route assertion follows the new current-only reader. Windsor's return test now waits for its actual completion signal instead of assuming completion within 60 ms under concurrent test load.
- Production webpack build passed with loopback placeholder credentials; a final rebuild after the review fixes also passed.
- Foundation change checker/lint and immutable migration checks passed; no historical migration changed.
- New staff Google SQL fixture: 41 assertions; new unit tests: 8. Existing Google/onboarding/OAuth/report pack: 41 tests.
- New relationship route tests: 4. Isolated SQL checks cover actor scope, service-only grants, current filtering, exact callback recovery, literal/Unicode prefix search, pagination, denial and omission of unnecessary GHL metadata from advertising choices.
- Chromium and WebKit at 1280/390 passed the Add flow, logo loading, explicit-search/no-keystroke-fetch behavior, cursor paging, cancel/late response, retry, 403 clearing, all provider handoffs, Google invitation/check and failed-write reconciliation cases.
- Existing GHL OAuth/calendar cases passed both engines at 320/390/1280; client connection/manual/retirement and advertising cases passed both engines at desktop/mobile. Context overlay cases passed mobile/narrow/desktop and preserve tab ownership.
- Full Foundations browser suite passed 970/970 checks across 48 fixtures, Chromium and WebKit (2026-10-27 17:33:57 UTC). Physical device, authenticated production and live provider acceptance are not established by these local fixtures.

## Performance decision and investigation history

Matched isolated observations at 20,201 relationships: the GHL reader improved from about 13.68 ms to 1.02 ms median; the on-demand chooser was about 1.55 ms and a rare indexed prefix search about 0.70 ms. These are synthetic database timings, not end-to-end production promises.

The current advertising patch measured approximately 1.80 ms baseline versus 2.33 ms candidate (same 50-row response size), because filtering archived records before paging adds relationship checks. Under the repository speed contract this is a regression, despite its small absolute cost. The user initially requested further optimization. After the expanded measurements below, the user explicitly accepted the measured increase, including the approximately 6 ms worst case, and authorized finishing and deployment. `app_speed.md` now records that narrow query-only exception.

Read-only alternatives in `/private/tmp/client-connections-{merged,seek,flat,ids}-ad-experiment.*` did not establish a regression-free option. The best ordered merged-stream variant measured 1.60→1.86 ms in the small fixture and 1.53→1.64 ms at 60,600 provider rows. An unordered variant caused a full scan and was rejected. No experimental query was promoted into the migration, and `app_speed.md` remains unchanged.

### Expanded native PostgreSQL investigation

Further isolated PostgreSQL 18.4 tests compared randomized paired calls on 200 and 20,200 relationships, with up to 60,600 provider rows. They included warm and discarded-plan reads, first/next/exact pages, staff scope, dense and sparse provider distributions, mostly archived relationships, all archived relationships, and current relationships without corresponding provider connections. Timings include the local client parse and proposed response mapping; they are database-only local observations, not production or device timings. The local PostgreSQL build has no LLVM JIT, so these measurements do not establish production planner behavior.

- A single ordered stream with raw JSON metadata initially matched or improved dense cases. The expanded sparse case regressed from 0.437 to 3.896 ms median (100 paired observations; cold median 0.506 to 3.922 ms). Its plan scanned and sorted provider inputs despite the final page limit. Rejected.
- Per-provider current joins and bounded output avoided that particular sort but did not bound all scanned rows. Compact tuples reduced the private response by about 6.6 KB and saved about 0.03 ms versus object construction. They still measured 0.385 to 0.436 ms on a small archived prefix, 0.420 to 0.589 ms on mostly archived relationships, and 0.435 to 0.533 ms on sparse providers (50 paired warm observations and 20 discarded-plan observations). Rejected.
- When 20,000 current relationships had no provider connections and the saved connections belonged to archived relationships, even that bounded-output candidate regressed from 0.467 to 6.486 ms. This exposes an unbounded intersection search; a LIMIT alone does not resolve it. Planner settings and generic-plan variants introduced other regressions and were not promoted.
- Correctness checks traversed 358 pages / 17,888 sparse records without omissions or duplicates. They also covered exact 50/51 boundaries, a deleted cursor row, escaped/null text, empty scopes, permission revocation and malformed policy responses. Passing these checks does not resolve the speed failure.

Evidence remains in `/private/tmp/client-connections-native-final-validation.jsonl` and `/private/tmp/client-connections-native-tuple-experiment.jsonl`, with their fixture scripts and rejected SQL prototypes alongside. No application index, stored projection, trigger, provider call, production mutation or performance waiver resulted from these experiments. The tentative new-RPC TypeScript adapter and its tests were restored to the existing deployed RPC contract; no caller references the unimplemented experimental RPC. The requested UI and unrelated validated work remain intact.

### Isolated current-connection index feasibility

A disposable prototype uses a private registry containing only workspace, relationship, provider and current/non-archived classification. A partial ordered index selects at most 51 connection keys before hydrating metadata from the existing provider and relationship owners. No credentials, names, reports or account data are duplicated in the registry. This is an architectural option, not an installed migration or an approved performance exception.

The compact-tuple variant improved warm medians in six tested read cases (80 randomized paired observations each, with client parse/mapping included): small common page 0.368→0.363 ms; growth common page 0.385→0.345 ms; sparse first/next 0.396→0.380 and 0.392→0.371 ms; disjoint first/next 0.381→0.271 and 0.395→0.245 ms. Forty discarded-plan observations per case also had lower medians. Small-page warm p95 increased from 0.404 to 0.419 ms and remains unresolved.

**First-touch failure after archive churn:** the disjoint-case plan captured before these repeated measurements returned zero live keys but performed 60,343 heap fetches, with 59,704 shared block hits and 1,143 reads. The registry index scan took 6.525 ms and total query execution 6.547 ms. Obsolete index entries still required visibility/cleanup work. Only the number of returned keys and subsequent provider lookups was bounded; physical registry work was not. The preliminary claim that the index proved bounded work was therefore incorrect. `DISCARD PLANS` resets plans, not MVCC/index/cache state, and the earlier EXPLAIN had already paid this first-touch cost. Repeated warm/replanned timings cannot establish first-touch performance or clear the release gate.

The index remains an investigation artifact, not a recommended finished fix. A safe release still needs first-touch/churn evidence, concurrency correctness, storage/maintenance assessment and explicit authorization of any added write cost. Evidence is in `/private/tmp/client-connections-native-registry-tuple-proof.jsonl`; no prototype caller or schema was added to the application.

The prototype keeps the registry synchronized on actual provider insert/delete, changed workspace/relationship keys, and relationship archive/unarchive transitions. Existing-key metadata/token/report updates do not write the registry; same-key upserts still incur trigger-condition evaluation. A stored projection adds maintenance and storage costs and cannot be described as free.

Matched isolated PostgreSQL 18.4 write observations (80 randomized paired samples per action, explicit BEGIN/write/COMMIT acknowledgement included; fsync, synchronous_commit and full_page_writes enabled):

| Write | Baseline median | Prototype median |
| --- | ---: | ---: |
| First connection insert | 0.042 ms | 0.055 ms |
| Connection delete | 0.041 ms | 0.046 ms |
| Archive relationship with three connections | 0.048 ms | 0.065 ms |
| Restore relationship with three connections | 0.050 ms | 0.066 ms |
| Archive relationship without connections | 0.048 ms | 0.054 ms |
| Restore relationship without connections | 0.051 ms | 0.058 ms |

Verification and name-edit controls were unchanged within these observations. These are incremental synthetic database costs, not estimates of production request latency or ceilings for a finished implementation. Storage was about 16 MiB after the fixture's growth/status/deletion churn; this is not a fresh per-row storage estimate.

Sequential insert/delete, archive/unarchive and rollback checks passed. Concurrency remains unproven: existing provider commands often lock provider rows first; the relationship archive owner locks its parent row first. A release design must review that order, concurrent deletion/key movement, Meta upsert semantics, privilege boundaries, and supported transaction isolation. A parent lock alone is insufficient proof for REPEATABLE READ snapshots. The proof uses disposable synchronization triggers and must not be copied into a release as though these questions were settled.

Proof sources and evidence: `/private/tmp/current-registry-prototype-setup.sql`, `/private/tmp/raw_registry_advertising.sql`, `/private/tmp/client-connections-native-registry-proof.mjs`, and `/private/tmp/client-connections-native-registry-proof.jsonl`. No application schema or write path has been changed. The measured extra write work requires a separate explicit choice under `app_speed.md` before this architecture can be implemented.

Use the measured provider-branch compact-tuple query under the explicit allowance, finish candidate verification, and follow the normal exact-commit CI/migration/deployment gate. No registry, index, trigger or added write cost is authorized or included. Application rollback preserves the old RPC, additive functions and all client data.

Final local cleanup: the original advertising adapter contract was restored, its four existing unit/route tests passed, and `git diff --check` passed. All requested UI work remains saved; no corrected-UI release was committed, pushed, migrated or deployed.

## Approved release selection

The user’s final decision was: “I'm fine with the measured increase, including the 6 ms worst case. Finish the connections changes and deploy.” The chosen implementation is the measured bounded-provider-branch query from `/private/tmp/raw_tuple_advertising.sql`, installed under `read_current_client_advertising_connections`; it is not the registry experiment. The independent server adapter validates the private tuple shape, preserves the existing public metadata object, slices the 51st lookahead and derives the next cursor from the last visible item. Local integration checks, hosted exact-commit CI, migration checks and terminal deployment evidence will be recorded below. The earlier hold and failed experiments are retained as historical evidence only.

## Final candidate verification

- The integrated tuple query is byte-for-byte identical to the measured prototype’s candidates/page/aggregate body (SHA-256 `ab48e95d723a1e84f5cb254cc56e759c959db7f0b7e113d9f2134de914a7d19a`). No registry, trigger, index or provider-side action is included in this release.
- Complete unit suite: 1,859 passed. Changed-file lint, whitespace and immutable migration checks passed (300 historical migrations preserved, two new migrations).
- Production webpack build passed with loopback placeholder credentials, including TypeScript and all static routes.
- Final Add connection acceptance passed Chromium and WebKit at desktop/mobile sizes. The full Foundations suite and final execution details are recorded separately in the release manifest.
- The actual advertising decoder and exact migration passed PGlite and native PostgreSQL correctness, including a 358-page / 17,888-record sparse walk, exact 50/51 boundaries, null/malformed policies, privilege checks, legacy RPC compatibility and unchanged source fingerprints. Timing output produced while other local checks ran is not isolated performance confirmation and is not used to redefine the approved measurement.
- Staff Google SQL: 48 native assertions, including permission revocation while begin/finish waits for the relationship lock; 41 PGlite assertions; 42 focused Google/onboarding/reporting/OAuth/staff tests. Independent source review found no actionable authorization, binding, provenance or pagination issue.
- Production read-only preflight confirmed the old advertising reader still matches its deployed body, all required dependencies exist, and none of the seven new functions is installed. The prepared atomic install contains only these additive functions and grants, followed by catalog/hash/privilege verification. No real-client mutation or provider request is part of release verification.

The release manifest records the candidate SHA, all exact hosted checks, migration hashes and postflight, production deployment state and read-only HTTP/UI results. Local browser/database checks do not establish physical mobile acceptance, live provider delivery or sustained-session performance.
