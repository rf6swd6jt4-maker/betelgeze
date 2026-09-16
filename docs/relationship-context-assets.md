# Relationship assets and work-generation context

Relationship details now contain an Assets section before the danger zone. Authorized
relationship editors upload PDF, DOCX, TXT, Markdown and CSV documents, download
originals, correct their descriptions, or remove them from future context. Removing
keeps the original asset and historical generation snapshots; it is not deletion.
Files stay internal; this does not publish them to a client portal or send messages.

## Context precedence

The work generator receives saved document text, asset descriptions and the current
relationship name, company, industry, website, location, role and description.
It reads document facts first, applies the asset description's explicit corrections,
then current relationship fields and finally explicit relationship-description
corrections. Unresolved source disagreements require verification. Sources cannot
change model instructions, permissions, schema or SOP safety requirements.
The existing SOP input-confirmation task structure is preserved: known facts should
be checked, rather than requested from the client again. No automatic website browsing.

Documents are facts for the assigned service, not extra SOPs. Work already published
is unchanged. Generate new work after saving the relevant files and descriptions.
The snapshot is checked again during publication; intervening context edits fail
closed instead of publishing a plan based on obsolete information.

## Limits and cost

- Maximum 20 attached documents, 20 MB per file, 80 PDF pages, 60,000 extracted
  characters per file, 100,000 extracted characters per relationship.
- PDF extraction reads the text layer, not OCR. A page without readable text causes
  an explicit error. DOCX reads body text and tables. Images, visual layouts, and
  tracked editorial intent are not interpreted; supply a text explanation/transcript.
- Extraction runs in a bounded child process with no application credentials when
  finalizing the upload. Finalization stores immutable text/hash once, atomically
  with the attachment. No model call at upload or relationship navigation.
- Generation uses the existing model, rate ledger and daily budget. Added context
  increases input tokens within these bounds; no new inference stage or model upgrade.
- Initial relationship loading has no extra request. Asset metadata is loaded when
  its section enters view on an active tab (one bounded indexed read, no media signing).
  Originals are requested only for download.

## Correctness and rollout

Migration `20260916120000_relationship_context_assets.sql` adds a private context
cache and scoped, idempotent upload and compare-and-set description functions.
It extends the existing evidence snapshot and protects publication with the same
relationship lock used by asset mutations. It does not rewrite current work or data.
Apply before deploying application changes. A rollback must disable attachment
edits/generation together; never run an older generator against new context and claim
it used the documents. Keep cached files and history intact.

Validation: document/parser and receipt tests, mocked generation request checks,
actual migration SQL in PGlite covering authorization, repeated finalization,
description conflicts, evidence changes, removal and private-table access.
A live synthetic OpenAI check could not run because the local API request returned
401; no claim of live model precedence validation is made.
Prompt boundaries follow [OpenAI's prompt-engineering guidance](https://developers.openai.com/api/docs/guides/prompt-engineering).
