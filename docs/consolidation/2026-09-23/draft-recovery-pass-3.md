# Pass 3 editable-route draft recovery

This local candidate extends the Pass 2 host/native departure repair to the previously memory-only record text and settings form owners. It does not change the Next router, introduce another `flushSync`, lock typing, poll, reload the page, or repeat a network save during departure. No production records, objects, providers, protected reads/activity/alerts or migration history were touched by this package.

## Owner inventory and bounded change

| Owner | Current behavior and scope |
| --- | --- |
| `useWorkItemTextDraft` | New journal/checkpoint covers Note name/description, SOP title/description, and work-item description/instructions. Existing authoritative snapshots and field-specific save/conflict logic remain. |
| `WorkspaceAutosaveForm` | New journal/checkpoint covers the workspace-name and public-branding forms only, using explicit field whitelists. File/password/checkbox/radio recovery is not introduced. |
| `RelationshipBackgroundEditor`, `RelationshipDealWorkspace` | Existing durable draft queues and checkpoint registrations retained unchanged. Their storage schema and recovered client drafts are not migrated or deleted. |
| `AssetFieldsEditor` | Existing local draft/checkpoint/unload behavior retained unchanged. |
| `AppointmentTable` | Existing checkpoint remains conditional on its draft-command feature path. This package does not expand that flag or certify the legacy path. |
| `RelationshipAssets`, `SopAssetUpload` | Existing dirty/busy departure refusal remains. Upload bytes are not serialized into text journals. |
| `ManualSettingsForm` | Legacy Lead Gen owner remains outside this package and behind the separately documented subsystem quarantine. |

The new files are `lib/workspace-draft-journal.ts` and `components/workspace/WorkspaceDraftRecovery.tsx`. The two owner implementations are `components/work-items/useWorkItemTextDraft.ts` and `components/workspace/WorkspaceAutosaveForm.tsx`; their Note, SOP, work-item, native Library and Settings bindings supply stable actor/record/field identities. Work-item text and the two settings actions now reject a supplied expected actor that differs from the authenticated actor. This adds no authorization query. Optional actor parameters preserve old-client compatibility; current recovery callers always bind the actor. Existing server authorization remains authoritative.

## Storage and recovery contract

- Ordinary input updates existing editor state/refs. It does not serialize or write a journal. Mount performs one exact scoped hint lookup, not an origin-wide storage scan.
- A dirty owner checkpoints at the existing departure boundary, layout cleanup, `beforeunload`, and `pagehide`. Layout cleanup reads the latest refs/DOM snapshot, including input made after an earlier departure save while a streamed route remains pending. Unchanged successful checkpoints skip another write.
- A journal key contains the actor, workspace slug, record type, record ID and stable field ID. Every journal gets a fresh random writer identity; duplicated tabs do not inherit ownership through session storage. Other writers' copies, malformed entries and archived recovery copies are never deleted or expired.
- The text journal caps value and baseline at 100,000 characters each; the two whitelisted settings forms cap their serialized snapshot at 12,000 characters. A larger or storage-denied draft remains in a document-lifetime map, reports failure and makes a cancellable unload request confirmation. Confirmed durable snapshots are removed from that map, avoiding a second unbounded copy of every persisted draft.
- A per-record hint is never cleared: a stale hint is safer than racing another writer. Only an acknowledged clean copy belonging to the current writer may be retired. A failed removal leaves a stale recoverable copy.
- `Review saved drafts` is an explicit operation. It captures the starting storage-key count, yields every 25 keys, supports cancellation and displays ten copies at a time. It reads only the exact scope, preserves unreadable entries and reports incomplete reads. Account changes cancel the dialog; stopped owners cannot reopen it or deliver old results. The existing account-clearing event's `preservedUserId` keeps the newly active actor's owner and dialog alive.
- `Use this draft` archives the current dirty copy and places selected text in the editor using the current server baseline/version. It makes no request. Debounce, blur and an already-running save drain cannot submit the recovered value. The user must choose `Save reviewed draft`, after which the existing save and conflict behavior applies. A recovered copy is not described as server-saved merely because it was recovered.
- Keyed caller/form lifetimes and the hook's defensive identity reset fence actor/record replacement. A late request from the old scope cannot update the new owner's values, status, baseline or pending promise. Submitted form metadata is attached to a separate request copy, so a thrown action cannot contaminate a draft with technical fields.

