# Pre-queue cleanup proposal

13 September 2026. Read-only production inventory; no cleanup has been authorized or executed. This is a preparation gate before SS-05 work generation and the personal queue, not a conversion of existing clients.

## Verified Scaylup inventory

- 42 relationships: 10 active, 32 archived.
- Seven active records explicitly marked as tests have 39 unfinished work items: Effron McKinsey, John Pitts, TC B3, Test Client 5, Test Client 9, Test Client 14, Test Client 17.
- Nineteen archived records explicitly marked as tests still have 136 unfinished work items. Archiving alone is insufficient to retire obsolete work.
- Bruce Laing's active Retention relationship and his older archived record are protected. No service adoption, lifecycle changes, new charges or work regeneration are proposed for either.
- Eric Kant Controller and Mike Hickman are active and have no test flag. They require classification, not inference from the desired clean workspace.
- The Library has 80 asset records; one has neither a direct relationship link nor a work-item link. No asset is linked directly to multiple relationships, and no work item is linked to multiple relationships in this inventory. These counts do not establish that assets are unused by templates, SOPs, services or provider settings.
- No Andy Sambitan relationship appeared in the current inventory.

## Proposed operation, subject to review

1. Capture a recoverable manifest of exact relationship, work, session and asset IDs with their original states. Protect Bruce by ID, including his historical record, rather than by a name filter alone.
2. Soft-archive the confirmed active test relationships. Keep existing completed work and audit history intact.
3. Mark obsolete unfinished work belonging exclusively to confirmed test records as canceled, with a cleanup reason. Include already-archived tests. Do not mark unused work as successfully completed. Review dependencies and any indirect shared ownership before applying changes.
4. Retire test onboarding links and pending automatic delivery only for the approved records, preserving session answers, receipts and payment history. Avoid provider sends and subscription changes.
5. Hide/archive test-only Library records from normal working views after checking all references. Preserve service catalogue entries, published onboarding modules, SOPs, reusable media and settings. The unlinked asset needs inspection, not automatic deletion. If Library lacks archival support, implement a reversible archival/filter mechanism before changing its visibility.
6. Verify that active work and Library views are clean, test links cannot resume obsolete flows, and Bruce's records, team, portal, integrations, messages and services are unchanged.

## Work after cleanup

Implement queue eligibility so archived relationships and canceled work never become actionable even when historical records remain. Then complete SS-05's service-specific Setup work generation from SOP revisions, dependency handling, assignments, completion rules and duplicate prevention; add Maintenance cycles with an agreed cadence. Use a controlled fixture to verify the sale → onboarding → review → Setup → work → completion path before adopting Andy.

Andy should have an explicit service-by-service starting-state review, preserving work already delivered and onboarding already collected. Do not replay charges or create tasks for already-completed work. Queue correctness must not depend on an empty database, and Bruce's legacy compatibility must remain supported.
