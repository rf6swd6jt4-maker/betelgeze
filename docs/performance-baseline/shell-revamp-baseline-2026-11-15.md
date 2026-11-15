# Shell revamp speed baseline (2026-11-15)

The reference the new layout (Today column, work area, context column, no tabs) must match or beat, per `app_speed.md`.
It is a summary of **production telemetry**, not a controlled benchmark: real staff sessions recorded by
`beginWorkspaceInteraction` into `workspace_interaction_metrics` over the 30 days to 2026-11-15. No load was generated and
no records were touched; the query below is read-only.

## How it was produced

Grouping and percentiles follow `scripts/summarize-workspace-performance.mjs` (nearest rank, completed samples only),
done in SQL so no samples left the database:

```sql
with s as (
    select operation, route_section,
           coalesce(measurement->>'renderer', 'unknown') as renderer,
           coalesce(measurement->>'cacheState', 'unknown') as cache,
           coalesce((measurement->>'startedVisible')::boolean and (measurement->>'endedVisible')::boolean
                    and coalesce((measurement->>'visibilityChanges')::int, 0) = 0
                    and not coalesce((measurement->>'background')::boolean, false), false) as foreground,
           measurement->>'outcome' as outcome,
           (measurement->>'durationMs')::numeric as ms
    from public.workspace_interaction_metrics
    where created_at > now() - interval '30 days' and operation in ('navigation', 'tab_switch', 'panel_load', 'launch')
)
select operation, route_section, renderer, cache, foreground, count(*) as n,
       count(*) filter (where outcome = 'completed') as ok, count(*) filter (where outcome <> 'completed') as not_ok,
       round(percentile_disc(0.5) within group (order by ms) filter (where outcome = 'completed')) as p50_ms,
       round(percentile_disc(0.95) within group (order by ms) filter (where outcome = 'completed')) as p95_ms
from s group by 1, 2, 3, 4, 5 having count(*) >= 3 order by 1, 5 desc, 6 desc;
```

## Results (foreground throughout, native renderer)

Sample counts are small; treat every row as an observation, not a guarantee (`app_speed.md` §4).

| Operation | Panel | Data | n | Not completed | p50 | p95 |
|---|---|---|---:|---:|---:|---:|
| Tab switch | Relationships | already loaded | 17 | 0 | 86 ms | 160 ms |
| Tab switch | Queue | already loaded | 3 | 0 | 52 ms | 67 ms |
| Tab switch | Relationships | from network | 13 | 0 | 2.12 s | 2.82 s |
| Panel load | Relationships | already loaded | 53 | 0 | 40 ms | 72 ms |
| Panel load | Queue | already loaded | 8 | 0 | 30 ms | 51 ms |
| Panel load | Work items | already loaded | 5 | 0 | 55 ms | 74 ms |
| Panel load | Relationships | from network | 62 | 5 | 2.03 s | 3.26 s |
| Panel load | Queue | from network | 12 | 1 | 1.33 s | 1.85 s |
| Panel load | Assets | from network | 9 | 0 | 1.99 s | 3.07 s |
| Panel load | Work items | from network | 9 | 1 | 2.14 s | 4.78 s |
| Navigation | Relationships | already loaded | 25 | 2 | 68 ms | 124 ms |
| Navigation | Work items | already loaded | 3 | 0 | 134 ms | 167 ms |
| Navigation | Queue | already loaded | 5 | 1 | 54 ms | 771 ms |
| Navigation | Relationships | from network | 22 | 5 | 2.58 s | 3.32 s |
| Navigation | Queue | from network | 9 | 1 | 1.35 s | 1.87 s |
| Navigation | Assets | from network | 8 | 0 | 2.00 s | 3.12 s |
| Navigation | Work items | from network | 6 | 1 | 2.12 s | 2.27 s |

Samples that were hidden or in a background tab at any point are excluded above. They exist (navigation to Relationships
from network: 13, 9 not completed, completed p50 52 s) and reflect suspended tabs, not the user waiting.

## What this means for the new shell

- **Resident switching is the bar to protect.** Moving between already-loaded panels is 30-160 ms p95, close to the
  plan's ~150 ms p95 target. The new layout replaces tabs with a persistent Today column and a work area; switching what
  the work area shows must stay in this range when its data is already in memory.
- **First loads are the opportunity.** Loading a panel from the network takes 1.3-2.6 s p50 and up to 4.8 s p95, far
  above the ~300 ms target for data that is already available. The new shell should not add to this, and keeping the
  Today column and context resident should mean fewer cold loads overall.
- **Not-completed loads matter.** 5 of 62 Relationships first loads and 5 of 22 first navigations did not complete.
  The new shell must not raise these rates.

## Gaps in this baseline

- **Only native panels report.** Relationships, Queue, Assets and Work items are covered. Communications, Settings,
  Admin, Onboarding, Staff and other iframe-hosted panels emit no navigation samples, so there is no baseline for them.
- **No launch samples** were recorded in the 30 days, so app start-up time has no production baseline.
- **Small counts.** Most rows have fewer than 30 samples; p95 on 3-13 samples is unreliable.
- **No device split.** The telemetry does not separate phone from desktop here.

Before the new shell ships, close these with either (a) the controlled-browser harness
(`scripts/benchmark-workspace-browser.mjs`) on an isolated staging workspace, which needs a staging database and test
login the project does not have yet, or (b) more weeks of telemetry plus `navigation` samples from the iframe panels.
Compare the new shell against this table with the same query, matched by operation, panel and data state.
