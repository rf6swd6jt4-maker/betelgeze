import { handlePortalGhlCalendarNames } from "@/lib/client-portal/ghl-calendar-names-handler"
import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"
import { supabaseAdmin } from "@/lib/supabase/admin"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 30
export async function POST(request: Request, context: {params: Promise<{token: string}>}) {
    const {token} = await context.params
    return handlePortalGhlCalendarNames(request, token, {resolve: resolveClientPortalAccessByToken, rpc: params => supabaseAdmin.rpc("client_portal_ghl_calendar_names", params)})
}
