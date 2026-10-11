import { communicationDeviceId, deviceReadError, validateCommunicationReadProtocol } from "@/lib/communications/device-server"
import { withChatPerformance } from "@/lib/communications/performance-server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireCommunicationsWorkspace } from "@/lib/communications/workspace-access"

export const dynamic = "force-dynamic"

async function handleGET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireCommunicationsWorkspace(workspaceSlug)
    const supabase = await createSupabaseServerClient()
    const readProtocol = validateCommunicationReadProtocol(request, workspace.id, user.id)
    if (readProtocol instanceof Response) return readProtocol
    if (readProtocol === "device-v1") {
        const deviceId = await communicationDeviceId()
        if (!deviceId) return deviceReadError({ code: "P0002" })
        const { data, error } = await supabase.rpc("communication_device_unread_summary", { p_workspace_id: workspace.id, p_device_id: deviceId, p_include_cursors: false })
        if (error || !data || data.deviceId !== deviceId) return deviceReadError(error)
        return Response.json({ ...data, readProtocol }, { headers: { "Cache-Control": "private, no-store" } })
    }
    const { data, error } = await supabase.rpc("communication_unread_summary", { p_workspace_id: workspace.id })
    if (error) return Response.json({ error: "Unread counts are unavailable." }, { status: 503 })
    return Response.json({ conversations: data, readProtocol }, { headers: { "Cache-Control": "private, no-store" } })
}

export const GET = withChatPerformance("message.unread", handleGET)
