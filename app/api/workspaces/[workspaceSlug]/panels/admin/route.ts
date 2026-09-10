import { NextResponse } from "next/server"
import { unstable_rethrow } from "next/navigation"
import { loadNativeAdmin, loadNativeAdminTrends } from "@/lib/workspace-native-admin"

export async function GET(request: Request, { params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const query = new URL(request.url).searchParams
    const section = query.get("section") ?? "work"
    const id = query.get("id")
    if (!["work", "okrs", "okr-detail", "maintenance", "activity", "activity-detail", "activity-trends"].includes(section) || (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
        return NextResponse.json({ error: "Invalid Admin panel." }, { status: 400, headers: { "Cache-Control": "private, no-store" } })
    }
    try {
        const snapshot = section === "activity-trends" ? await loadNativeAdminTrends(workspaceSlug) : await loadNativeAdmin(workspaceSlug, section as Parameters<typeof loadNativeAdmin>[1], query)
        if (request.headers.get("x-workspace-user") !== snapshot.userId) return NextResponse.json({ error: "Your session changed. Reload the workspace." }, { status: 409, headers: { "Cache-Control": "private, no-store" } })
        return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } })
    } catch (error) {
        unstable_rethrow(error)
        return NextResponse.json({ error: "Could not load this panel. Please retry." }, { status: 500, headers: { "Cache-Control": "private, no-store" } })
    }
}
