# Foundation ownership

Read root `AGENTS.md`, `app_speed.md` and `docs/platform-foundation.md`.

Historical migrations are immutable. Add deterministic migrations only when needed and authorized; rehearse with synthetic fixtures. Verify installed schema separately from repository history. Do not replay migrations, reset databases, delete storage or rewrite client/user rows during consolidation. Document exact prerequisites, checks and compatible rollback. Read app-alerts.md for protected functions/triggers.

Use `docs/additive-development.md`, `docs/deprecation-policy.md` and `docs/reliability-release-gate.md`; do not weaken existing checks to fit a new implementation.
