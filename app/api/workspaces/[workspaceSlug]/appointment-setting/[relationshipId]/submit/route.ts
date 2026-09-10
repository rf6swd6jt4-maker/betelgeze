import { unstable_rethrow } from "next/navigation"
import { appointmentDraftCommandIsSameOrigin, parseAppointmentSubmissionCommand } from "@/lib/appointment-draft-command"
import { submitAppointmentSettingAppointment } from "@/lib/appointment-setting-commands"

export const dynamic = "force-dynamic"
export const maxDuration = 60
const headers = { "Cache-Control": "private, no-store" }

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string; relationshipId: string }> }) {
    if (!appointmentDraftCommandIsSameOrigin(request)) return Response.json({ ok: false, error: "Invalid submission origin." }, { status: 403, headers })
    if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ ok: false, error: "Invalid submission format." }, { status: 415, headers })
    if (Number(request.headers.get("content-length")) > 2_048) return Response.json({ ok: false, error: "Invalid submission size." }, { status: 413, headers })
    let value: unknown
    try {
        const raw = await request.text()
        if (new TextEncoder().encode(raw).length > 2_048) return Response.json({ ok: false, error: "Invalid submission size." }, { status: 413, headers })
        value = JSON.parse(raw)
    } catch { return Response.json({ ok: false, error: "Invalid submission format." }, { status: 400, headers }) }
    const command = parseAppointmentSubmissionCommand(value)
    if (!command) return Response.json({ ok: false, error: "Invalid appointment submission." }, { status: 400, headers })
    const { workspaceSlug, relationshipId } = await context.params
    const started = performance.now()
    try {
        const result = await submitAppointmentSettingAppointment(workspaceSlug, relationshipId, command.appointmentId, command.expectedUpdatedAt, { expectedUserId: command.expectedUserId, revalidate: false })
        return Response.json(result, { status: result.ok ? 200 : result.conflict ? 409 : 400, headers: { ...headers, "Server-Timing": `commit;dur=${(performance.now() - started).toFixed(1)}` } })
    } catch (error) {
        unstable_rethrow(error)
        return Response.json({ ok: false, error: "Submission could not be confirmed. Check the appointment before retrying." }, { status: 503, headers })
    }
}
