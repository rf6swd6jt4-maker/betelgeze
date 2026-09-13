import "server-only"
import { randomUUID } from "node:crypto"
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getRequiredEnv } from "@/lib/env"
import { getR2BucketName, getR2Client } from "@/lib/onboarding/uploads"
import { ensurePlatformDirectUploads } from "@/lib/onboarding/r2-cors"
import { SOP_NATIVE_KIND, SOP_PAGE_SIZE, SOP_PDF_TYPE, sopCursor, validateSopFile, type SopSummary } from "./policy"
import { readSopTicket, signSopTicket, type SopTicket } from "./ticket"
const fields = "id, title, content_type, file_size, created_at"
const pathFor = (ticket: SopTicket, staging = false) => `${ticket.workspaceId}/sops/${staging ? "pending/" : ""}${ticket.id}/${ticket.file.type === SOP_PDF_TYPE ? "document.pdf" : "document.docx"}`
export async function listSops(workspaceId: string, cursorValue?: string) {
    const cursor = sopCursor(cursorValue)
    let query = supabaseAdmin.from("assets").select(fields).eq("workspace_id", workspaceId).eq("native_kind", SOP_NATIVE_KIND)
    if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
    const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(SOP_PAGE_SIZE + 1)
    if (error) throw new Error("Could not load the SOP catalogue. Please try again.")
    const items = (data ?? []).slice(0, SOP_PAGE_SIZE) as SopSummary[]
    const last = items.at(-1)
    return { items, next: data && data.length > SOP_PAGE_SIZE && last ? `${last.created_at}|${last.id}` : null }
}
export async function getSop(workspaceId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null
    const { data, error } = await supabaseAdmin.from("assets").select(`${fields}, storage_path`).eq("workspace_id", workspaceId).eq("native_kind", SOP_NATIVE_KIND).eq("id", id).maybeSingle()
    if (error) throw new Error("Could not load this SOP.")
    return data as (SopSummary & { storage_path: string }) | null
}
export async function prepareSopUpload(workspaceId: string, userId: string, value: unknown) {
    const file = validateSopFile(value)
    const ticket: SopTicket = { id: randomUUID(), workspaceId, userId, file, expires: Date.now() + 24 * 60 * 60 * 1000 }
    await ensurePlatformDirectUploads()
    const uploadUrl = await getSignedUrl(getR2Client(), new PutObjectCommand({ Bucket: getR2BucketName(), Key: pathFor(ticket, true), ContentType: file.type, ContentLength: file.size }), { expiresIn: 15 * 60 })
    return { uploadUrl, file, receipt: signSopTicket(ticket, getRequiredEnv("R2_SECRET_ACCESS_KEY")) }
}
export async function finishSopUpload(workspaceId: string, userId: string, receipt: unknown) {
    const ticket = readSopTicket(receipt, getRequiredEnv("R2_SECRET_ACCESS_KEY"), workspaceId, userId)
    const existing = await getSop(workspaceId, ticket.id)
    if (existing) return existing.id // Lost acknowledgement and concurrent retries preserve one asset.
    try {
    return await persistSopUpload(ticket)
    } catch (error) {
        // Another finalizer may have committed and removed staging while this request was reading it.
        if (await getSop(workspaceId, ticket.id)) return ticket.id
        throw error
    }
}
async function persistSopUpload(ticket: SopTicket) {
    const { workspaceId, userId } = ticket
    const client = getR2Client(), Bucket = getR2BucketName(), staging = pathFor(ticket, true), finalPath = pathFor(ticket)
    const object = await client.send(new HeadObjectCommand({ Bucket, Key: staging }))
    if (object.ContentLength !== ticket.file.size || object.ContentType !== ticket.file.type || !object.ETag) throw new Error("The document upload is incomplete. Select the file again or retry saving.")
    const header = await client.send(new GetObjectCommand({ Bucket, Key: staging, Range: "bytes=0-1023", IfMatch: object.ETag }))
    const bytes = await header.Body?.transformToByteArray()
    const valid = bytes && (ticket.file.type === SOP_PDF_TYPE ? Buffer.from(bytes).includes(Buffer.from("%PDF-")) : bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4)
    if (!valid) throw new Error("The uploaded file does not match its document format.")
    // Browser credentials can write only the staging key, never the catalogue document.
    await client.send(new CopyObjectCommand({ Bucket, Key: finalPath, CopySource: `${Bucket}/${staging}`, CopySourceIfMatch: object.ETag }))
    const { error } = await supabaseAdmin.from("assets").insert({ id: ticket.id, workspace_id: workspaceId, title: ticket.file.name, asset_kind: "document", source_kind: "upload", native_kind: SOP_NATIVE_KIND, native_id: ticket.id, storage_path: finalPath, content_type: ticket.file.type, file_size: ticket.file.size, created_by: userId })
    if (error) {
        if (error.code !== "23505" || !await getSop(workspaceId, ticket.id)) throw new Error("The file uploaded, but the SOP could not be saved. Retry saving to recover it.")
    }
    // Cleanup failure must not turn a committed asset into an apparent failed upload.
    await client.send(new DeleteObjectCommand({ Bucket, Key: staging })).catch(() => undefined)
    return ticket.id
}
export async function sopDocumentUrl(asset: SopSummary & { storage_path: string }, workspaceId: string, download: boolean) {
    if (!asset.storage_path.startsWith(`${workspaceId}/sops/${asset.id}/`)) throw new Error("Invalid SOP document.")
    const name = encodeURIComponent(asset.title).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)
    const inline = !download && asset.content_type === SOP_PDF_TYPE
    return getSignedUrl(getR2Client(), new GetObjectCommand({ Bucket: getR2BucketName(), Key: asset.storage_path, ResponseContentType: inline ? SOP_PDF_TYPE : "application/octet-stream", ResponseContentDisposition: `${inline ? "inline" : "attachment"}; filename="SOP.${inline ? "pdf" : asset.content_type === SOP_PDF_TYPE ? "pdf" : "docx"}"; filename*=UTF-8''${name}` }), { expiresIn: 60 })
}
