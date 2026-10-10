# Shared Communications read-path efficiency — 10 October 2026

## Scope and baseline

The user asked to optimize the existing shared read path first, then reassess independent device counts. The strict per-action speed rule and account-wide alert suppression remain mandatory. Earlier approval covers the scoped repair and deployment, but explicitly rejected speed exceptions remain rejected.

Application baseline: `fa1f2cd7b4931763928e7c212c8aeffd9fb784ff`. Work is isolated on `codex/comms-read-speed`. The rejected device-badge branch `codex/device-unread` is preserved separately; none of its device tables, cookies, summary protocols or badge behavior is part of this application optimization.

## Application changes

1. Retain a bounded queue-local record of this queue's own validated acknowledgements. Repeated visibility observations covered by that exact account/workspace/conversation cursor return before session-storage persistence and HTTP saving. The cache holds at most 256 identifier/timestamp entries, clears on disposal and never grants a read on its own. Newer messages and failed or mismatched responses still follow the existing queue.
2. Use the same canonical workspace authorization with only `id, slug, status` for the two read POSTs. Authentication, MFA, active workspace, membership, normalized role and Communications panel checks remain in place. Other workspace callers keep the full projection and legacy branding fallback.
3. Reuse the request-scoped Supabase client verified by that guard for `advance_communication_read`. The RPC, successful response, error mapping and deferred notification cleanup retain their existing contract.

There is no extra polling, subscription, request, retry timer, browser owner or UI layout change. Shared read receipts and cross-device notification eligibility remain account-wide. This reduces redundant work; it does not implement independent device badges or claim to resolve every reported stale badge.

## Measurements and correctness evidence

- Matched actual queue code, one save followed by five identical observations before rendered cursor propagation: saves **6 → 1**, session-storage writes **12 → 2**, acknowledgement publications **6 → 1**. First saves and genuinely advancing cursors still save. This does not imply a matching reduction in summary GETs, which already deduplicate cursor acknowledgements.
- Actual reader fixture with production React and deliberately held parent cursor propagation: baseline sends **5 POSTs** for one acknowledged position after four scroll events. The candidate sends **1 POST**, then correctly saves the next newer message. All 160 read cases pass across Chromium/WebKit and mobile/desktop fixtures; all 52 remote-convergence cases pass. These are synthetic request counts, not production HTTP latency.
- 45 isolated route/authorization cases compare actual baseline and candidate modules. Successful read routes create **2 → 1** Supabase clients. The fixture workspace response shrinks **578 → 80 bytes** with null branding, or **845 → 80 bytes** with configured branding (19 → 3 fields); workspace/membership request count is unchanged. They do not access real accounts or generate production reads.
- Queue review found and corrected a degraded-storage recovery edge before release: if clearing pending storage fails after acknowledgement, the cached entry is discarded so the existing repeated-observation retry can clear storage and the warning once storage recovers. A new test reproduced failure before the correction and verifies recovery afterward.
- Full local tests, changed-file lint and immutable migration checks, production webpack builds and **650/650** Foundations browser checks passed. The final exact commit is also subject to hosted CI; physical devices and live HTTP latency are not represented by these fixtures.

## SQL evaluation and device-count reassessment

The retained SQL candidate caches `auth.uid()` after the unchanged authentication/MFA/member guard, inside each valid chat-kind branch. It reuses this identity for conversation policy, advisory-lock key, lookup, write and response. It does not merge the lock and lookup into one SQL statement, alter grants/policies or add any table/index/row. Migration SHA-256: `feaa4a857f38caf6f380c6e10cc0719388ba2383cd608f9047f7fa93cd6f1134`.

Two matched PGlite runs use 240 warmed samples per arm, an unchanged baseline control, alternating execution order, 1 and 1,000-chat cohorts, and 10,003 messages per target. In the repeat 1,000-chat run, median/p95 milliseconds were:

| Action | Prior shared | Optimized shared |
| --- | ---: | ---: |
| Client advance | 0.077 / 0.094 | 0.072 / 0.091 |
| Client older position | 0.065 / 0.122 | 0.061 / 0.099 |
| Client duplicate | 0.064 / 0.081 | 0.061 / 0.083 |
| Team/DM advance | 0.085 / 0.143 | 0.079 / 0.117 |
| Team/DM older position | 0.075 / 0.090 | 0.071 / 0.082 |
| Team/DM duplicate | 0.076 / 0.086 | 0.072 / 0.083 |

Normal-read medians improve in every tested cohort/action. Tail samples vary between runs and controls, without a repeated candidate tail regression. Denial medians are unchanged within the 0.001 ms reporting resolution. This is isolated SQL evidence, not a production latency claim. Denied paths are part of the speed gate: a prototype removing the outer MFA check was rejected after AAL1 and re-enrollment denial medians changed 0.030 → 0.037 ms and 0.026 → 0.032 ms, despite successful-read wins.

Reproduce functional/guarded-install checks with `BE_PGLITE_ROOT=<isolated-runtime> node scripts/validate-communication-read-efficiency.mjs` and measurements with `node scripts/benchmark-communication-read-efficiency.mjs` under the same runtime. `build-communication-read-efficiency-release.mjs` generates exact-byte guarded install, rollback and read-only schema preflight/postflight. It checks prior/current function body, canonical policy bodies and the security contract; drift fails closed. Native PostgreSQL independent-connection checks and timing run in hosted CI.

### Independent device counts remain held

A new, isolated, temp-only comparison used 240 matched samples per arm, 1,000 chats per kind, 10,002 messages per target and 2,002 device cursor rows. Against the optimized shared RPC, the existing held device candidate still costs more for every tested action:

| Action | Optimized shared median/p95 ms | Held device median/p95 ms |
| --- | ---: | ---: |
| Client advance | 0.075 / 0.088 | 0.122 / 0.146 |
| Client read after another device already read | 0.061 / 0.075 | 0.106 / 0.138 |
| Client duplicate | 0.060 / 0.076 | 0.101 / 0.122 |
| Team/DM advance | 0.079 / 0.090 | 0.123 / 0.138 |
| Team/DM read after another device already read | 0.072 / 0.081 | 0.116 / 0.130 |
| Team/DM duplicate | 0.069 / 0.077 | 0.110 / 0.119 |

The shared-path savings are not used to offset these per-action regressions. No device migration, cookie, summary metadata expansion or badge mode is activated. The prior recovery-payload and mixed-version concerns also remain unresolved. The strict speed gate therefore continues to hold that implementation; no further speed waiver is requested.

## Release status and rollback

Application candidate validation is complete locally; hosted checks and exact deployment status must be verified before release. No new SQL has been installed in production. The browser-control runtime currently exits before it can enumerate the signed-in Supabase/Vercel windows; two retries reproduced this infrastructure failure. No credentials were extracted as a workaround.

The application retains the existing RPC interface and can run against the current production database independently of the optional SQL optimization. Application rollback restores the prior code without deleting cursor history, messages, stored files or notification jobs. Historical migrations and the rejected device candidate are preserved.

Production latency, authenticated cross-device behavior and physical Android/Chrome and iPhone/Safari/PWA checks remain separate from local/CI validation. An ordinary working day has not yet been observed for sustained-session stability.
