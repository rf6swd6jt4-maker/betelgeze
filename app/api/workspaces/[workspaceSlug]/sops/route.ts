import { requireWorkspace } from "@/lib/workspaces"
import { canAddSop } from "@/lib/sops/policy"
import { createSopRecord } from "@/lib/sops/records"
import { sopError, sopMutationOrigin, sopPayload, sopPrivateHeaders } from "@/lib/sops/http"
export const dynamic = "force-dynamic"
export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    if (!canAddSop(role) || !sopMutationOrigin(request)) return Response.json({ error: "Only admins can add SOPs." }, { status: 403, headers: sopPrivateHeaders })
    try { return Response.json({ id: await createSopRecord(workspace.id, user.id, await sopPayload(request)) }, { headers: sopPrivateHeaders }) }
    catch (error) { return sopError(error, "Could not create the SOP.") }
}
