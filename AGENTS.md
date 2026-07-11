<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Shared UI vocabulary

Before adding pills, badges, tags, assignee treatments, labels, or statuses, read `docs/ui-standards.md` and use the primitives exported by `components/ui`. Do not invent page-local variants when a shared primitive covers the meaning. If the design language changes, update the primitive and the standards document so the change propagates consistently.
