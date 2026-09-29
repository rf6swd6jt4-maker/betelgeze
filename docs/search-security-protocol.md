# Workspace search security protocol

Established in stage I, 29 September 2026; retrieval owner updated by the 30 September speed pass. Historical stage-I base: `0df589c3a3f62649937846981ec59a4cd51800f4`.

## Request and ownership rules

Every request requires a verified AAL2 session, an active workspace and current membership. The actor comes from the server session. Search reuses the panel registry, workspace capability rules and canonical relationship, work-item and conversation policies; it does not grant permissions. Destination routes and commands independently recheck access. Authorization lookup failure, unavailable capability schema or malformed search snapshot produces an empty generic 503 response, never global or partial discovery. All responses, including errors, are `private, no-store` and vary on Cookie. Queries are limited to 200 characters and responses to 20 results.

A field may influence matching only when it belongs to the category's explicit readable projection. Hiding a sensitive field from JSON while matching its value is not sufficient. Never match provider credentials, signed URLs, storage keys, private native associations or hidden source identifiers. Use generated workspace-local destinations, not stored alternate URLs. Test records have exactly the same access rules as ordinary records.

## Category matrix

| Category | Who may search | Matching and display | Destination |
| --- | --- | --- | --- |
| Panels and tabs | Current panel registry and capabilities; SOP navigation is available to all members | Static titles, descriptions and keywords only | Existing panel route; Library opens scoped Work Items |
| Start New Relationship | `workspace_user_can_sell` must return true, including for owner/admin, matching the current server action | Static action copy only | Relationships creation action; command rechecks permission |
| Add Note / private settings shortcuts | Owner/admin | Static action/settings copy only | Existing guarded page/action |
| Relationships | Owner/admin, or `workspace_user_can_access_relationship` | Relationship ID and existing staff reference fields: person/business name, email, phone, website, industry/location, source label, contact role, notes summary. Display person name and business/contact fallback. Do not match hidden client/Lead Gen IDs or commercial/service internals | Relationship Hub when permitted, otherwise authorized Onboarding or Fulfilment detail |
| Work items and onboarding reviews | Owner/admin, or `workspace_user_can_access_work_item`; staff also require workspace visibility and non-admin area | Work item ID, title, description and lifecycle; no native IDs or stored alternate links | Canonical work-item detail |
| Client conversation contacts | Current `client_conversation_can_access`, for every role: membership plus a non-archived relationship and seller, fulfilment manager or explicit chat membership. Service assignment alone is insufficient; optional chat participants need no broader delivery access | Address and provider only. Result identity uses the authorized relationship/provider pair, not channel/client IDs | Communications selecting the exact authorized relationship |
| Notes | Owner/admin workspace catalogue | Note ID, name and description | Guarded note detail |
| Assets | Owner/admin workspace catalogue | Asset ID, ordinary kind/source labels, title and description; no external URLs or native IDs | Guarded asset detail |
| Client references and client activity | Owner/admin; existing relationship association required | Existing client identity/contact or activity summary fields | Authorized onboarding relationship |
| OKRs, key results, admin activity | Owner/admin | Existing ID/title/description/status summaries; no stored activity destination | Canonical private Admin route |
| Builder modules and service catalogue | Owner/admin | Existing record ID/code and revision name/description | Guarded builder or Settings editor |
| SOP records, document contents, message bodies | No new record/content search in this stage | Existing SOP navigation only; no document ingestion or history decryption | Existing SOP catalogue |

Archived relationships remain governed by their existing detail permissions; this stage does not silently change their discoverability. Contact search excludes archived relationships and inactive channels, matching usable conversations. Archived/test module and service behavior remains confined to owner/admin. Expanding categories or fields requires updating this matrix, checking the destination owner and adding positive and negative behavioral tests.

## Bounded execution

After session/MFA verification, one service-role-only `search_workspace_records` RPC checks the active workspace and membership, derives search's minimal navigation capabilities and retrieves every admitted category from one statement snapshot. The actor is server-derived. Search no longer loads whole-workspace delivery ID sets or service definitions for an unused navigation capability. Seller eligibility is an indexed check inside that RPC, with no separate HTTP request. Staff execution does not enter private category/revision queries.

Existing source windows remain: relationships and active clients 1,000 each (the user-verified production Data API ceiling); workspace/private work 80 each; channels 60; OKRs 60; key results, admin activity, modules and services 100 each; latest module/service revision candidates 200 each; private client references, assets and notes 80 each; activity 60. These are retained candidate windows, not authorized result limits or a claim of exhaustive search. Matching and canonical authorization precede final per-category limits (8 relationships, 6 for most categories, 4 contacts/activity). The response remains capped at 20. Missing results do not prove a record is absent.

Client and activity destinations use a bounded private map from the same admitted canonical/legacy clients, never a later wider lookup or an untrusted stored relationship link. Private client samples share the same deterministic timestamp/ID order. Channels resolve their canonical same-workspace relationship and apply the existing conversation predicate for every role. No rosters, message decoding, new indexes, per-result HTTP permission request, whole-workspace cache, background task, subscription or new permission policy is introduced.

## Evidence and release

Route tests invoke the actual GET handler with synthetic auth/RPC boundaries and assert raw JSON, canonical destinations and failure handling. SQL fixtures execute the latest real relationship, work-item and conversation policies with the new RPC, including permission removal, owner/admin nonparticipation, malformed/cross-workspace links and bounded growth. Both run in the release checks. Existing queue assignment regression continues to establish generated-review authorization separately.

Install the additive retrieval RPC before the application, verify its deployed definition and service-role-only grants, then release the exact candidate after the repository gate. The migration changes no existing policy, row, message, attachment, read receipt or delivery job. Keep historical migrations immutable.

Application rollback must retain these search authorization protections. Do not restore the original workspace-wide contact query. If this implementation needs emergency withdrawal, disable the affected search category or carry the security fix onto the rollback revision; retain the harmless additive RPC until no callers need it.

Stage II replaces stale-query handling and silent category failures while preserving this authorization matrix. See `search-reliability-release.md` for the request lifecycle, bounded execution, resource comparison and release evidence. The original stage-I evidence remains in `search-security-release.md`; production deployment, authenticated workflow checks, browser fixtures and physical devices are distinct claims.

The speed-pass evidence and removal inventory live in `search-speed-release.md`. The current application has no old category-query or contact-RPC caller. `read_search_contact_channels` remains intentionally installed for older deployed builds and stage-II rollback; its existing security test remains blocking. Retire that compatibility function only after those external callers/rollback dependencies are deliberately retired, through a new migration. Historical migration files remain immutable.
