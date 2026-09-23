# Foundation ownership

Read root `AGENTS.md`, `app_speed.md` and `docs/platform-foundation.md`.

Reuse shared detail/list primitives and authorized attachment commands. Preserve field concurrency, explicit link deltas, idempotency and the distinction between a committed write and a failed refresh. Never delete a file as an unlink side effect. Run record/attachment regression packs for changes to these paths.

Use `docs/additive-development.md`, `docs/deprecation-policy.md` and `docs/reliability-release-gate.md`; do not weaken existing checks to fit a new implementation.
