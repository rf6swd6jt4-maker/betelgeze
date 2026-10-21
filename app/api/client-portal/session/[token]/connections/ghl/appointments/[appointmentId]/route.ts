import { handlePortalAppointmentDetail } from "@/lib/client-portal/appointment-detail-handler"
import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export async function GET(request: Request, context: { params: Promise<{ token: string; appointmentId: string }> }) {
    const { token, appointmentId } = await context.params
    return handlePortalAppointmentDetail(request, token, appointmentId, {
        resolve: resolveClientPortalAccessByToken,
        rpc: params => supabaseAdmin.rpc("read_client_portal_ghl_appointment", params),
    })
}