These are scoped local recovery copies, not encrypted storage or an authentication boundary. Other same-origin code can read local storage. Account scoping prevents this UI from offering or submitting a different actor's copy; server authorization still controls a write. This follows the application's existing local draft model and preserves copies on account changes rather than deleting client work.

## Performance evidence before implementation

The synchronous checkpoint risk was measured before adding the journal. The synthetic desktop benchmark used 100 samples per size at 0, 1,000, 20,000 and 100,000 characters, with a matching-size baseline. The largest JSON payload was 200,251 bytes. It measured serialization separately, an existing-writer write, and a first checkpoint including its hint.

| Desktop browser | 20k first checkpoint p95 / maximum | 100k first checkpoint p95 / maximum |
| --- | --- | --- |
| Chromium 153 | 0.2 ms / 0.3 ms | 0.3 ms / 0.5 ms |
| Safari 27 | 1 ms / 1 ms | 1 ms / 1 ms |

Safari's coarse timer limits sub-millisecond interpretation. These are this machine's synthetic local-storage observations, not an authenticated application benchmark, a physical-mobile measurement or a guarantee under disk pressure. The benchmark's `ordinaryTypingStorageCalls: 0` field describes the proposed checkpoint-only design; the editor tests and separately mounted browser fixture exercise actual input behavior.

Exact unmodified reports: [Chromium](./evidence/draft-checkpoint-chromium.json), [Safari](./evidence/draft-checkpoint-safari.json). The [reproduction script](./evidence/draft-checkpoint-benchmark.mjs) starts a loopback-only synthetic page and bounded result sink. Its audit server on port 57670 was stopped after capture; it is not an operational service. No client data was used.

## Local validation

The focused command below passed **24/24**, with no failed/skipped/cancelled tests:

```sh
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  tests/work-item-description-reconciliation.test.ts \
  tests/work-item-content-save.test.ts \
  tests/workspace-draft-journal.test.ts
```

The journal tests execute the real helper with injected storage. They cover fresh writers, foreign/malformed copy preservation, actor/workspace/record/field separation, latest post-ack input, quota/oversize refusal, durable RAM release, stopped owners, bounded enumeration under concurrent key growth and cancellation. The editor tests compile and execute the actual hook/editor callbacks with a deterministic hook harness; they are behavioral but do not model React scheduling. They cover zero typing writes, latest unload input, quota refusal, recovery during an in-flight save, explicit subsequent save, prop-only actor replacement, preserved/displaced account events, and existing concurrent server-snapshot reconciliation. The server-action tests execute actual compiled work-item actions against synthetic authorization/storage doubles, including stale actor rejection with zero writes and concurrent field-specific saves.

All changed application TypeScript files and these focused tests passed scoped ESLint with `--max-warnings=0`; `git diff --check` passed. Root's combined suite/build and the actual mounted React browser fixture are separate integration evidence, recorded in [Pass 3 integration](./pass-3-integration.md). A synthetic hook harness alone is not evidence for Next's streamed commit timing, native browser unload UI, actual server writes or provider behavior.

## Remaining lifecycle and release limits

The new checkpoints preserve these owners across a streamed React teardown in the same document. Storage failure there keeps an explicit recovery copy in the surviving document. `beforeunload` can request the browser's standard leave confirmation when checkpointing fails; the browser controls whether it displays that prompt. `pagehide` retries the latest local checkpoint but is non-cancellable. An abrupt browser/OS termination, an event the platform never dispatches, storage loss, or failure first occurring at non-cancellable document destruction cannot be made lossless by a page script. A retained in-memory copy survives only while its document survives. Other unchanged editor types retain their own contracts from the inventory above.

This package therefore does not claim universal hard-navigation or crash recovery. It narrows the known owner gap without persisting every keystroke, adding IndexedDB/global recovery architecture, suppressing user input, or forcing Next transitions into synchronous rendering. Authenticated route testing, real browser reload/close confirmation, storage-pressure behavior and physical Android/Chrome versus iPhone/Safari/PWA verification remain release evidence gates. The server and storage installation/deployment sequence remains root's separately documented responsibility; do not deploy an application candidate ahead of its required reviewed SQL commands.
