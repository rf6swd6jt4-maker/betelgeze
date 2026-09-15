# SOP images and relevant work attachments

## Behavior

PDF and DOCX SOP uploads create a durable background extraction job. Existing files can be queued through **SOP → source asset → Extracted images**, and extraction is also requested before a new image-aware interpretation. Upload acceptance and the normal SOP page do not wait for parsing or AI.

- PDF visual references are rendered pages, preserving surrounding text, captions, vector drawings and annotations. They are deliberately labelled as pages rather than isolated figures.
- DOCX pictures preserve occurrence order, nearby text and supported cropping. Documents containing unreproduced Word shapes, charts, rotations, flips or overlays yield preview-only pictures; AI cannot attach them. Use a PDF export for faithful visuals from those documents.
- Original files remain available. Extraction is versioned and reused. Identical pixels share stored bytes while separate occurrences retain their own source locations.
- Private image and thumbnail routes use current workspace/asset authorization. Workers gain access through their existing work-item asset links. There is no client message or notification in this feature.

## Relevance and cost

The source interpretation associates an image with a specific instruction only after assessing the visual itself. Work generation receives only images associated with source steps, explicit SOP reference assets and permitted files linked exclusively to the current client. Unscoped Library files, cross-client files and private Admin work attachments are excluded.

Candidates need useful descriptive evidence; filename-only matches are excluded. Selection occurs inside the existing generation call, with at most 64 candidates, 1,000 description characters each, three attachments per task and twelve per plan. Empty selections are valid. An attachment must include an exact quote from the source instruction, an exact quote from the asset description and a concrete reason. Image associations must also match the task's source steps. Information-request tasks receive no attachments.

Before atomic publication, the database rechecks scope, source-step evidence, duplicates and the saved version of each selected asset. Stale selections reject publication while preserving the paid plan. Replaying a successful publication creates no duplicates. Existing work is not silently modified.

The interpretation cache uses `sop-source-images-v3`; generation uses `sop-work-assets-v7`. Older paid plans remain recoverable. PDF interpretation already includes page images and receives no duplicate image payload. DOCX interpretation receives the retained images once per source interpretation. Saved image associations and generation results are reused; there is no additional per-task model call.

Semantic relevance still depends on the model. Quote validation prevents invented evidence, but cannot prove that two real quotations are meaningfully related. The prompt favors omission whenever uncertain. Sparse descriptions and image-only pages without usable extracted text may therefore be omitted.

## Bounds and deployment

- Original source: 20 MB, at most 80 PDF pages and 80 visual references.
- Decoded image: 16 million pixels; display image longest side at most 2,400 px; thumbnail width at most 400 px.
- Total retained image bytes: 24 MB. DOCX expansion: 100 MB, 3,000 ZIP entries, bounded individual parts. External DOCX links are never fetched.
- Parser: short-lived child process with no application credentials, 256 MB JavaScript heap, 85-second deadline; native decoder allocations remain separate from the JavaScript heap. Storage writes share a 150-second job deadline inside a three-minute lease. Maximum three interrupted/extraction attempts; no automatic paid-call retry.
- The existing authenticated `sop-work` scheduler dispatches extraction, generation and standalone interpretation. One extraction is processed per wakeup before AI work. The heavy parser dependencies are traced only into the extraction worker route. Node 22.13+ or Node 24 is required by PDF.js.

Apply `20260915170000_sop_images_and_work_assets.sql` before deploying the application. It adds private tables, versioned extraction jobs, scoped candidate selection and an atomic publication wrapper. It performs no source/work backfill. Queue the two existing PDF sources after the new worker is live and confirm `ready` plus authenticated previews.

Rollback application changes while retaining the additive schema and original files. Pause extraction dispatch first if necessary. Retain job/object records for investigation; no automatic destructive object cleanup is included. An interrupted upload can leave unreferenced content-addressed objects under the extraction job prefix.

## Verification

- 1,088 repository tests passed; changed-file lint and `git diff --check` passed.
- Actual migrations rehearsed in isolated PGlite with the existing work graph and growth fixtures. Cases cover leases, current authority, private/cross-client exclusion, preview-only exclusion, stale assets, unsupported quotes/steps, atomic rollback, duplicate-free replay and ordinary-role denial.
- Synthetic PDF verifies an annotation outside the embedded image survives; DOCX verifies cropping, separate occurrences, stable hashes, unsafe transformation exclusion, external-link omission and extraction limits.
- Both existing production source PDFs were read and extracted locally without AI or production writes: Meta Ads produced 45 visual pages in 7.6 seconds (5.15 MB); SEO produced 32 in 3.9 seconds (3.52 MB). These are single local parser observations, excluding network/storage and provider time, not production latency guarantees.
- Browser fixture: initial SOP control makes zero extraction reads; opening the modal makes one status read, renders thumbnails and a selected original, retains background layout and returns focus on close. Desktop and 390 px Chromium viewport checked. Physical mobile devices and WebKit were not checked in this release.
- Production Webpack build passed. Runtime extraction must also pass from the exact traced deployment files, followed by live worker/image checks after deployment.

Production migration and deployment verification are recorded separately at release completion.
