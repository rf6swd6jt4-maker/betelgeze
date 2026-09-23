# Foundation ownership

Read root `AGENTS.md`, `app_speed.md` and `docs/platform-foundation.md`.

The portal has its own session authorization and standalone viewport controller. Do not copy workspace iframe assumptions into it. Preserve sold-service identity, onboarding snapshots, private media, tab scroll and agency branding. Do not send messages or mutate real client records for QA. Run portal tests and appropriate viewport tests for changes.

Use `docs/additive-development.md`, `docs/deprecation-policy.md` and `docs/reliability-release-gate.md`; do not weaken existing checks to fit a new implementation.
