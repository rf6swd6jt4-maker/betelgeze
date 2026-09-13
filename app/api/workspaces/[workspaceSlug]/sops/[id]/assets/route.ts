import { requireWorkspace } from "@/lib/workspaces"
import { canAddSop } from "@/lib/sops/policy"
import { prepareSopAssetUpload, finishSopAssetUpload } from "@/lib/sops/assets"
import { sopError, sopMutationOrigin, sopPayload, sopPrivateHeaders } from "@/lib/sops/http"
export const dynamic = "force-dynamic"
export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string; id: string }> }) {
    const { workspaceSlug, id } = await context.params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    if (!canAddSop(role) || !sopMutationOrigin(request)) return Response.json({ error: "Only admins can add assets." }, { status: 403, headers: sopPrivateHeaders })
    try {
        const payload = await sopPayload(request)
        if (payload?.action === "prepare") return Response.json(await prepareSopAssetUpload(workspace.id, user.id, id, payload), { headers: sopPrivateHeaders })
        if (payload?.action === "finish") return Response.json({ id: await finishSopAssetUpload(workspace.id, user.id, id, payload.receipt) }, { headers: sopPrivateHeaders })
        throw new Error("Invalid upload request.")
    } catch (error) { return sopError(error instanceof Error && error.name === "Error" ? error : null, "Could not upload the asset. Please retry.") }
}
