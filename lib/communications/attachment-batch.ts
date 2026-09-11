import { communicationAttachmentFromValue } from "@/lib/communications/attachments"
import type { CommunicationAttachment } from "./types"

export const MAX_MESSAGE_ATTACHMENTS = 10

// Keep the first attachment at the root for existing encrypted JSON envelopes
// and compact inbox previews. Additional files share its message, never its key.
export function attachmentBatch(value: CommunicationAttachment | null | undefined): CommunicationAttachment[] {
    if (!value) return []
    const { additionalAttachments, ...first } = value
    return [first, ...(additionalAttachments ?? [])]
}

export function packAttachments(files: CommunicationAttachment[]): CommunicationAttachment | null {
    if (!files.length) return null
    const [first, ...rest] = files.map((file) => { const copy = { ...file }; delete copy.additionalAttachments; return copy })
    return rest.length ? { ...first, additionalAttachments: rest } : first
}

export function nativeAttachmentBatchFromValue(value: unknown): CommunicationAttachment | null {
    const first = communicationAttachmentFromValue(value)
    if (!first) return null
    const source = value as Record<string, unknown>
    if (source.additionalAttachments === undefined) return first
    if (!Array.isArray(source.additionalAttachments) || source.additionalAttachments.length >= MAX_MESSAGE_ATTACHMENTS) return null
    const files = [first]
    for (const raw of source.additionalAttachments) {
        if (!raw || typeof raw !== "object" || "additionalAttachments" in raw) return null
        const file = communicationAttachmentFromValue(raw)
        if (!file) return null
        files.push(file)
    }
    if (files.some((file) => file.kind === "sticker") || new Set(files.map((file) => file.storagePath)).size !== files.length) return null
    return packAttachments(files)
}
