# Performance pilot rollout

September 10, 2026. PR #37 is merged and the operator-account production pilot is live. Native Relationships and Work Items load real data without child frames; filters reuse the loaded snapshot. **Foreground timing evidence and live recovery verification remain pending.** No near-instant or sub-second performance claim is established.

## Verified release evidence

- PR #37 merged as `1f9716d`, with **829 tests**, production build and preview checks passing.
- All **183 repository migrations** replayed locally with actual application helpers/triggers and `pgcrypto`; platform Auth/Vault adapters were the local limitation.
- The combined synthetic rollback suite then passed on the actual Supabase database. It covered command receipts/version conflicts, allocation and suspended-access permissions, lease fencing, encryption, bounded decoder parity, corrupt rows, AAL2/nonparticipant denial and cleared history. No synthetic workspace remained.
- The permanent six-migration transaction succeeded; its four new tables are available through REST. Existing permission/encryption helpers were retained. No client content was copied or external provider delivery invoked.
- The catalog check exposed no `schema_migrations` columns; no migration-history rows were written.
- Production deployment `dpl_B2tVD3GGLqQb5vJ2V96jNAiCcWgM` reached **Ready**. Workspace flags and the shared actor restriction select the operator account's native panels, durable drafts and bounded Communications reads. Appointment notification queuing remains **off**.

Reviewed SQL artifacts were retained outside the repository; the rollback generator and fixture sources are checked in.

| Artifact | SHA256 |
| --- | --- |
| `be-performance-rollout-validation.sql` | `76f4e53d2e000815db7ad946a30718589c6195ad3ae7142182862101fccf95fa` |
| `be-performance-rollout-apply.sql` | `b9b4518fd65c3e806bd3e73a55a018acdebf3019cefa909e1f96e9ac5ac0af34` |

## Evidence limits and recovery

The authenticated browser used for initial live checks remained hidden (`document.visibilityState`); every timing sample was excluded from speed claims. An attempted Communications navigation left its legacy frame at `about:blank` and rolled back to Relationships after a false 12-second failure. Communications live UI verification therefore remains pending. The recovery follow-up passes **838 tests**, changed-file lint, source TypeScript and a production webpack build. It pauses deadlines while hidden/inactive, preserves and recovers the exact native destination, refreshes retries and keeps committed content separate from visible-paint measurements. Deployment and foreground verification were pending when preparing this report. The successful native checks above are functional evidence only.

Before widening the pilot, verify that candidate, measure foreground cold/warm launch, navigation, tab switching, saves and media readiness, and exercise save → navigate away → reopen/reload, multiple windows, account/MFA changes, revoked access and offline recovery. Physical iPhone/PWA checks remain separate. Keep notification queuing disabled until scheduler invocation, consent/provider outcomes and uncertain-send reconciliation pass. SQL lease contention was simulated sequentially; independent concurrent database sessions remain untested.

All [remaining implementation limits](../workspace-performance-implementation.md#remaining-plan-work), including legacy panels, incomplete command extraction, broad Communications bootstrap windows and absent persistent read sync, still apply.

## Rollback

Disable the workspace gates and outbox flag, then redeploy compatible code that retains command endpoints and receipts. Keep `WORKSPACE_PERFORMANCE_USERS`: clearing it would broaden enabled workspace gates. From an authenticated Vercel CLI linked to BE, only if rollback is needed:

```sh
vercel env rm WORKSPACE_NATIVE_PANELS production --yes
vercel env rm WORKSPACE_RELATIONSHIP_DRAFT_COMMANDS production --yes
vercel env rm WORKSPACE_COMMUNICATIONS_BOUNDED_READS production --yes
vercel env rm WORKSPACE_APPOINTMENT_OUTBOX_READY production --yes
vercel redeploy dpl_B2tVD3GGLqQb5vJ2V96jNAiCcWgM --target=production
```

Leave an already absent flag absent; a later verified compatible deployment may replace the listed ID. These use Vercel's [environment commands](https://vercel.com/docs/cli/env) and [redeploy command](https://vercel.com/docs/cli/redeploy). After Ready, refresh affected pages and confirm legacy navigation/save paths return. Do not drop tables, discard drafts or blindly retry uncertain deliveries. Keep accepted commands/jobs recoverable; follow the [operations guide](../workspace-performance-command-operations.md) for draining and reconciliation. No rollback command above was executed for this report.
