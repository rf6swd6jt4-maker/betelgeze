import { unstable_rethrow } from "next/navigation"
import { saveRelationshipBackgroundCommand } from "@/lib/relationship-background-server"
import { parseRelationshipBackgroundCommand, relationshipBackgroundCommandIsSameOrigin } from "@/lib/relationship-draft-command"

export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string; relationshipId: string }> }) {
    if (!relationshipBackgroundCommandIsSameOrigin(request)) return Response.json({ ok: false, error: "Invalid save origin." }, { status: 403, headers })
    if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ ok: false, error: "Invalid save format." }, { status: 415, headers })
    if (Number(request.headers.get("content-length")) > 131_072) return Response.json({ ok: false, error: "The relationship draft is too large." }, { status: 413, headers })
    let body: unknown
    try {
        const raw = await request.text()
        if (new TextEncoder().encode(raw).length > 131_072) return Response.json({ ok: false, error: "The relationship draft is too large." }, { status: 413, headers })
        body = JSON.parse(raw)
    } catch { return Response.json({ ok: false, error: "Invalid save format." }, { status: 400, headers }) }
    const command = parseRelationshipBackgroundCommand(body)
    if (!command) return Response.json({ ok: false, error: "Invalid relationship changes." }, { status: 400, headers })
    const { workspaceSlug, relationshipId } = await context.params
    const started = performance.now()
    try {
        const result = await saveRelationshipBackgroundCommand(workspaceSlug, relationshipId, command)
        return Response.json(result, { status: result.ok ? 200 : result.conflict ? 409 : 400, headers: { ...headers, "Server-Timing": `commit;dur=${(performance.now() - started).toFixed(1)}` } })
    } catch (error) {
        unstable_rethrow(error)
        return Response.json({ ok: false, error: "The relationship save could not be confirmed. Your draft is preserved for retry." }, { status: 503, headers })
    }
}
