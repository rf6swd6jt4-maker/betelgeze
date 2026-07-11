# Betelgeze UI standards

This is the shared vocabulary for repeated interface elements. New UI should import these primitives rather than recreating their appearance with page-local Tailwind classes.

## Rules

- Use `Pill` for compact metadata, categories, filters, and non-live labels.
- Use `AssignmentPill` whenever a pill represents a person or assignee.
- Use `Status` for state or health. A status uses the Betelgeze diamond mark and plain text; it is not automatically a pill.
- Choose tone from meaning, not decoration: `neutral`, `info`, `success`, `warning`, or `danger`.
- Reserve `success` for a genuinely completed, available, connected, or verified state. Configured, managed, and pending are not synonyms for verified.
- Use sentence case. Do not add uppercase tracking to ordinary pills or statuses.
- Keep compact elements short. Put explanations in adjacent copy, a tooltip, or expanded detail rather than inside the pill.
- Extend the shared primitive when the product needs a new stable variant. Do not create a one-off look in a page.

## Imports

```tsx
import { AssignmentPill, Pill, Status } from "@/components/ui"

<AssignmentPill name="Alex Morgan" avatarSrc={avatarUrl} />
<Pill>California</Pill>
<Pill tone="info">Automated</Pill>
<Status label="Running" tone="info" />
<Status label="Verified" tone="success" />
<Status label="Needs attention" tone="warning" />
```

## Semantic distinction

| Element | Meaning | Shape |
| --- | --- | --- |
| Pill | Attribute or compact metadata | Bordered capsule |
| Assignment pill | A person assigned or attached | Capsule with avatar |
| Status | Current state, health, or progress | Diamond mark with text |

## Changing the system

Design changes belong in `components/ui`, followed by migration of existing uses. Update this document in the same change. A local exception should be rare and must include a code comment explaining why the shared primitive cannot represent it.
