import { requireWorkspace } from "@/lib/workspaces"
import { canAddSop } from "@/lib/sops/policy"
import { finishSopUpload, prepareSopUpload } from "@/lib/sops/server"
export const dynamic = "force-dynamic"
export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    const headers = { "Cache-Control": "private, no-store" }
    if (!canAddSop(role)) return Response.json({ error: "Only admins can add SOPs." }, { status: 403, headers })
    if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403, headers })
    const payload = await request.json().catch(() => null)
    try {
        if (payload?.action === "prepare") return Response.json(await prepareSopUpload(workspace.id, user.id, payload.file), { headers })
        if (payload?.action === "finish") return Response.json({ id: await finishSopUpload(workspace.id, user.id, payload.receipt) }, { headers })
        return Response.json({ error: "Invalid upload request." }, { status: 400, headers })
    } catch (error) {
        console.error("SOP upload failed", error instanceof Error ? error.name : "Unknown error")
        return Response.json({ error: error instanceof Error && !error.name.includes("S3") ? error.message : "Could not save the SOP. Please retry." }, { status: 400, headers })
    }
}
