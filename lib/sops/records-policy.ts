import { SOP_DOCX_TYPE, SOP_PDF_TYPE, type SopFile } from "./policy"
export const SOP_ASSET_PAGE_SIZE = 24
export const SOP_ASSET_NATIVE_KIND = "sop_asset"
export const SOP_SOURCE_ROLES = ["main", "supplement", "example", "revision", "reference"] as const
export type SopSourceRole = typeof SOP_SOURCE_ROLES[number]
export const SOP_SOURCE_LABELS: Record<SopSourceRole, string> = { main: "Main procedure", supplement: "Supporting guidance", example: "Example", revision: "Revision", reference: "Reference" }
const formats: Record<string, string> = {
    pdf: SOP_PDF_TYPE, docx: SOP_DOCX_TYPE, txt: "text/plain", md: "text/markdown", csv: "text/csv",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
export const SOP_ASSET_ACCEPT = Object.keys(formats).map(ext => `.${ext}`).join(",")
export type SopRecord = { id: string; title: string; description: string; version: number; archived_at: string | null; created_at: string; updated_at: string }
export type SopAsset = { asset_id: string; sop_id: string; role: SopSourceRole; notes: string; created_at: string; asset: { id: string; title: string; content_type: string; file_size: number } }
export type SopInterpretationSummary = { id: string; asset_id: string; status: "queued" | "running" | "ready" | "reviewed" | "failed"; error_summary: string | null; created_at: string; updated_at: string }
export function isSopId(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) }
export function validateSopRecord(value: unknown) {
    const input = value as { title?: unknown; description?: unknown } | null
    if (typeof input?.title !== "string" || !input.title.trim() || input.title.trim().length > 200) throw new Error("Give the SOP a name of up to 200 characters.")
    if (typeof input.description !== "string" || input.description.length > 5000) throw new Error("Keep the description under 5,000 characters.")
    return { title: input.title.trim(), description: input.description.trim() }
}
export function validateSopAsset(value: unknown): SopFile {
    const file = value as Partial<SopFile> | null
    if (!file || typeof file.name !== "string" || !file.name.trim() || file.name.length > 240 || /[\x00-\x1f/\\]/.test(file.name)) throw new Error("Choose a file with a valid name.")
    const type = formats[file.name.split(".").at(-1)?.toLowerCase() ?? ""]
    if (!type) throw new Error("Choose a supported document, image, video, audio or text file.")
    const max = /^(video|audio)\//.test(type) ? 250 * 1024 * 1024 : 50 * 1024 * 1024
    if (!Number.isSafeInteger(file.size) || file.size! <= 0 || file.size! > max) throw new Error(`Choose a non-empty file up to ${max / 1024 / 1024} MB.`)
    // Browser MIME values vary for office, text and media. The extension determines
    // the canonical type; finalization checks signature bytes before saving it.
    return { name: file.name.trim(), size: file.size!, type }
}
export function sopAssetKind(type: string) { return /^(image|video|audio)\//.test(type) ? "media" : "document" }
export function interpretationUnavailable(asset: { content_type: string; file_size: number }) {
    if (/^(video|audio)\//.test(asset.content_type)) return "Stored for viewing. Add a transcript as TXT or PDF to interpret its guidance."
    if (asset.file_size > 20 * 1024 * 1024) return "Stored for viewing. Interpretation currently supports files up to 20 MB."
    return null
}
export function validSopMediaRange(value: string | null, size: number): string | undefined {
    if (!value) return undefined
    const match = /^bytes=(\d*)-(\d*)$/.exec(value)
    if (!match || (!match[1] && !match[2])) throw new Error("Invalid byte range.")
    const start = match[1] ? Number(match[1]) : null, end = match[2] ? Number(match[2]) : null
    if ((start !== null && (!Number.isSafeInteger(start) || start < 0 || start >= size)) || (end !== null && (!Number.isSafeInteger(end) || end < 0)) || (start !== null && end !== null && end < start) || (start === null && end === 0)) throw new Error("Invalid byte range.")
    return value
}
