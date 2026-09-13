import { requireWorkspace } from "@/lib/workspaces"
import { getSop, sopDocumentUrl } from "@/lib/sops/server"
export const dynamic = "force-dynamic"
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string; id: string }> }) {
    const { workspaceSlug, id } = await context.params
    const { workspace } = await requireWorkspace(workspaceSlug)
    const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" }
    const sop = await getSop(workspace.id, id)
    if (!sop) return new Response("SOP not found", { status: 404, headers })
    return new Response(null, { status: 303, headers: { ...headers, Location: await sopDocumentUrl(sop, workspace.id, new URL(request.url).searchParams.get("download") === "1") } })
}
