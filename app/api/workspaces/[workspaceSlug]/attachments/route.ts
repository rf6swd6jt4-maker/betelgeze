import { NextResponse } from "next/server"
import { unstable_rethrow } from "next/navigation"
import { listAttachmentChoices, listRecordAttachments, type AttachmentOwner } from "@/lib/record-attachments"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { accessibleWorkItemIds, requireRelationshipAccess, requireWorkspaceAccess, workspaceAccessHasCapability } from "@/lib/workspace-access"

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(request: Request, { params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const query = new URL(request.url).searchParams
    const owner = query.get("owner") as AttachmentOwner
    const ownerId = query.get("ownerId") ?? ""
    if (!["relationship", "work-item", "note"].includes(owner) || !uuid.test(ownerId)) return NextResponse.json({ error: "Invalid attachment owner" }, { status: 400, headers: privateHeaders })
    try {
        const { workspace, user, access, role } = await requireWorkspaceAccess(workspaceSlug)
        if (request.headers.get("x-workspace-user") !== user.id) return NextResponse.json({ error: "Session changed" }, { status: 409, headers: privateHeaders })
        if (owner === "relationship") await requireRelationshipAccess(access, ownerId)
        let allowAssets = true
        if (owner === "work-item") {
            if (!workspaceAccessHasCapability(access, "fulfilment.manage") && !workspaceAccessHasCapability(access, "onboarding.manage")) return NextResponse.json({ error: "Work item access required" }, { status: 403, headers: privateHeaders })
            const ids = await accessibleWorkItemIds(access)
            if (ids && !ids.has(ownerId)) return NextResponse.json({ error: "Work item access required" }, { status: 403, headers: privateHeaders })
            const record = await supabaseAdmin.from("work_items").select("visibility").eq("workspace_id", workspace.id).eq("id", ownerId).maybeSingle()
            allowAssets = record.data?.visibility !== "admins_only"
            if (!record.data || (record.data.visibility === "admins_only" && role === "staff")) return NextResponse.json({ error: "Work item access required" }, { status: 403, headers: privateHeaders })
        }
        if (owner === "note") {
            if (!workspaceAccessHasCapability(access, "library.manage")) return NextResponse.json({ error: "Library access required" }, { status: 403, headers: privateHeaders })
            const record = await supabaseAdmin.from("notes").select("id").eq("workspace_id", workspace.id).eq("id", ownerId).maybeSingle()
            if (!record.data) return NextResponse.json({ error: "Note unavailable" }, { status: 404, headers: privateHeaders })
        }
        const page = query.get("view") === "choices"
            ? role !== "staff" ? await listAttachmentChoices(workspace.id, owner, ownerId, { cursor: query.get("cursor"), search: query.get("q") ?? "", allowAssets }) : { items: [], nextCursor: null }
            : await listRecordAttachments(workspace.id, owner, ownerId, { cursor: query.get("cursor"), workspaceSlug })
        return NextResponse.json(page, { headers: privateHeaders })
    } catch (error) {
        unstable_rethrow(error)
        return NextResponse.json({ error: "Attachments could not load" }, { status: 500, headers: privateHeaders })
    }
}
