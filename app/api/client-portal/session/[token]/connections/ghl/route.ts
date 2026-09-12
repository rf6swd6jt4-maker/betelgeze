import { handlePortalGhl } from "@/lib/client-portal/ghl-handler"
import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 30

async function handle(request: Request, context: { params: Promise<{ token: string }> }) {
    const { token } = await context.params
    return handlePortalGhl(request, token, {
        resolve: resolveClientPortalAccessByToken,
        rpc: (params) => supabaseAdmin.rpc("client_portal_ghl", params),
    })
}

export { handle as GET, handle as POST }
