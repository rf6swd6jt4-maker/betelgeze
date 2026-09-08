import { requireWorkspace } from "@/lib/workspaces"
export async function POST(_: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    await requireWorkspace(workspaceSlug, "admin")
    return Response.json({ error: "Client teams are assembled during POS. Configure operational roles in Settings → Teams." }, { status: 409 })
}
