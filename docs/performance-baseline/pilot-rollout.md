# Performance pilot rollout

September 11, 2026. PR #37 and recovery PR #38 are merged and live in the operator-account production pilot. Foreground checks observed **33–78 ms warm navigation** and **101–110 ms tab switches** between Relationships and Work Items. Two network-backed navigations took **3,164 ms and 3,353 ms**. These are limited observations from one Mac/account/network, not platform-wide guarantees or a controlled baseline comparison.

## Verified release evidence

- PR #37 merged as `1f9716d`, with **829 tests**, production build and preview checks passing.
- Recovery PR #38 merged as `e0772eef2ecc1ed7b71ca296e5583b2454cc730a`, with **838 tests**, changed-file lint, source TypeScript and production build passing.
- All **183 repository migrations** replayed locally with actual application helpers/triggers and `pgcrypto`; platform Auth/Vault adapters were the local limitation.
- The combined synthetic rollback suite then passed on the actual Supabase database. It covered command receipts/version conflicts, allocation and suspended-access permissions, lease fencing, encryption, bounded decoder parity, corrupt rows, AAL2/nonparticipant denial and cleared history. No synthetic workspace remained.
- The permanent six-migration transaction succeeded; its four new tables are available through REST. Existing permission/encryption helpers were retained. No client content was copied or external provider delivery invoked.
- The catalog check exposed no `schema_migrations` columns; no migration-history rows were written.
- Recovery deployment `dpl_HMCerPFfYnqoz8xvC2SFEKgxw3nf` reached **Ready**, with the `app.betelgeze.com` production alias verified at **2026-09-10 23:09:12 UTC**. The operator account's workspace/actor gates remain unchanged and appointment notification queuing remains **off**, independently checked.
- A live-origin reload cleared the previous error. Native Relationships showed 10 records and Work Items 160; the lead filter showed 2 and open-work filter 94, then clearing them restored 10/160. Three warm Library ↔ Relationships round trips rendered without errors in one HTML document.

Reviewed SQL artifacts were retained outside the repository; the rollback generator and fixture sources are checked in.

| Artifact | SHA256 |
| --- | --- |
| `be-performance-rollout-validation.sql` | `76f4e53d2e000815db7ad946a30718589c6195ad3ae7142182862101fccf95fa` |
| `be-performance-rollout-apply.sql` | `b9b4518fd65c3e806bd3e73a55a018acdebf3019cefa909e1f96e9ac5ac0af34` |

## Foreground observations and limits

The content-free report `be-performance-recovery-live-report.json` was generated at **2026-09-10 23:11:52.238 UTC**, covering samples since **23:09:30 UTC** on the PR #38 deployment. Its SHA256 is `9caaa6cb068ee291b6e98e311ad5d06333d86833bdd6747262b01baab5f292cf`. All **34 samples completed**, with zero failures, timeouts, aborts or unknown outcomes. All confirmed visibility throughout, no hidden duration and no suspension.

The **16 navigation/tab interactions** below measure input to the native panel's meaningful-ready marker after paint. The other 18 samples are overlapping panel-load measurements and must not be counted as independent user actions. The [content-free observations](foreground-recovery-observations.json) retain all 34 samples. Exact values are sorted within each group:

| Foreground interaction | Count | Meaningful-ready time (ms) |
| --- | --- | --- |
| Warm Relationships navigation | 6 | 33, 40, 45, 46, 47, 53 |
| Warm Work Items navigation | 5 | 53, 62, 63, 78, 78 |
| Warm tab switches | 3 | 101, 105, 110 |
| Network-backed Work Items navigation | 1 | 3,164 |
| Network-backed Relationships navigation | 1 | 3,353 |

Visual QA also observed a transient blocking overlay after the cold relationship-detail marker and after returning from Communications. The marker therefore does not certify unobstructed interaction for those cases. The repeated warm list-navigation loop finished without that overlay. Investigation identified an unsolicited Gantt Server Action read, which can show a global loader even in a resident detail panel; the follow-up must address that separately from its sidebar spacing correction.

