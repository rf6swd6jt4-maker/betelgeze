# SOP document catalogue

Historical storage-only implementation. The current local extension is documented
in [SOP records and interpretation](sop-records.md), with [OpenAI setup](sop-openai-setup.md).

Implemented locally on 13 September 2026. This change adds document storage and
viewing only. It does not extract content, create templates or generate work.

## Behavior

- SOPs appears in the workspace sidebar and panel search for every current
  workspace member, including staff without service assignments. Existing
  Library, relationship and work-item permissions are unchanged.
- Owner/Admin sees Add SOP, which opens the device file picker. Accepted formats
  are PDF and DOCX, with a 50 MiB limit. Filenames become catalogue titles.
- The catalogue shows 24 documents per page, newest first, ordered by timestamp
  and ID. File bytes, signed URLs and document previews are absent from this read.
- SOP details offer an inline PDF preview and explicit Open PDF/Download actions.
  DOCX is downloaded for viewing in a document reader; no DOCX preview conversion
  or external document-viewing service is used.

## Storage and authorization

SOPs are existing `assets` records with `asset_kind = document`,
`source_kind = upload`, and `native_kind = sop_document`. No separate document
copy is inserted into Library: the same asset is available there to admins.

The API authenticates current workspace membership and MFA through the existing
`requireWorkspace` owner. Both upload preparation and finalization check the
current role. A signed receipt binds the random asset ID, workspace, actor,
filename, size, content type and expiry. Finalization receipts expire after 24
hours; upload URLs expire after 15 minutes. The receipt is stored in the tab's
session storage before transferring bytes, scoped by workspace, account and
workspace-tab identity. Navigation is held while an upload is active.

Uploads go directly to an R2 staging key. Finalization checks stored size, MIME
and the PDF/ZIP header, then copies the verified object to a separate SOP key
before inserting the asset. This is a format sanity check, not a full document
parser. Browser upload credentials cannot overwrite the final key. Copy uses
an ETag precondition. Repeated finalization returns the same asset, including
lost acknowledgements; a failed insert retains staging for retry. A successful
insert attempts staging cleanup. Abandoned/expired staging uploads currently
have no automatic cleanup job; no periodic scheduler is introduced here.

The SOP viewer scopes its exact asset lookup by workspace and SOP kind before
issuing a private 60-second document URL. It does not grant staff access to the
Library or to other asset types. Existing authentication and RLS remain in place;
no new database grants are added.

## Performance and release

Apply `20260913233000_sop_catalogue.sql` before enabling the catalogue in
production. It adds the partial `(workspace_id, created_at desc, id desc)` index
for SOP assets. No data backfill or workflow migration runs. SOP navigation uses
the existing resident workspace-frame path and shared banner; no new global
fetch, subscription, parser, timer or startup dependency is introduced.

Validation on this local change:

- Focused tests cover format/size rejection, signed-receipt tampering, actor and
  workspace isolation, expiry, staff upload denial, document authorization,
  retry recovery and bounded cursor reads.
- Existing repository suite, changed-file ESLint, diff checks, and a production
  Webpack build pass. The build uses a clean temporary source copy to exclude
  unrelated generated fixtures and duplicate Next type output in the checkout.
- A PostgreSQL/WASM fixture with 50,000 assets uses `assets_sop_catalogue_idx` and
  reads 25 rows for a page. A single observed execution was 0.170 ms; this is
  query-plan evidence, not production latency or a p95 measurement. Equal
  timestamp pagination has no overlap or omission in the fixture.
- Chromium and WebKit fixtures at widths 320, 390, 768 and 1280 verify square
  cards, unclipped content, no horizontal overflow, staff read-only controls,
  invalid extension feedback, and successful recovery after a save error and
  reload. Screenshots were visually inspected at mobile width.

The database migration, real R2 upload/download, authenticated workspace shell
navigation, production latency and physical Android/iPhone behavior remain
unverified in production. No deployment or customer-data change was made.
