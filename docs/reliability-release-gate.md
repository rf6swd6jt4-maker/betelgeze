# Reliability release gate

Use a clean isolated candidate when the primary checkout is dirty. Record the base and exact release commit. Follow `app_speed.md`; this gate supplements its requirements.

During development, `node scripts/run-foundation-regressions.mjs --base <base>` selects existing regression packs from changed paths. Unknown application paths select the full suite. This is iteration feedback, never a substitute for the release suite.

Before deployment:

- Inspect the complete diff and dependency removals; run `node scripts/check-foundation-changes.mjs --base <base> --lint` and `npm test`.
- Build the production candidate with `npx next build --webpack`. Placeholder environment values are allowed for isolated compilation; no production writes or provider calls are part of validation.
- Run `npm ci --prefix scripts/browser --ignore-scripts`, install Chromium/WebKit using the local Playwright CLI, then `node scripts/browser/run-foundations.mjs`. Browser tooling is separate from application dependencies. The runner blocks non-loopback requests and exercises actual component/helper fixtures with synthetic data. Report both engines and missing cases.
- Run the isolated PostgreSQL regression when record commands or schema contracts change. Never run migration-history replay or broad production backfills to make a code check pass.
- Validate affected authenticated workflows using an explicitly isolated test workspace when available. Never generate reads, messages, uploads or mutations against real client records solely for testing.
- For keyboard/viewport changes, record physical Android/Chrome and iPhone/Safari/PWA checks separately. Browser emulation and injected viewport faults do not satisfy this evidence category.

The Foundations GitHub workflow runs tests/build/migration checks, isolated PostgreSQL and both browser engines. Its presence does not configure branch protection or make Vercel wait for CI. For this direct-main release workflow, validate the same commit on the candidate branch before advancing main; verify all applicable hosted checks, then the exact production deployment status. Never force-push over concurrent main work.

After deployment, report commit, CI status, terminal deployment status, read-only HTTP smoke results and remaining authenticated/device checks separately. Review an ordinary working day for error/latency/resource growth before claiming sustained-session stability. No automatic monitoring or production load test is implied by this document.

Rollback application code first using a reviewed compatible revision. Preserve data, immutable migration history, accepted work and storage. Keep the last known compatible database/configuration state unless its rollback is independently authorized and verified.