The follow-up candidate excludes native panel content from the legacy sidebar inset; the shell already reserves that width. Its actual compiled CSS passed 42 Chrome/WebKit geometry checks covering desktop/mobile, sidebar/context states and legacy controls, including a control that reproduces the original extra inset. Gantt reconciliation now uses a private, no-store GET with the same admin/MFA/relationship checks, while native initial rendering reuses its supplied plan. Read cancellation and generation fences protect newer edits and account changes. The candidate passes all **846 tests**, including eight new route/read lifecycle cases, the final production webpack build and independent review. These candidate checks are separate from deployed evidence; verify the final release before claiming the visual regressions resolved in production.

“Network-backed” describes the panel read, not a cold application install. This small session cannot certify a p95, repeat-launch target or percentage speedup. Initial hidden-tab samples remain excluded. PR #38's recovery is now live and foreground-checked. A separate visual correction for excess native sidebar inset is still awaiting review/deployment.

After the report cutoff, an existing Communications tab successfully loaded its scoped legacy frame instead of `about:blank`. Clients/Team tabs, existing conversation content, attachment control and composer appeared; empty Send stayed disabled and existing delivery status remained visible. No message was sent or edited. This passes basic authenticated UI-load verification only, with no Communications timing, media or provider proof; it adds no samples to the 34 above.

Before widening the pilot, verify that layout correction and exercise live saves, save → navigate away → reopen/reload, multiple windows, account/MFA changes, revoked access, offline recovery, media and broader Communications interactions. Physical iPhone/PWA checks and representative cold/warm launch measurements remain separate. Keep notification queuing disabled until scheduler invocation, consent/provider outcomes and uncertain-send reconciliation pass. SQL lease contention was simulated sequentially; independent concurrent database sessions remain untested.

All [remaining implementation limits](../workspace-performance-implementation.md#remaining-plan-work), including legacy panels, incomplete command extraction, broad Communications bootstrap windows and absent persistent read sync, still apply.

## Subsequent production verification

PR #39 merged as `a224ee9ac095a491feca8f619845135ec000c71d`. Deployment `dpl_9qvtiNKtHfXHm4FZnRwnMK2cjoP9` is Ready on `app.betelgeze.com`. The live Relationships screenshot verified the corrected width; the test detail and repeated 160/10-record Library/Relationships switches showed no global loading overlay. The new Gantt GET returned 401, private/no-store and no plan to an unauthenticated request. No business records were edited or messages sent.

The later timing window became hidden again: 15 samples contained 3 completions and 12 aborts, with no valid foreground navigation/tab measurement. These do not replace the foreground table above. A further hidden-page check found the functional tab label could remain `Loading` despite committed content. A child passive effect could acknowledge readiness before either receiver had registered. The subsequent correction registers both native handles and the host message receiver in layout effects, retaining the existing URL/account checks and paint measurement boundary. It passes **849 tests**, the production build, lint/source TypeScript and independent review. Three new regression cases execute production hooks with child-before-parent phase scheduling, independently reproduce each old passive-registration failure, and verify hidden cached mount, route change, cleanup/replay and stale-callback handling without painting. Its live verification is separate from the PR #39 layout checks.

## Rollback

Disable the workspace gates and outbox flag, then redeploy compatible code that retains command endpoints and receipts. Keep `WORKSPACE_PERFORMANCE_USERS`: clearing it would broaden enabled workspace gates. From an authenticated Vercel CLI linked to BE, only if rollback is needed:

```sh
vercel env rm WORKSPACE_NATIVE_PANELS production --yes
vercel env rm WORKSPACE_RELATIONSHIP_DRAFT_COMMANDS production --yes
vercel env rm WORKSPACE_COMMUNICATIONS_BOUNDED_READS production --yes
vercel env rm WORKSPACE_APPOINTMENT_OUTBOX_READY production --yes
vercel redeploy dpl_9qvtiNKtHfXHm4FZnRwnMK2cjoP9 --target=production
```

Leave an already absent flag absent; a later verified compatible deployment may replace the listed ID. These use Vercel's [environment commands](https://vercel.com/docs/cli/env) and [redeploy command](https://vercel.com/docs/cli/redeploy). After Ready, refresh affected pages and confirm legacy navigation/save paths return. Do not drop tables, discard drafts or blindly retry uncertain deliveries. Keep accepted commands/jobs recoverable; follow the [operations guide](../workspace-performance-command-operations.md) for draining and reconciliation. No rollback command above was executed for this report.
