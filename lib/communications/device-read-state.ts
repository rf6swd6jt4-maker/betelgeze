// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { normalizeChatReadUpdate, type ChatReadUpdate } from "./read-state.ts"

export type DeviceChatReadUpdate = ChatReadUpdate & { deviceId: string }
const eventName = "betelgeze:device-chat-read:v1"
const channelName = (workspaceId: string, userId: string) => `${eventName}:${workspaceId}:${userId}`
const eventHost = () => window.top ?? window

export function normalizeDeviceChatRead(workspaceId: string, userId: string, deviceId: string, value: unknown): DeviceChatReadUpdate | null {
    if (!deviceId || !value || typeof value !== "object") return null
    const row = value as Partial<DeviceChatReadUpdate>
    if (row.deviceId !== undefined && row.deviceId !== deviceId) return null
    const read = normalizeChatReadUpdate({ workspaceId, userId, kind: row.kind! }, value)
    return read ? { ...read, deviceId } : null
}

/** Device acknowledgements never share the legacy account-receipt namespace. */
export function publishDeviceChatRead(update: DeviceChatReadUpdate) {
    const confirmed = normalizeDeviceChatRead(update.workspaceId, update.userId, update.deviceId, update)
    if (!confirmed) return
    eventHost().dispatchEvent(new CustomEvent(eventName, { detail: confirmed }))
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(channelName(update.workspaceId, update.userId))
    channel.postMessage(confirmed)
    channel.close()
}

/** The owner also checks deviceId against its current authenticated summary. */
export function subscribeDeviceChatReads(workspaceId: string, userId: string, receive: (read: DeviceChatReadUpdate) => void) {
    const accept = (value: unknown) => {
        if (!value || typeof value !== "object") return
        const row = value as Partial<DeviceChatReadUpdate>
        if (row.workspaceId !== workspaceId || row.userId !== userId || typeof row.deviceId !== "string") return
        const confirmed = normalizeDeviceChatRead(workspaceId, userId, row.deviceId, value)
        if (confirmed) receive(confirmed)
    }
    const host = eventHost()
    const listener = (event: Event) => accept((event as CustomEvent).detail)
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName(workspaceId, userId))
    if (channel) channel.onmessage = event => accept(event.data)
    host.addEventListener(eventName, listener)
    return () => { host.removeEventListener(eventName, listener); channel?.close() }
}
