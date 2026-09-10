import { appointmentDraftCommandIsSameOrigin, parseAppointmentDraftCommand } from "@/lib/appointment-draft-command"
import { saveAppointmentSettingDraft } from "@/lib/appointment-setting-commands"
import { unstable_rethrow } from "next/navigation"

export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string; relationshipId: string }> }) {
    if (!appointmentDraftCommandIsSameOrigin(request)) return Response.json({ ok: false, error: "Invalid save origin." }, { status: 403, headers })
    if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ ok: false, error: "Invalid save format." }, { status: 415, headers })
    if (Number(request.headers.get("content-length")) > 32_768) return Response.json({ ok: false, error: "The draft is too large." }, { status: 413, headers })
    let body: unknown
    try {
        const raw = await request.text()
        if (new TextEncoder().encode(raw).length > 32_768) return Response.json({ ok: false, error: "The draft is too large." }, { status: 413, headers })
        body = JSON.parse(raw)
    } catch { return Response.json({ ok: false, error: "Invalid save format." }, { status: 400, headers }) }
    const command = parseAppointmentDraftCommand(body)
    if (!command) return Response.json({ ok: false, error: "Invalid draft changes." }, { status: 400, headers })
    const { workspaceSlug, relationshipId } = await context.params
    const started = performance.now()
    try {
        // The same command implementation enforces session, MFA, panel,
        // relationship and service assignment checks for HTTP and actions.
        const result = await saveAppointmentSettingDraft(workspaceSlug, relationshipId, command.appointmentId, command.changes, command.expectedUpdatedAt, command)
        return Response.json(result, { status: result.ok ? 200 : result.conflict ? 409 : 400, headers: { ...headers, "Server-Timing": `commit;dur=${(performance.now() - started).toFixed(1)}` } })
    } catch (error) {
        unstable_rethrow(error)
        return Response.json({ ok: false, error: "The save could not be confirmed. Your changes are preserved for retry." }, { status: 503, headers })
    }
}
