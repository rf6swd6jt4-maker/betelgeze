# Workspace search security protocol

Stage 1, 29 September 2026. Base: `0df589c3a3f62649937846981ec59a4cd51800f4`.

## Request and ownership rules

Every request requires a verified AAL2 session, an active workspace and current membership. The actor comes from the server session. Search reuses the panel registry, workspace capabilities, delivery-access scope and conversation-access policy; it does not grant permissions. Destination routes and commands independently recheck access. Authorization lookup failure, unavailable capability schema or malformed delivery scope produces an empty generic 503 response, never global or partial discovery. All responses, including errors, are `private, no-store` and vary on Cookie. Queries are limited to 200 characters and responses to 20 results.

A field may influence matching only when it belongs to the category's explicit readable projection. Hiding a sensitive field from JSON while matching its value is not sufficient. Never match provider credentials, signed URLs, storage keys, private native associations or hidden source identifiers. Use generated workspace-local destinations, not stored alternate URLs. Test records have exactly the same access rules as ordinary records.

## Category matrix

| Category | Who may search | Matching and display | Destination |
| --- | --- | --- | --- |
| Panels and tabs | Current panel registry and capabilities; SOP navigation is available to all members | Static titles, descriptions and keywords only | Existing panel route; Library opens scoped Work Items |
| Start New Relationship | `workspace_user_can_sell` must return true, including for owner/admin, matching the current server action | Static action copy only | Relationships creation action; command rechecks permission |
| Add Note / private settings shortcuts | Owner/admin | Static action/settings copy only | Existing guarded page/action |
| Relationships | Owner/admin, or IDs in `workspace_delivery_access_scope.relationships` | Relationship ID and existing staff reference fields: person/business name, email, phone, website, industry/location, source label, contact role, notes summary. Display person name and business/contact fallback. Do not match hidden client/Lead Gen IDs or commercial/service internals | Relationship Hub when permitted, otherwise authorized Onboarding or Fulfilment detail |
| Work items and onboarding reviews | Owner/admin, or `workspace_delivery_access_scope.work_items`; staff also require workspace visibility and non-admin area | Work item ID, title, description and lifecycle; no native IDs or stored alternate links | Canonical work-item detail |
| Client conversation contacts | Current `client_conversation_can_access`, for every role: membership plus a non-archived relationship and seller, fulfilment manager or explicit chat membership. Service assignment alone is insufficient; optional chat participants need no broader delivery access | Address and provider only. Result identity uses the authorized relationship/provider pair, not channel/client IDs | Communications selecting the exact authorized relationship |
| Notes | Owner/admin workspace catalogue | Note ID, name and description | Guarded note detail |
| Assets | Owner/admin workspace catalogue | Asset ID, ordinary kind/source labels, title and description; no external URLs or native IDs | Guarded asset detail |
| Client references and client activity | Owner/admin; existing relationship association required | Existing client identity/contact or activity summary fields | Authorized onboarding relationship |
| OKRs, key results, admin activity | Owner/admin | Existing ID/title/description/status summaries; no stored activity destination | Canonical private Admin route |
| Builder modules and service catalogue | Owner/admin | Existing record ID/code and revision name/description | Guarded builder or Settings editor |
| SOP records, document contents, message bodies | No new record/content search in this stage | Existing SOP navigation only; no document ingestion or history decryption | Existing SOP catalogue |

Archived relationships remain governed by their existing detail permissions; this stage does not silently change their discoverability. Contact search excludes archived relationships and inactive channels, matching usable conversations. Archived/test module and service behavior remains confined to owner/admin. Expanding categories or fields requires updating this matrix, checking the destination owner and adding positive and negative behavioral tests.

## Bounded execution

Search makes one explicit request-local delivery-scope read for staff and shares the result between relationships and work. React render caching is not assumed to deduplicate Route Handler reads. Independent reads run in parallel. Seller eligibility is one indexed lookup only when the creation shortcut matches the query; ordinary record searches add no seller request. Contact retrieval replaces the old workspace-wide channel query with one service-role-only RPC, `read_search_contact_channels`.

That RPC materializes at most 60 channel candidates, then removes inactive/unmapped channels and resolves their canonical same-workspace relationships before applying the existing conversation predicate. It uses existing channel, relationship, membership and participant indexes. It does not build rosters, decode messages, add an index, or issue an HTTP authorization request per result. The SQL fixture measures bounded candidate/authorization work and plans at growing synthetic volumes.

Existing category sampling and fixed result order remain for the capability pass: a missing match is not proof that an authorized record does not exist. The existing broad relationship loader and delivery-scope SQL are not rewritten here. No full-workspace cache, background task, subscription, external search service or new permission policy is introduced.

## Evidence and release

Route tests invoke the actual GET handler with synthetic database/auth boundaries and assert raw JSON and queried categories. SQL fixtures execute the actual conversation predicate and new RPC, including permission removal, owner/admin nonparticipation, malformed/cross-workspace links and bounded growth. Both run in the release checks. Existing queue assignment regression continues to establish generated-review authorization separately.

Install the additive contact RPC before the application, verify its deployed definition and service-role-only grants, then release the exact candidate after the repository gate. The migration changes no existing policy, row, message, attachment, read receipt or delivery job. Keep historical migrations immutable.

Application rollback must retain these search authorization protections. Do not restore the original workspace-wide contact query. If this implementation needs emergency withdrawal, disable the affected search category or carry the security fix onto the rollback revision; retain the harmless additive RPC until no callers need it.

Stage II replaces stale-query handling and silent category failures while preserving this authorization matrix. See `search-reliability-release.md` for the request lifecycle, bounded execution, resource comparison and release evidence. The original stage-I evidence remains in `search-security-release.md`; production deployment, authenticated workflow checks, browser fixtures and physical devices are distinct claims.
