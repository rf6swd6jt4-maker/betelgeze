import { matchingConversationPreviewIds } from "@/lib/communications/preview-search"
import { communicationDeviceId, deviceReadError, validateCommunicationReadProtocol } from "@/lib/communications/device-server"
import { withChatPerformance } from "@/lib/communications/performance-server"
import { requireCommunicationsWorkspace } from "@/lib/communications/workspace-access"
import { UUID_PATTERN } from "@/lib/push/device"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
async function handleGET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireCommunicationsWorkspace(workspaceSlug)
    const readProtocol = validateCommunicationReadProtocol(request, workspace.id, user.id)
    if (readProtocol instanceof Response) return readProtocol
    if (readProtocol !== "device-v1") return Response.json({ error: "Progressive search requires device unread counts." }, { status: 400 })
    const params = new URL(request.url).searchParams
    const kind = params.get("kind"), search = params.get("search") ?? "", after = params.get("after")
    if ((kind !== "client" && kind !== "native") || !search.trim() || search.length > 120 || (after && !UUID_PATTERN.test(after))) return Response.json({ error: "Invalid search." }, { status: 400 })
    const deviceId = await communicationDeviceId()
    if (!deviceId) return deviceReadError({ code: "P0002" })
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc("communication_device_preview_search", { p_workspace_id: workspace.id, p_device_id: deviceId, p_kind: kind, p_search: search, p_after: after || null })
    if (error || !data || data.deviceId !== deviceId) return deviceReadError(error)
    if (!Array.isArray(data.candidates) || data.candidates.length > 20 || data.candidates.some((candidate: Record<string, unknown>) => typeof candidate.conversationId !== "string" || !UUID_PATTERN.test(candidate.conversationId) || typeof candidate.body !== "string") || !(data.nextCursor === null || (typeof data.nextCursor === "string" && UUID_PATTERN.test(data.nextCursor)))) return deviceReadError(null)
    return Response.json({ readProtocol, deviceId, conversationIds: matchingConversationPreviewIds(data.candidates, search), nextCursor: data.nextCursor }, { headers: { "Cache-Control": "private, no-store" } })
}
export const GET = withChatPerformance("message.receive", handleGET)
