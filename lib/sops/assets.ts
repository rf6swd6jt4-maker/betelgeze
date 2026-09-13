import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getRequiredEnv } from "@/lib/env"
import { getR2BucketName, getR2Client } from "@/lib/onboarding/uploads"
import { ensurePlatformDirectUploads } from "@/lib/onboarding/r2-cors"
import { getSopAsset, getSopRecord } from "./records"
import { SOP_SOURCE_ROLES, validateSopAsset, validSopMediaRange, type SopSourceRole } from "./records-policy"
import { readSopAssetTicket, signSopAssetTicket, validSopAssetHeader, type SopAssetTicket } from "./asset-ticket"
const pathFor = (t: SopAssetTicket, pending = false) => `${t.workspaceId}/sops/${t.sopId}/${pending ? "pending" : "assets"}/${t.id}/original`
export async function prepareSopAssetUpload(workspaceId: string, userId: string, sopId: string, value: unknown) {
    const input = value as { file?: unknown; role?: SopSourceRole; notes?: unknown }
    const file = validateSopAsset(input?.file)
    if (!SOP_SOURCE_ROLES.includes(input.role!) || typeof input.notes !== "string" || input.notes.length > 2000) throw new Error("Choose an asset role and keep guidance under 2,000 characters.")
    const sop = await getSopRecord(workspaceId, sopId)
    if (!sop || sop.archived_at) throw new Error("This SOP is unavailable or archived.")
    const ticket: SopAssetTicket = { id: randomUUID(), workspaceId, userId, sopId, file, role: input.role!, notes: input.notes.trim(), expires: Date.now() + 24 * 60 * 60 * 1000 }
    await ensurePlatformDirectUploads()
    const uploadUrl = await getSignedUrl(getR2Client(), new PutObjectCommand({ Bucket: getR2BucketName(), Key: pathFor(ticket, true), ContentType: file.type, ContentLength: file.size }), { expiresIn: 15 * 60 })
    return { uploadUrl, file, receipt: signSopAssetTicket(ticket, getRequiredEnv("R2_SECRET_ACCESS_KEY")) }
}
export async function finishSopAssetUpload(workspaceId: string, userId: string, sopId: string, receipt: unknown) {
    const ticket = readSopAssetTicket(receipt, getRequiredEnv("R2_SECRET_ACCESS_KEY"), workspaceId, userId, sopId)
    if (await getSopAsset(workspaceId, sopId, ticket.id)) return ticket.id
    const client = getR2Client(), Bucket = getR2BucketName(), staging = pathFor(ticket, true)
    try {
        const head = await client.send(new HeadObjectCommand({ Bucket, Key: staging }))
        if (head.ContentLength !== ticket.file.size || head.ContentType !== ticket.file.type || !head.ETag) throw new Error("The upload is incomplete. Retry saving or select the file again.")
        // Version the destination by the verified object identity. Concurrent finalizers
        // that observe different staging bytes cannot overwrite the winning asset.
        const identity = createHash("sha256").update(head.ETag).digest("hex")
        const finalPath = `${workspaceId}/sops/${sopId}/assets/${ticket.id}/${identity}/original`
        const header = await client.send(new GetObjectCommand({ Bucket, Key: staging, Range: "bytes=0-1023", IfMatch: head.ETag }))
        const bytes = await header.Body?.transformToByteArray()
        if (!bytes || !validSopAssetHeader(ticket.file.type, bytes)) throw new Error("This file does not match its format. Choose the original file again.")
        await client.send(new CopyObjectCommand({ Bucket, Key: finalPath, CopySource: `${Bucket}/${staging}`, CopySourceIfMatch: head.ETag }))
        const { error } = await supabaseAdmin.rpc("attach_sop_upload", { p_workspace: workspaceId, p_actor: userId, p_sop: sopId, p_asset: ticket.id, p_title: ticket.file.name, p_type: ticket.file.type, p_size: ticket.file.size, p_path: finalPath, p_role: ticket.role, p_notes: ticket.notes })
        if (error) throw new Error("The file uploaded but could not be attached. Retry saving; archived SOPs must be restored first.")
        await client.send(new DeleteObjectCommand({ Bucket, Key: staging })).catch(() => undefined)
        return ticket.id
    } catch (error) {
        if (await getSopAsset(workspaceId, sopId, ticket.id)) return ticket.id
        throw error
    }
}
export function assertSopAssetPath(workspaceId: string, sopId: string, assetId: string, path: string) {
    const prefix = `${workspaceId}/sops/${sopId}/assets/${assetId}/`
    const canonical = path.startsWith(prefix) && /^[a-f0-9]{64}\/original$/.test(path.slice(prefix.length))
    const legacy = sopId === assetId && ["document.pdf", "document.docx"].some(name => path === `${workspaceId}/sops/${assetId}/${name}`)
    if (!canonical && !legacy) throw new Error("Invalid SOP asset location.")
}
export async function sopAssetUrl(workspaceId: string, sopId: string, assetId: string, download: boolean, resolved?: Awaited<ReturnType<typeof getSopAsset>>) {
    const linked = resolved ?? await getSopAsset(workspaceId, sopId, assetId)
    if (!linked) return null
    const asset = linked.asset
    assertSopAssetPath(workspaceId, sopId, assetId, asset.storage_path)
    const inline = !download && (asset.content_type === "application/pdf" || /^(image|video|audio)\//.test(asset.content_type))
    const name = encodeURIComponent(asset.title).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)
    return getSignedUrl(getR2Client(), new GetObjectCommand({ Bucket: getR2BucketName(), Key: asset.storage_path, ResponseContentType: inline ? asset.content_type : "application/octet-stream", ResponseContentDisposition: `${inline ? "inline" : "attachment"}; filename="asset"; filename*=UTF-8''${name}` }), { expiresIn: 60 })
}

export async function sopAssetResponse(workspaceId: string, sopId: string, assetId: string, request: Request) {
    const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" }
    const linked = await getSopAsset(workspaceId, sopId, assetId)
    if (!linked) return new Response("Asset not found", { status: 404, headers })
    const asset = linked.asset, download = new URL(request.url).searchParams.get("download") === "1"
    if (!download && /^(video|audio)\//.test(asset.content_type)) {
        assertSopAssetPath(workspaceId, sopId, assetId, asset.storage_path)
        let range: string | undefined
        try { range = validSopMediaRange(request.headers.get("range"), asset.file_size) }
        catch { return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${asset.file_size}` } }) }
        // Stream without buffering the original. Each seek re-enters the authenticated
        // route; playback does not depend on an expiring redirect URL.
        const object = await getR2Client().send(new GetObjectCommand({ Bucket: getR2BucketName(), Key: asset.storage_path, Range: range }), { abortSignal: request.signal })
        if (!object.Body) return new Response("Media unavailable", { status: 503, headers })
        return new Response(object.Body.transformToWebStream(), { status: object.ContentRange ? 206 : 200, headers: { ...headers, "Content-Type": asset.content_type, "Content-Disposition": "inline", "Accept-Ranges": "bytes", ...(object.ContentLength !== undefined ? { "Content-Length": String(object.ContentLength) } : {}), ...(object.ContentRange ? { "Content-Range": object.ContentRange } : {}) } })
    }
    const url = await sopAssetUrl(workspaceId, sopId, assetId, download, linked)
    return new Response(null, { status: 303, headers: { ...headers, Location: url! } })
}
