# Cold entry creates nested workspace shells — 15 September 2026

## Production reproduction

After deploying `5172f166`, an authenticated desktop Safari tab was opened directly at `/scaylup/queue`, independently of the user's existing PWA service-edit form.

The page initially displayed “Opening your queue…”. Safari's accessibility tree subsequently showed the outer tab renamed “Relationships” at `/scaylup`, an “Opening record” skeleton, a child iframe at `/scaylup/queue` containing another complete workspace shell, and a further child frame at `about:blank`. The actual Work Queue heading, counts, and records were already present inside the nested shell. Safari's console also reported failed RSC fetches for the frame-marked queue URL followed by browser-navigation fallback. These console errors are observations; the routing defect below is independently demonstrated by the source and regression checks.

The most recent hour of production logs contained 35 native panel requests, all HTTP 200, and zero error-level requests. This is a bounded observation, not proof that every request or every device succeeded. HTTP success alone did not establish a usable page.

## Cause

`queue` was the default workspace landing page and a registered native/navigation destination, but was missing from `WORKSPACE_SHELL_SECTIONS`. `sops`, another Library destination, was also absent. Proxy therefore rendered those pages directly instead of entering the persistent workspace shell.

On this fallback path, `WorkspaceTopBar` ignored the requested page and created its initial tab at `/${workspace.slug}`. That root redirects to the default queue without a frame marker. The child consequently rendered another full shell, rather than the bridge that would acknowledge readiness to its parent. Repetition left loaded content hidden behind opening states. The previous access/error-classification patch did not address this routing path.

## Fix

- Register Work Queue and SOPs as shell-hosted routes, including cold direct entry and saved launch hints.
- Start the fallback shell at the current request URL, preserving query/hash semantics and the authoritative bootstrap override. It no longer opens a root-redirect frame underneath an already-loaded page.
- Add an invariant test across every non-standalone navigation route and Library subtab, plus cold-entry, frame identity, and fallback URL regressions.

No authorization, data, schema, native cache, draft ownership, or timeout budgets change. Cold entry now uses the existing active-first shell/data path; it eliminates duplicate nested shell/bootstrap work. It adds no polling, recovery timer, automatic repeated fetch, or new dependency. No production latency percentile claim is made.

## Validation and release

All 1,065 tests passed, as did changed-file ESLint, diff whitespace checks, and the production Webpack build (compilation, TypeScript, and page generation). The authenticated post-deployment cold-entry result is recorded in the task. Physical iPhone/Safari/PWA verification remains distinct from desktop Safari evidence.

Rollback is a revert of this change; no database migration or stored-data conversion is involved.
