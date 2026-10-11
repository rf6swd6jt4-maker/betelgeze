import { deviceCommunicationMessageFromRow } from "@/lib/communications/progressive-server"
import { communicationDeviceId, deviceReadError, validateCommunicationReadProtocol } from "@/lib/communications/device-server"
import { withChatPerformance } from "@/lib/communications/performance-server"
import { requireCommunicationsWorkspace } from "@/lib/communications/workspace-access"
import { UUID_PATTERN } from "@/lib/push/device"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { nativeMessageFromRow } from "@/lib/teams/server"

export const dynamic = "force-dynamic"
async function handleGET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireCommunicationsWorkspace(workspaceSlug)
    const readProtocol = validateCommunicationReadProtocol(request, workspace.id, user.id)
    if (readProtocol instanceof Response) return readProtocol
    if (readProtocol !== "device-v1") return Response.json({ error: "Progressive previews require device unread counts." }, { status: 400 })
    const params = new URL(request.url).searchParams
    const kind = params.get("kind")
    const ids = (params.get("ids") ?? "").split(",")
    if ((kind !== "client" && kind !== "native") || !ids.length || ids.length > 20 || new Set(ids).size !== ids.length || ids.some((id) => !UUID_PATTERN.test(id))) return Response.json({ error: "Invalid preview batch." }, { status: 400 })
    const deviceId = await communicationDeviceId()
    if (!deviceId) return deviceReadError({ code: "P0002" })
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc("communication_device_preview_batch", { p_workspace_id: workspace.id, p_device_id: deviceId, p_kind: kind, p_ids: ids })
    if (error || !data || data.deviceId !== deviceId || !Array.isArray(data.items)) return deviceReadError(error)
    const items = data.items.map((item: Record<string, unknown>) => ({ ...item, preview: item.preview === null ? null : kind === "client" ? deviceCommunicationMessageFromRow(item.preview) : nativeMessageFromRow(item.preview) }))
    if (items.length !== ids.length || data.items.some((item: Record<string, unknown>, index: number) => item.conversationId !== ids[index] || item.cursorKnown !== true || !Object.hasOwn(item, "deviceCursor") || (item.preview !== null && !items[index].preview))) return deviceReadError(null)
    return Response.json({ readProtocol, deviceId, items }, { headers: { "Cache-Control": "private, no-store" } })
}
export const GET = withChatPerformance("message.receive", handleGET)
