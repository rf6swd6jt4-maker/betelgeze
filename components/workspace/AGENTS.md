# Foundation ownership

Read root `AGENTS.md`, `app_speed.md` and `docs/platform-foundation.md`.

The workspace shell owns resident tabs, navigation, readiness, scroll memory and departure. Reuse the existing bridge/native/cache owners. Retain drafts on failed checkpoints; reject stale continuations; retry only the affected tab. Run workspace regression packs and both browser departure/draft fixtures. Do not add background polling or duplicate bootstrap reads.

Use `docs/additive-development.md`, `docs/deprecation-policy.md` and `docs/reliability-release-gate.md`; do not weaken existing checks to fit a new implementation.
