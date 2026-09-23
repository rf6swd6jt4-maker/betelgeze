# Foundation ownership

Read root `AGENTS.md`, `app_speed.md` and `docs/platform-foundation.md`.

Before changing chat geometry or composer sizing, read `docs/communications-layout-contract.md` and preserve its owner boundaries and regression matrix. Physical-device acceptance remains separate from automated evidence.

Read `app-alerts.md` before changes, including geometry that affects message visibility. Preserve read/unread/activity/push semantics unless explicitly authorized. Reuse the existing composer, history, viewport and coordinated-update owners. Keep team/client authorization distinct. For geometry, test keyboard open/close, multiline, selection, reply/attachments, tab departure and resume in both engines; report physical Android/iPhone separately.

Use `docs/additive-development.md`, `docs/deprecation-policy.md` and `docs/reliability-release-gate.md`; do not weaken existing checks to fit a new implementation.
