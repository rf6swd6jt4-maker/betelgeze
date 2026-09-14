# SOP Library UI verification — 2026-09-14

SOPs now live in Library, retaining their existing URLs and member read access.
Workspace-wide Work Items/Assets collections and creation remain admin-only.
The new shared pill field supports immediate catalogue assignment; one main
procedure belongs to the SOP, and future service generation uses that source.
Existing published work and its evidence are unchanged.

Checks: 1,023 repository tests, 20 isolated PostgreSQL fixture groups, changed-file
ESLint, `git diff --check`, and a production Webpack build passed. SQL checks cover
field-level compare-and-save conflicts, staff/foreign-workspace denial, sole-file
adoption, main-file replacement, main upload replacement, and assignment removal
without history deletion. No AI/provider request was made for these checks.

Chromium and WebKit component fixtures at 320px and 1280px verified independent
name/description autosaves, failed-write draft retention and retry, catalogue
selection without an asset ID, service removal, three visible work links plus
`+25`, popup dismissal, PDF viewer mounting only on selection, cleanup on close,
and no horizontal overflow. Screenshots were inspected. These are browser fixtures,
not physical-device or production-latency measurements.

Performance boundaries: catalogue choices stay paginated and load only while the
picker is open; SOP record and asset reads remain independent; full document and
media previews load on demand. Only small images receive lazy original thumbnails.
The asset-work query is unchanged; overflow reduces the initially rendered field,
not its server payload. Shared WorkspaceLink preserves native navigation/prefetch
ownership. Navigation, edits and preview opening do not run extraction or generation.

Rollout: apply `20260914210000_sop_library_ui.sql` before the app release. It adds
functions and replaces the main-upload attachment function in one transaction;
no existing rows are backfilled. A rollback can restore the prior app while leaving
the additive functions available. Revert the attachment function separately only
if returning to the former multiple-main-file behavior is explicitly desired.
