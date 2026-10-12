import { markChatBoundary } from "@/lib/communications/performance-server"
import { communicationDeviceId, DeviceCommunicationError, type DeviceReadPosition } from "@/lib/communications/device-server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { communicationMessageFromRow } from "@/lib/communications/server"
import { nativeMessageFromRow } from "@/lib/teams/server"
import type { CommunicationMessage, CommunicationDelivery } from "@/lib/communications/types"

function row(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function nullableText(value: unknown) { return typeof value === "string" ? value : null }
export function deviceCommunicationMessageFromRow(value: unknown) {
    const message = communicationMessageFromRow(value)
    if (!message) return null
    const deliveries = row(value).deliveries
    return { ...message, deliveries: (Array.isArray(deliveries) ? deliveries : []).flatMap((value): CommunicationDelivery[] => {
        const delivery = row(value)
        if (delivery.provider !== "meta_whatsapp" && delivery.provider !== "twilio_sms") return []
        return [{ provider: delivery.provider, providerMessageId: nullableText(delivery.provider_message_id), status: nullableText(delivery.status) ?? "sending", error: nullableText(delivery.error), sentAt: nullableText(delivery.sent_at), deliveredAt: nullableText(delivery.delivered_at), readAt: nullableText(delivery.read_at), failedAt: nullableText(delivery.failed_at) }]
    }) }
}

async function deviceRpc(name: string, workspaceId: string, args: Record<string, unknown>) {
    const deviceId = await communicationDeviceId()
    if (!deviceId) throw new DeviceCommunicationError("P0002")
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc(name, { p_workspace_id: workspaceId, p_device_id: deviceId, ...args })
    if (error || !data || data.deviceId !== deviceId) throw new DeviceCommunicationError(error?.code ?? "invalid_response")
    return data
}

export async function loadDeviceCommunicationRoster(workspaceId: string, kind: "client" | "native") {
    const data = await deviceRpc("communication_device_roster", workspaceId, { p_kind: kind })
    return data as { deviceId: string; items: Array<{ conversationId: string; latestMessageAt: string | null; latestMessageId: string | null }> }
}

type DeviceHistory<T> = { readProtocol: "device-v1"; deviceId: string; cursorKnown: true; deviceCursor: DeviceReadPosition | null; messages: T[]; schemaReady: true; hasMore: boolean }
export function loadDeviceCommunicationHistory(workspaceId: string, kind: "client", conversationId: string): Promise<DeviceHistory<CommunicationMessage>>
export function loadDeviceCommunicationHistory(workspaceId: string, kind: "native", conversationId: string): Promise<DeviceHistory<import("@/lib/teams/types").NativeMessage>>
export async function loadDeviceCommunicationHistory(workspaceId: string, kind: "client" | "native", conversationId: string): Promise<DeviceHistory<CommunicationMessage | import("@/lib/teams/types").NativeMessage>> {
    const data = await deviceRpc("communication_device_history", workspaceId, { p_kind: kind, p_conversation_id: conversationId })
    markChatBoundary("history_ready")
    if (data.cursorKnown !== true || !Object.hasOwn(data, "deviceCursor") || !Array.isArray(data.messages)) throw new Error("Invalid device history response.")
    return {
        readProtocol: "device-v1" as const, deviceId: data.deviceId as string, cursorKnown: true as const,
        deviceCursor: data.deviceCursor as DeviceReadPosition | null,
        messages: kind === "client" ? [...data.messages].reverse().flatMap((value: unknown) => deviceCommunicationMessageFromRow(value) ?? []) : [...data.messages].reverse().flatMap((value: unknown) => nativeMessageFromRow(value) ?? []),
        schemaReady: true, hasMore: data.messages.length >= (kind === "client" ? 500 : 60),
    }
}
