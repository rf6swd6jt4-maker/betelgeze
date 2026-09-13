import { requireWorkspace } from "@/lib/workspaces"
import { canAddSop } from "@/lib/sops/policy"
import { updateSopRecord } from "@/lib/sops/records"
import { sopError, sopMutationOrigin, sopPayload, sopPrivateHeaders } from "@/lib/sops/http"
export const dynamic = "force-dynamic"
export async function PATCH(request: Request, context: { params: Promise<{ workspaceSlug: string; id: string }> }) {
    const { workspaceSlug, id } = await context.params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    if (!canAddSop(role) || !sopMutationOrigin(request)) return Response.json({ error: "Only admins can change SOPs." }, { status: 403, headers: sopPrivateHeaders })
    try { return Response.json({ version: await updateSopRecord(workspace.id, user.id, id, await sopPayload(request)) }, { headers: sopPrivateHeaders }) }
    catch (error) { return sopError(error, "Could not save the SOP.") }
}
