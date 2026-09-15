import { unstable_rethrow } from "next/navigation"
import { loadPersonalQueue } from "@/lib/work-queue/server"
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" }
export async function GET(request: Request, { params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const view = new URL(request.url).searchParams.get("view") === "deferred" ? "deferred" : "ready"
    const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0)
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000) return Response.json({ error: "Invalid page" }, { status: 400, headers })
    try {
        const snapshot = await loadPersonalQueue(workspaceSlug, offset, view)
        if (request.headers.get("x-workspace-user") !== snapshot.userId) return Response.json({ error: "Your session changed. Reload the workspace." }, { status: 409, headers })
        return Response.json(snapshot, { headers })
    } catch(error) {
        unstable_rethrow(error)
        return Response.json({ error: "Could not load the queue. Please retry." }, { status: 500, headers })
    }
}
