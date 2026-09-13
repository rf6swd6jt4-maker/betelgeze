export const SOP_NATIVE_KIND = "sop_document"
export const SOP_PAGE_SIZE = 24
export const MAX_SOP_BYTES = 50 * 1024 * 1024
export const SOP_PDF_TYPE = "application/pdf"
export const SOP_DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
export const SOP_ACCEPT = `.pdf,.docx,${SOP_PDF_TYPE},${SOP_DOCX_TYPE}`
export type SopFile = { name: string; size: number; type: string }
export type SopSummary = { id: string; title: string; content_type: string; file_size: number; created_at: string }
export function canAddSop(role: string) { return role === "owner" || role === "admin" }
export function validateSopFile(value: unknown): SopFile {
    const file = value as Partial<SopFile> | null
    if (!file || typeof file.name !== "string" || !file.name.trim() || file.name.length > 240 || /[\x00-\x1f/\\]/.test(file.name)) throw new Error("Choose a PDF or DOCX file with a valid file name.")
    if (!Number.isSafeInteger(file.size) || file.size! <= 0 || file.size! > MAX_SOP_BYTES) throw new Error("Choose a non-empty PDF or DOCX up to 50 MB.")
    const type = file.name.toLowerCase().endsWith(".pdf") ? SOP_PDF_TYPE : file.name.toLowerCase().endsWith(".docx") ? SOP_DOCX_TYPE : null
    if (!type || (file.type && file.type !== "application/octet-stream" && file.type !== type)) throw new Error("Only PDF and DOCX documents are supported.")
    return { name: file.name.trim(), size: file.size!, type }
}
export function sopFileSize(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB` }
export function sopCursor(value: string | undefined): { created_at: string; id: string } | null {
    if (!value) return null
    const [created_at, id, extra] = value.split("|")
    if (extra || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(created_at) || !Number.isFinite(Date.parse(created_at)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Invalid catalogue page.")
    return { created_at, id }
}
