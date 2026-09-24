import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { createAttachmentUploadQueue } from "@/lib/communications/attachment-upload-queue"
import { teamBootstrap, clientBootstrap } from "./fullscreen-comms-preview-data"

const noopChannel = { on() { return this }, subscribe() { return this }, send: async () => "ok" }
const client = { channel: () => noopChannel, removeChannel: async () => "ok" }
export function useCommunicationsClient() { return client }
export const COMMUNICATIONS_RECOVERY_EVENT = "preview:communications-recover"
const broadcast = async () => true
export function useReliableCommunicationsRealtime({ active, register }: { active: boolean; register: (channel: RealtimeChannel) => RealtimeChannel }) {
    useEffect(() => {
        if (!active) return
        const handlers: { kind: string; table?: string; handle: (payload: unknown) => void }[] = []
        const channel = { ...noopChannel, on(kind: string, filter: { table?: string }, handle: (payload: unknown) => void) {
            handlers.push({ kind, table: filter.table, handle }); return this
        } }
        register(channel as unknown as RealtimeChannel)
        // Test-only delivery into the existing workspace callbacks. This is no
        // substitute for a real subscription or synchronization timing check.
        const receive = (event: Event) => {
            const detail = (event as CustomEvent<{ kind: string; table: string; payload: unknown }>).detail
            if (!detail) return
            for (const handler of handlers) if (handler.kind === detail.kind && handler.table === detail.table) handler.handle(detail.payload)
        }
        window.addEventListener("preview:realtime", receive)
        return () => window.removeEventListener("preview:realtime", receive)
    }, [active, register])
    return { state: "live", error: null, workspaceTabActive: true, sendBroadcast: broadcast }
}

// Local-only stand-in for durable delivery. It preserves the component's real
// enqueue/acknowledgement path while no provider or account is connected.
export function useOfflineChat(input: { kind: "native" | "client"; onMessage: (id: string, message: Record<string, unknown>) => void }) {
    const callbacks = useRef(input)
    useEffect(() => { callbacks.current = input }, [input])
    const queue = useCallback(async (id: string, _title: string, _payload: unknown, optimistic: Record<string, unknown>) => {
        const bootstrap = callbacks.current.kind === "native" ? teamBootstrap : clientBootstrap
        const conversation = bootstrap.conversations.find(c => c.id === id)
        const message = { ...optimistic, id: `preview-sent-${crypto.randomUUID()}` }
        if (conversation) conversation.messages.push(message as never)
        // A microtask acknowledgement can precede the caller's optimistic merge;
        // the production coordinator already retains authoritative IDs in that case.
        callbacks.current.onMessage(id, message)
    }, [])
    return { entries: [], queue }
}
export function useAttachmentUploads(_workspaceSlug: string, conversationId: string | null, native: boolean) {
    const [originals] = useState(() => new Set<string>())
    const [queue] = useState(() => createAttachmentUploadQueue({
        id: () => crypto.randomUUID(), revokePreview: url => URL.revokeObjectURL(url), remove: async (_conversationId, attachment) => {
            URL.revokeObjectURL(attachment.url)
            originals.delete(attachment.url)
        },
        async upload(item, signal, progress, setPreview) {
            signal.throwIfAborted()
            // The queue revokes its thumbnail after sending. The stand-in for
            // the uploaded original must retain a separate URL for the message.
            const url = URL.createObjectURL(item.file)
            originals.add(url)
            setPreview(URL.createObjectURL(item.file)); progress(100)
            return { kind: item.file.type.startsWith("image/") ? "image" : item.file.type.startsWith("video/") ? "video" : item.file.type.startsWith("audio/") ? "audio" : "document", fileName: item.file.name, mimeType: item.file.type || "application/octet-stream", size: item.file.size, storagePath: `preview-attachment-${item.id}`, url }
        },
    }, native ? 10 : 1))
    useEffect(() => {
        const urls = originals
        return () => { queue.dispose(); for (const url of urls) URL.revokeObjectURL(url); urls.clear() }
    }, [originals, queue])
    const summary = useSyncExternalStore(queue.subscribeSummary, () => queue.getSummary(conversationId), () => queue.getSummary(conversationId))
    return { queue, ...summary }
}
