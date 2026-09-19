import { NextResponse } from "next/server"
import { unstable_rethrow } from "next/navigation"
import { loadRelationshipLinks } from "@/lib/relationship-links"
import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" }
export async function GET(request: Request, { params }: { params: Promise<{ workspaceSlug: string; relationshipId: string }> }) {
    const { workspaceSlug, relationshipId } = await params
    try {
        const { workspace, user, access, role } = await requireWorkspacePanel(workspaceSlug, "relationships")
        await requireRelationshipAccess(access, relationshipId)
        if (request.headers.get("x-workspace-user") !== user.id) return NextResponse.json({ error: "Session changed" }, { status: 409, headers })
        if (role !== "owner" && role !== "admin") return NextResponse.json({ error: "Admin access required" }, { status: 403, headers })
        return NextResponse.json(await loadRelationshipLinks(workspace, relationshipId), { headers })
    } catch (error) {
        unstable_rethrow(error)
        return NextResponse.json({ error: "Links could not load" }, { status: 500, headers })
    }
}
