import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, HeadObjectCommand, ListPartsCommand, UploadPartCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { getRequiredEnv } from "@/lib/env"
import { getR2BucketName, getR2Client } from "@/lib/onboarding/uploads"
import { MAX_PORTAL_RESOURCE_SIZE, PORTAL_UPLOAD_PART_SIZE, portalResourceFile } from "./resources"
import type { StoredUpload } from "@/lib/onboarding/forms"

export type ResourceScope = { workspaceId: string; relationshipId: string; sessionId: string }
export type ResourceUploadTicket = { path: string; uploadId: string; name: string; type: string; expectedSize: number | null; partSize: number; issuedAt: number; receipt: string }
const prefix = (scope: ResourceScope) => `${scope.workspaceId}/client-portal/${scope.relationshipId}/${scope.sessionId}/`
function signature(scope: ResourceScope, ticket: Omit<ResourceUploadTicket, "receipt">, key: string) {
    return createHmac("sha256", key).update(JSON.stringify(["portal-multipart-v1", scope.workspaceId, scope.relationshipId, scope.sessionId, ticket.path, ticket.uploadId, ticket.name, ticket.type, ticket.expectedSize, ticket.partSize, ticket.issuedAt])).digest("base64url")
}

export function validResourceTicket(value: unknown, scope: ResourceScope, key: string, now = Date.now()): value is ResourceUploadTicket {
    if (!value || typeof value !== "object") return false
    const ticket = value as ResourceUploadTicket
    if (typeof ticket.path !== "string" || !ticket.path.startsWith(prefix(scope)) || !/^multi-[a-f0-9-]{36}-[a-f0-9]{16}$/.test(ticket.path.slice(prefix(scope).length))
        || typeof ticket.uploadId !== "string" || !ticket.uploadId || ticket.uploadId.length > 2048
        || typeof ticket.name !== "string" || typeof ticket.type !== "string" || !portalResourceFile({ ...ticket, size: ticket.expectedSize ?? 0 })
        || (ticket.expectedSize !== null && (!Number.isSafeInteger(ticket.expectedSize) || ticket.expectedSize < 0))
        || !Number.isSafeInteger(ticket.partSize) || ticket.partSize < PORTAL_UPLOAD_PART_SIZE || ticket.partSize > 5 * 1024 ** 3
        || !Number.isSafeInteger(ticket.issuedAt) || ticket.issuedAt > now || now - ticket.issuedAt > 7 * 24 * 60 * 60 * 1000
        || typeof ticket.receipt !== "string") return false
    const actual = Buffer.from(ticket.receipt)
    const expected = Buffer.from(signature(scope, ticket, key))
    return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function startResourceMultipart(scope: ResourceScope, input: { name: string; type: string; size: number; folder: boolean; requestId: string }) {
    const file = portalResourceFile(input)
    if (!file || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.requestId)) throw new Error("Invalid upload")
    const expectedSize = input.folder ? null : file.size
    const fingerprint = createHash("sha256").update(JSON.stringify([file, input.folder])).digest("hex").slice(0, 16)
    const path = `${prefix(scope)}multi-${input.requestId.toLowerCase()}-${fingerprint}`
    // Keep normal transfers small in memory; increase parts only for very large selections.
    const partSize = Math.max(PORTAL_UPLOAD_PART_SIZE, Math.ceil(file.size / 9500 / 1024 ** 2) * 1024 ** 2)
    const result = await getR2Client().send(new CreateMultipartUploadCommand({ Bucket: getR2BucketName(), Key: path, ContentType: file.type }))
    if (!result.UploadId) throw new Error("Upload did not start")
    const ticket = { path, uploadId: result.UploadId, name: file.name, type: file.type, expectedSize, partSize, issuedAt: Date.now() }
    return { ...ticket, receipt: signature(scope, ticket, getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY")) }
}

export async function resourcePartUrl(ticket: ResourceUploadTicket, partNumber: number, size: number) {
    if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 10_000 || !Number.isSafeInteger(size) || size < 1 || size > ticket.partSize) throw new Error("Invalid upload part")
    return getSignedUrl(getR2Client(), new UploadPartCommand({ Bucket: getR2BucketName(), Key: ticket.path, UploadId: ticket.uploadId, PartNumber: partNumber, ContentLength: size }), { expiresIn: 15 * 60 })
}

export async function completeResourceMultipart(ticket: ResourceUploadTicket, size: number, partCount: number): Promise<StoredUpload> {
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PORTAL_RESOURCE_SIZE || (ticket.expectedSize !== null && ticket.expectedSize !== size)
        || !Number.isSafeInteger(partCount) || partCount < 1 || partCount > 10_000 || partCount !== Math.ceil(size / ticket.partSize)) throw new Error("Invalid upload size")
    const client = getR2Client()
    const Bucket = getR2BucketName()
    const stored: StoredUpload = { name: ticket.name, type: ticket.type, size, path: ticket.path, provider: "r2", kind: /^(image|video)\//.test(ticket.type) ? ticket.type.startsWith("image/") ? "image" : "video" : "document" }
    const alreadyComplete = async () => {
        try {
            const head = await client.send(new HeadObjectCommand({ Bucket, Key: ticket.path }))
            return head.ContentLength === size && head.ContentType === ticket.type
        } catch (error) {
            if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false
            throw error
        }
    }
    // A completion response or subsequent asset save can be lost after R2 succeeds.
    if (await alreadyComplete()) return stored
    const parts: { PartNumber: number; ETag: string; Size: number }[] = []
    let marker: string | undefined
    do {
        const page = await client.send(new ListPartsCommand({ Bucket, Key: ticket.path, UploadId: ticket.uploadId, PartNumberMarker: marker }))
        for (const part of page.Parts ?? []) {
            if (part.PartNumber === undefined || !part.ETag || part.Size === undefined) throw new Error("Incomplete upload")
            parts.push({ PartNumber: part.PartNumber, ETag: part.ETag, Size: part.Size })
        }
        marker = page.IsTruncated ? page.NextPartNumberMarker : undefined
        if (page.IsTruncated && !marker) throw new Error("Incomplete upload listing")
    } while (marker)
    if (parts.length !== partCount || parts.reduce((sum, part) => sum + part.Size, 0) !== size
        || parts.some((part, index) => part.PartNumber !== index + 1 || part.Size !== (index === parts.length - 1 ? size - index * ticket.partSize : ticket.partSize))) throw new Error("Incomplete upload")
    await client.send(new CompleteMultipartUploadCommand({ Bucket, Key: ticket.path, UploadId: ticket.uploadId, MultipartUpload: { Parts: parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })) } }))
    if (!await alreadyComplete()) throw new Error("Upload not yet available")
    return stored
}

export async function abortResourceMultipart(ticket: ResourceUploadTicket) {
    await getR2Client().send(new AbortMultipartUploadCommand({ Bucket: getR2BucketName(), Key: ticket.path, UploadId: ticket.uploadId }))
}
