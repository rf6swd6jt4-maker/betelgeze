import { NextResponse } from "next/server"
import { unstable_rethrow } from "next/navigation"
import { loadNativeLibrary } from "@/lib/workspace-native-library"

export async function GET(request: Request, { params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const query = new URL(request.url).searchParams
    const kind = query.get("kind")
    const id = query.get("id") ?? undefined
    if ((kind !== "assets" && kind !== "work-items") || (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
        return NextResponse.json({ error: "Invalid library panel." }, { status: 400, headers: { "Cache-Control": "private, no-store" } })
    }
    try {
        const snapshot = await loadNativeLibrary(workspaceSlug, kind, id)
        if (request.headers.get("x-workspace-user") !== snapshot.userId) return NextResponse.json({ error: "Your session changed. Reload the workspace." }, { status: 409, headers: { "Cache-Control": "private, no-store" } })
        return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } })
    } catch (error) {
        unstable_rethrow(error)
        return NextResponse.json({ error: "Could not load this panel. Please retry." }, { status: 500, headers: { "Cache-Control": "private, no-store" } })
    }
}
