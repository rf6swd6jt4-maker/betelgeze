# Extending the platform

Start with the ownership map in `platform-foundation.md` and the nearest `AGENTS.md`. Trace the current rendered route and its authorization before making a replacement. Old task summaries are leads, not the source of truth.

1. Describe the new behavior and the existing behavior that must remain. Identify shared owners and affected tests with `node scripts/run-foundation-regressions.mjs --base <base> --list`.
2. Prefer a narrow, compatible addition to an existing owner. Keep startup code deferred, reads bounded and deduplicated, resources disposable and writes recoverable.
3. A replacement of a shared owner needs explicit scope, caller inventory, migration/compatibility plan, before/after behavior evidence and rollback. Do not silently replace foundation behavior during unrelated feature work.
4. Run the focused pack while iterating, then the full release gate. Tests must observe outcomes and failure/recovery behavior, not only match implementation text.
5. Report remaining limitations. Do not claim a permanently frozen or universally verified platform from one release.

No cleanup task authorizes deleting customer records, storage objects, credentials, accepted jobs, historical migrations, or another person's uncommitted files. Protected alerts changes require the authorization described in `app-alerts.md`.
