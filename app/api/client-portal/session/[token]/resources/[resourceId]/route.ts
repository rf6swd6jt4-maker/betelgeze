import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"
import { createPrivateResourceDownloadUrl } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(_request: Request, context: { params: Promise<{ token: string; resourceId: string }> }) {
    const { token, resourceId } = await context.params
    const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" }
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(resourceId)) return new Response("File not found", { status: 404, headers })
    const resolved = await resolveClientPortalAccessByToken(token)
    if (!resolved) return new Response("File not found", { status: 404, headers })
    const { data, error } = await supabaseAdmin.from("assets")
        .select("title, storage_path, asset_relationships!inner(relationship_id, workspace_id)")
        .eq("workspace_id", resolved.workspace.id).eq("id", resourceId).eq("native_kind", "client_portal_resource")
        .eq("asset_relationships.workspace_id", resolved.workspace.id).eq("asset_relationships.relationship_id", resolved.relationship.id).maybeSingle()
    if (error) return new Response("File temporarily unavailable", { status: 503, headers })
    if (!data?.storage_path?.startsWith(`${resolved.workspace.id}/client-portal/${resolved.relationship.id}/`)) return new Response("File not found", { status: 404, headers })
    try {
        // Large files go directly from private storage to the browser. The
        // short-lived signed response forces download, including for HTML/SVG.
        const location = await createPrivateResourceDownloadUrl(data.storage_path, data.title)
        return new Response(null, { status: 303, headers: { ...headers, Location: location } })
    } catch { return new Response("File temporarily unavailable", { status: 503, headers }) }
}
