export const ATTACHMENT_PAGE_SIZE = 20
export type AttachmentPosition = { at: string; id: string }
export type AttachmentCursor = { asset: AttachmentPosition | null; note: AttachmentPosition | null }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function decodeAttachmentCursor(raw?: string | null): AttachmentCursor | undefined {
    if (!raw) return undefined
    if (raw.length > 1200) throw new Error("Invalid attachment page")
    let cursor: AttachmentCursor
    try { cursor = JSON.parse(Buffer.from(raw, "base64url").toString()) } catch { throw new Error("Invalid attachment page") }
    if (!cursor || typeof cursor !== "object" || !["asset", "note"].every(key => {
        const value = cursor[key as keyof AttachmentCursor]
        return value === null || (value && typeof value.at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.at) && Number.isFinite(Date.parse(value.at)) && uuid.test(value.id))
    })) throw new Error("Invalid attachment page")
    return cursor
}
export function encodeAttachmentCursor(cursor: AttachmentCursor) {
    return cursor.asset || cursor.note ? Buffer.from(JSON.stringify(cursor)).toString("base64url") : null
}
export function attachmentPageRows<T extends { id: string; at: string }>(rows: T[]) {
    const items = rows.slice(0, ATTACHMENT_PAGE_SIZE)
    const last = items.at(-1)
    return { items, next: rows.length > ATTACHMENT_PAGE_SIZE && last ? { id: last.id, at: last.at } : null }
}
export function attachmentCursorFilter(position: AttachmentPosition, dateColumn: string, idColumn: string) {
    return `${dateColumn}.lt.${position.at},and(${dateColumn}.eq.${position.at},${idColumn}.lt.${position.id})`
}
export function attachmentSearch(value: string) {
    if (value.length > 120) throw new Error("Keep attachment searches under 120 characters")
    return value.trim().replace(/[\\%_]/g, char => `\\${char}`)
}
