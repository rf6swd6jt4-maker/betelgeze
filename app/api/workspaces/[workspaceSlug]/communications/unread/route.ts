import { communicationDeviceId } from "@/lib/communications/device-server"
import { withChatPerformance } from "@/lib/communications/performance-server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireCommunicationsWorkspace } from "@/lib/communications/workspace-access"

export const dynamic = "force-dynamic"

async function handleGET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace } = await requireCommunicationsWorkspace(workspaceSlug)
    const supabase = await createSupabaseServerClient()
    if (new URL(request.url).searchParams.get("scope") === "device") {
        const deviceId = await communicationDeviceId()
        if (!deviceId) return Response.json({ error: "This device is still being verified.", code: "device_not_ready" }, { status: 409 })
        const { data, error } = await supabase.rpc("communication_device_unread_summary", { p_workspace_id: workspace.id, p_device_id: deviceId, p_include_cursors: new URL(request.url).searchParams.get("cursors") === "1" })
        if (error?.code === "P0002") return Response.json({ error: "This device is still being verified.", code: "device_not_ready" }, { status: 409 })
        if (error || !data) return Response.json({ error: "Unread counts are unavailable." }, { status: error?.code === "42501" ? 403 : 503 })
        return Response.json(data, { headers: { "Cache-Control": "private, no-store" } })
    }
    // Already-open clients keep their account-level protocol during rollout.
    const { data, error } = await supabase.rpc("communication_unread_summary", { p_workspace_id: workspace.id })
    if (error) return Response.json({ error: "Unread counts are unavailable." }, { status: 503 })
    return Response.json({ conversations: data }, { headers: { "Cache-Control": "private, no-store" } })
}

export const GET = withChatPerformance("message.unread", handleGET)
