import { appointmentSummary } from "./appointment-summary"

type Dependencies = {
    resolve: (token: string) => Promise<{ workspace: { id: string } } | null>
    rpc: (params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value)
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: {
    "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
} })

/** A portal session grants its own client's appointment read without requiring
 * WhatsApp sending, consent, a summary capability or a foreground provider call. */
export async function handlePortalAppointmentDetail(request: Request, token: string, appointmentId: string, deps: Dependencies) {
    const calendarId = new URL(request.url).searchParams.get("calendarId")
    if (!/^[a-f0-9]{64}$/i.test(token) || !identifier(appointmentId) || !identifier(calendarId)) return reply({ error: "This appointment is not available.", code: "invalid" }, 404)
    try {
        const access = await deps.resolve(token)
        if (!access) return reply({ error: "This appointment is not available.", code: "access" }, 404)
        const { data, error } = await deps.rpc({ p_session_token: token.toLowerCase(), p_workspace_id: access.workspace.id, p_calendar_id: calendarId, p_appointment_id: appointmentId })
        if (error) return reply({ error: "Appointment details could not load. Please try again.", code: "unavailable" }, 503)
        if (data && typeof data === "object" && (data as Record<string, unknown>).failure === "not_retained") return reply({ error: "The appointment details are being saved. Refresh the calendar, then try again.", code: "not_retained" }, 404)
        const summary = appointmentSummary(data)
        if (!summary) return reply({ error: "This appointment is not available.", code: "access" }, 404)
        return reply({ summary })
    } catch { return reply({ error: "Appointment details could not load. Please try again.", code: "unavailable" }, 503) }
}
