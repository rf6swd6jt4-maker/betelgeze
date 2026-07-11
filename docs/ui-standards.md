# Betelgeze UI standards

Repeated interface elements use the primitives exported from `components/ui`. New UI must not recreate them with page-local Tailwind classes.

## Status

`Status` communicates operational state, health, or progress. Its appearance follows the lead-generation poll UI: a Betelgeze diamond followed by plain text.

Statuses have exactly four tones:

| Tone | Meaning | Typical examples |
| --- | --- | --- |
| `grey` | Not started, inactive, unknown, or neutral | Initialising, queued, disabled |
| `yellow` | Active, waiting, or needs attention | In progress, pending, warning |
| `green` | Genuinely successful or ready | Successful, completed, verified |
| `red` | Failed, blocked, cancelled, or unavailable | Failed, error, blocked |

Do not add blue, violet, or other status colours. A configured, managed, or pending integration is not green unless the real path has been verified.

```tsx
<Status label="Initialising" tone="grey" />
<Status label="In progress" tone="yellow" />
<Status label="Successful" tone="green" />
<Status label="Failed" tone="red" />
```

## RoundPill

`RoundPill` represents assigned or attached things: services, modules, people, categories, filters, or other compact metadata. Its aesthetic comes from the assigned service and module pills in onboarding detail.

Pill colours are fixed RGB values rather than translucent utilities, so they remain identical on every surface. The first two recipes are sampled directly from the approved RoundPills; the remaining recipes preserve the same dark face, chromatic edge, and pale text relationship:

| Tone | Border | Background | Text |
| --- | --- | --- | --- |
| `emerald` | `#014E38` | `#051C16` | `#A4F5CF` |
| `sky` | `#01426B` | `#051B29` | `#B6E4FC` |
| `yellow` | `#7A5A00` | `#292005` | `#FFF085` |
| `amber` | `#6D2D00` | `#281206` | `#FEE685` |
| `red` | `#720810` | `#28090A` | `#FFC9C9` |
| `violet` | `#440D89` | `#1D0C39` | `#DDD6FF` |
| `neutral` | `#404040` | `#171717` | `#D4D4D4` |

These values are the palette definition. Do not substitute nearby framework colour tokens or recreate them with opacity.

`yellow` is the brighter label yellow and is the canonical tone for `Test` labels across the platform. `amber` is darker and warmer; retain it for labels that need an amber/orange distinction rather than using it as a substitute for `Test`.

Use `Assignee` when the attached thing is a person assigned to something. It is the canonical avatar-and-name form of `RoundPill`; do not assemble a separate profile-picture treatment for assignees.

```tsx
<RoundPill tone="emerald">Paid Social</RoundPill>
<RoundPill tone="sky">Reporting</RoundPill>
<Assignee name="Alex Morgan" avatarSrc={avatarUrl} />
```

## SquarePill

`SquarePill` is the boxier, rounded-corner label treatment. Use it for categorical labels such as `Stuck` or `Test`. It shares RoundPill's border, background, text, spacing, and colour palette; only its shape differs.

```tsx
<SquarePill tone="amber">Stuck</SquarePill>
<SquarePill tone="violet">Test</SquarePill>
```

## RelationshipStage

`RelationshipStage` is reserved for relationship lifecycle stages. It reads its border, background, and text colours from the exact same `pillTones` definitions as `RoundPill`; it must never maintain a separate stage palette. It is otherwise identical in height, typography, border weight, and spacing. The only difference is its silhouette.

The silhouette is a rectangle with half of a Betelgeze diamond attached to each end. It is exactly 24px high. Each pointed end is 12px deep, so its upper and lower edges travel at 45 degrees and meet at the vertical midpoint. In polygon terms, the six outer points are: top-left after 12px, top-right before 12px, right midpoint, bottom-right before 12px, bottom-left after 12px, and left midpoint. Do not soften, round, shorten, or reinterpret these four diagonal edges.

Relationship stages are categorical labels, not operational statuses. Their stage-specific colours therefore do not expand or alter the four-colour `Status` meanings. Pass the lifecycle phase itself so the component owns both its canonical wording and colour.

```tsx
<RelationshipStage phase="onboarding" />
<RelationshipStage phase="fulfilment" />
```

Do not use this shape for statuses, tests, warnings, services, modules, or arbitrary metadata.

## Shared rules

- Use sentence case; do not add uppercase tracking to ordinary pills or statuses.
- Pick pill colours by stable category. Status colours always retain the meanings above.
- Keep compact elements short. Put explanations in adjacent copy, a tooltip, or expanded detail.
- Extend a shared primitive when a new stable variant is required. Do not invent a one-off treatment in a page.
- When the design changes, update `components/ui`, this document, and existing uses together.
- A local exception must include a code comment explaining why the shared primitive cannot represent it.
