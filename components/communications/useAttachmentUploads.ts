"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createAttachmentUploadQueue } from "@/lib/communications/attachment-upload-queue"
import { prepareCommunicationMedia } from "@/lib/communications/prepare-media"
import { uploadWithProgress } from "@/lib/communications/upload-progress"
import { validateNativeAttachmentFile } from "@/lib/communications/native-attachments"
import { validateCommunicationAttachmentFile } from "@/lib/communications/attachments"
import type { CommunicationAttachment } from "@/lib/communications/types"

export function useAttachmentUploads(workspaceSlug: string, conversationId: string | null, native: boolean) {
    const [queue] = useState(() => {
        const endpoint = `/api/workspaces/${workspaceSlug}/communications/${native ? "native/" : ""}attachments`
        const scope = (id: string) => native ? { conversationId: id } : { relationshipId: id }
        const remove = (id: string, attachment: CommunicationAttachment) => fetch(endpoint, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...scope(id), storagePath: attachment.storagePath }) })
        return createAttachmentUploadQueue({
            id: () => crypto.randomUUID(),
            revokePreview: (url) => URL.revokeObjectURL(url),
            remove,
            async upload(item, signal, progress, setPreview) {
                const validation = native ? validateNativeAttachmentFile(item.file) : validateCommunicationAttachmentFile(item.file)
                if (validation.error) throw new Error(validation.error)
                let attachment: CommunicationAttachment | undefined
                try {
                    const { preview, localPreview, ...media } = await prepareCommunicationMedia(item.file)
                    signal.throwIfAborted()
                    if (localPreview ?? preview) setPreview(URL.createObjectURL((localPreview ?? preview)!))
                    const response = await fetch(endpoint, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...scope(item.conversationId), name: item.file.name, size: item.file.size, type: item.file.type, media, previewSize: preview?.size }) })
                    const prepared = await response.json() as { uploadUrl?: string; previewUploadUrl?: string; uploadHeaders?: Record<string, string>; attachment?: CommunicationAttachment; error?: string }
                    if (!response.ok || !prepared.uploadUrl || !prepared.attachment) throw new Error(prepared.error ?? "Could not prepare attachment.")
                    attachment = prepared.attachment
                    await uploadWithProgress(prepared.uploadUrl, item.file, { "Content-Type": attachment.mimeType, ...prepared.uploadHeaders }, signal, (value) => progress(Math.round(value * 0.95)))
                    progress(95)
                    if (preview && prepared.previewUploadUrl) {
                        const result = await fetch(prepared.previewUploadUrl, { method: "PUT", signal, headers: { "Content-Type": "image/webp", ...prepared.uploadHeaders }, body: preview }).catch(() => null)
                        attachment.hasPreview = Boolean(result?.ok)
                    }
                    signal.throwIfAborted()
                    return attachment
                } catch (error) {
                    if (attachment) await remove(item.conversationId, attachment).catch(() => undefined)
                    throw error
                }
            },
        }, native ? 10 : 1)
    })
    const mounted = useRef(false)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            queueMicrotask(() => { if (!mounted.current) queue.dispose() })
        }
    }, [queue])
    const summary = useSyncExternalStore(queue.subscribeSummary, () => queue.getSummary(conversationId), () => queue.getSummary(conversationId))
    return { queue, ...summary }
}
