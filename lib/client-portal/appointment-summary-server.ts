import "server-only"
import { headers } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { appointmentSummary, appointmentSummaryHost, appointmentSummaryToken } from "./appointment-summary"

export async function loadAppointmentSummary(token: string) {
    const capability = appointmentSummaryToken(token)
    if (!capability) return { status: "unavailable" as const }
    const requestHeaders = await headers()
    const hostname = appointmentSummaryHost(requestHeaders.get("host"))
    const portalDomain = appointmentSummaryHost(requestHeaders.get("x-betelgeze-custom-client-portal-domain"))
    const workspaceSlug = requestHeaders.get("x-betelgeze-workspace-slug")
    // These internal headers are stripped and written by Proxy. The SQL reader
    // independently rechecks the current hostname, tenant and portal session.
    if (!hostname || hostname !== portalDomain || !workspaceSlug || !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(workspaceSlug)) return { status: "unavailable" as const }
    let result
    try {
        result = await supabaseAdmin.rpc("read_ghl_appointment_summary", {
            p_token: capability,
            p_workspace_slug: workspaceSlug,
            p_hostname: hostname,
        })
    } catch { return { status: "error" as const } }
    const { data, error } = result
    if (error) return { status: "error" as const }
    const summary = appointmentSummary(data)
    if (!summary) return { status: "unavailable" as const }
    const displayName = typeof data.agencyDisplayName === "string" && data.agencyDisplayName.trim()
        ? data.agencyDisplayName.trim().slice(0, 200)
        : typeof data.workspaceName === "string" ? data.workspaceName.slice(0, 200) : "Client portal"
    // Full portal entry was explicitly authorized. Keep the mapped session token
    // server-side until it reaches the same shell used by ordinary portal links.
    // Older RPCs still supply readable summaries but cannot authorize this entry.
    const portalSessionToken = appointmentSummaryToken(data.portalSessionToken) ?? undefined
    const snapshot = data.snapshot as Record<string, unknown>
    const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value)
    const initialAppointment = identifier(snapshot.id) && identifier(snapshot.calendarId)
        ? { id: snapshot.id, calendarId: snapshot.calendarId, summary }
        : undefined
    return { status: "ready" as const, summary, displayName, portalSessionToken, initialAppointment }
}
