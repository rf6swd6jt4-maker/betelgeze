# Independent records review — 2026-09-23

Reviewed candidate in `/private/tmp/betelgeze-platform-consolidation`. No application source, production data, provider configuration or external storage was changed by this review.

## Resolved findings

1. New manual upload key previously omitted actor identity. An authorized second actor knowing the same pending request ID could obtain a new receipt over the first actor's pending object. Candidate now binds workspace, actor and request in `lib/assets/upload-receipt.ts:5,18`; signer and HEAD use exactly that path (`lib/assets/uploads.ts:10-16`), and SQL repeats the exact check (`supabase/migrations/20260923171000_record_attachment_commands.sql:160`). Existing reads and historical paths remain compatible.
2. Pre-RPC name/description validation could permanently lock a locally persisted create request (for example whitespace-only required note fields). Candidate routes generated authenticated request payloads to authoritative SQL validation (`app/[workspaceSlug]/relationships/actions.ts:679-687,701-705`). Known SQL validation rejection is persisted under the request lock, and only a confirmed terminal result makes the saved request editable. Auth/request-ID/receipt validation remain before mutation.

## Reviewed safety properties

- SQL commands are invoker functions granted only to service_role and assert active-workspace owner/admin membership (`20260923171000:21-27,181-182`). HTTP/actions derive workspace+actor from authenticated context and reject a mismatched expected user.
- Existing attachment commands recheck both endpoints within the same workspace, lock the note/link owner where required, preserve existing private-work-item trigger enforcement and use duplicate-safe inserts.
- Text save locks the authoritative note and compares only the edited field baseline; matching final-value replay succeeds without rewriting another field. Relationship edits express add/remove intent and preserve unseen additions.
- Create command serializes the same workspace/actor/request, looks up prior exact payload first, and returns its stable accepted/rejected result (`:117-123`). Record, links and accepted receipt commit together. Known failures roll back the inner subtransaction before a terminal rejection is stored (`:125-178`). Unknown transport/SQL errors never imply rejection.
- Delayed duplicate of a rejected request remains rejected even if its target becomes valid later. Accepted duplicate remains accepted after later target archival or upload receipt expiry.
- Client recovery keeps scalar submitted intent at immutable per-request storage keys. Acknowledgement removes only a matching raw entry. Explicit rejected-draft revision restores text/links, generates a new identity, and retains the old persisted draft until its replacement is stored (`WorkspaceCreateModal.tsx:180-201`). It never deletes a possibly accepted server record.

## Verification

- `records-independent-action-review.mjs` invokes the current transpiled server actions against explicit no-provider mocks: six checks pass for whitespace note validation, ambiguous error retention, oversized asset title validation, accepted+expired upload replay, actor-specific keys, and changed-session no-RPC behavior.
- `scripts/validate-record-attachment-commands.mjs`: 31 checks pass against disposable PGlite; no production calls. Output: `records-independent-sql-review.log`.
- `tests/asset-upload-provenance.test.ts` and `tests/note-concurrency.test.ts`: 9/9 pass; output `records-independent-focused-review.log`.
- No remaining high-confidence authorization/atomicity/lost-ack safety blocker found in this reviewed candidate.

Limits: PGlite uses a serialized connection and is not a multi-connection lock-contention benchmark. Signed R2 conditions, real R2 HEAD/CORS behavior, authenticated browser rendering and physical devices are separate evidence gates. Full repository suite and production build belong to the integrator.
