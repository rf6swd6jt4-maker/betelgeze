import type { CommunicationAttachment } from "./types"

export type AttachmentUploadItem = {
    id: string
    conversationId: string
    file: File
    status: "queued" | "uploading" | "ready" | "error"
    progress: number
    previewUrl?: string
    attachment?: CommunicationAttachment
    error?: string
    locked?: boolean
}
export type AttachmentUploadSummary = { attachments: CommunicationAttachment[]; blocked: boolean; count: number }
const EMPTY: AttachmentUploadSummary = { attachments: [], blocked: false, count: 0 }

type Dependencies = {
    upload: (item: AttachmentUploadItem, signal: AbortSignal, progress: (value: number) => void, preview: (url: string) => void) => Promise<CommunicationAttachment>
    remove: (conversationId: string, attachment: CommunicationAttachment) => Promise<unknown>
    revokePreview: (url: string) => void
    id: () => string
}

/** One local decode/upload at a time. Progress subscribers never rerender chat history. */
export function createAttachmentUploadQueue(deps: Dependencies, limit = 10) {
    let items: AttachmentUploadItem[] = []
    let active: { id: string; controller: AbortController } | null = null
    let disposed = false
    const listeners = new Set<() => void>()
    const summaryListeners = new Set<() => void>()
    const summaries = new Map<string, AttachmentUploadSummary>()
    function emit(structural = true) {
        if (structural) {
            summaries.clear()
            for (const item of items) {
                const summary = summaries.get(item.conversationId) ?? { attachments: [], blocked: false, count: 0 }
                summary.count++
                if (item.status === "ready" && item.attachment) summary.attachments.push(item.attachment)
                else summary.blocked = true
                summaries.set(item.conversationId, summary)
            }
            summaryListeners.forEach((listener) => listener())
        }
        listeners.forEach((listener) => listener())
    }
    function patch(id: string, change: Partial<AttachmentUploadItem>, structural = true) {
        items = items.map((item) => item.id === id ? { ...item, ...change } : item)
        emit(structural)
    }
    const cleanup = (item: AttachmentUploadItem, deleteUpload: boolean) => {
        if (item.previewUrl) deps.revokePreview(item.previewUrl)
        if (deleteUpload && item.attachment) void deps.remove(item.conversationId, item.attachment).catch(() => undefined)
    }
    async function pump() {
        if (active || disposed) return
        const item = items.find((candidate) => candidate.status === "queued")
        if (!item) return
        const controller = new AbortController()
        active = { id: item.id, controller }
        patch(item.id, { status: "uploading", progress: 0, error: undefined })
        try {
            const attachment = await deps.upload(item, controller.signal,
                (progress) => { if (items.some((candidate) => candidate.id === item.id)) patch(item.id, { progress }, false) },
                (previewUrl) => {
                    const current = items.find((candidate) => candidate.id === item.id)
                    if (!current) { deps.revokePreview(previewUrl); return }
                    if (current.previewUrl) deps.revokePreview(current.previewUrl)
                    patch(item.id, { previewUrl }, false)
                })
            if (disposed || !items.some((candidate) => candidate.id === item.id)) await deps.remove(item.conversationId, attachment).catch(() => undefined)
            else patch(item.id, { status: "ready", attachment, progress: 100 })
        } catch (error) {
            if (!disposed && items.some((candidate) => candidate.id === item.id)) patch(item.id, { status: "error", error: error instanceof Error ? error.message : "Upload failed. Retry this file." })
        } finally { active = null; void pump() }
    }
    return {
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        subscribeSummary: (listener: () => void) => { summaryListeners.add(listener); return () => { summaryListeners.delete(listener) } },
        getSnapshot: () => items,
        getSummary: (conversationId: string | null) => conversationId ? summaries.get(conversationId) ?? EMPTY : EMPTY,
        add(conversationId: string, files: File[]) {
            if (disposed) return "Uploads are unavailable. Reopen this chat."
            const count = items.filter((item) => item.conversationId === conversationId).length
            if (count + files.length > limit) return `You can attach up to ${limit} files per message.`
            if (items.length + files.length > 50) return "Send or remove pending attachments in other chats first."
            items = [...items, ...files.map((file): AttachmentUploadItem => ({ id: deps.id(), conversationId, file, status: "queued", progress: 0 }))]
            emit(); void pump()
            return null
        },
        remove(id: string) {
            const item = items.find((candidate) => candidate.id === id)
            if (!item || item.locked) return
            items = items.filter((candidate) => candidate.id !== id)
            if (active?.id === id) active.controller.abort()
            cleanup(item, true); emit()
        },
        retry(id: string) {
            if (!items.some((item) => item.id === id && item.status === "error")) return
            patch(id, { status: "queued", progress: 0, error: undefined }); void pump()
        },
        hold(attachments: CommunicationAttachment[]) {
            const paths = new Set(attachments.map((attachment) => attachment.storagePath))
            const change = (locked: boolean) => {
                items = items.map((item) => item.attachment && paths.has(item.attachment.storagePath) ? { ...item, locked } : item)
                emit(false)
            }
            change(true)
            return () => change(false)
        },
        consume(conversationId: string, attachments: CommunicationAttachment[]) {
            const paths = new Set(attachments.map((attachment) => attachment.storagePath))
            items = items.filter((item) => {
                if (item.conversationId !== conversationId || !item.attachment || !paths.has(item.attachment.storagePath)) return true
                cleanup(item, false); return false
            })
            emit()
        },
        dispose() {
            disposed = true; active?.controller.abort()
            for (const item of items) cleanup(item, false)
            items = []; emit()
        },
    }
}
export type AttachmentUploadQueue = ReturnType<typeof createAttachmentUploadQueue>
