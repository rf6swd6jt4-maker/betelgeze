import { type NextRequest } from "next/server"
import { portalAppointment } from "@/lib/client-portal/appointments"
import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
    const { token } = await context.params
    const resolved = await resolveClientPortalAccessByToken(token)
    const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" }
    if (!resolved) return Response.json({ error: "This portal link is no longer available." }, { status: 404, headers })
    const past = request.nextUrl.searchParams.get("view") === "past"
    const offset = Math.max(0, Math.min(100_000, Number(request.nextUrl.searchParams.get("offset")) || 0))
    let query = supabaseAdmin.from("appointment_setting_appointments")
        .select("id, contact_name, phone, appointment_at, appointment_timezone, meeting_medium, meeting_link, details, workflow_status")
        .eq("workspace_id", resolved.workspace.id).eq("relationship_id", resolved.relationship.id)
        .eq("workflow_status", "submitted")
    const now = new Date().toISOString()
    query = past ? query.lt("appointment_at", now) : query.gte("appointment_at", now)
    const { data, error } = await query.order("appointment_at", { ascending: !past }).order("id").range(Math.floor(offset), Math.floor(offset) + 25)
    if (error) return Response.json({ error: "Appointments could not be loaded. Please try again." }, { status: 503, headers })
    return Response.json({ appointments: (data ?? []).slice(0, 25).flatMap((row) => portalAppointment(row) ?? []), hasMore: (data?.length ?? 0) > 25 }, { headers })
}
