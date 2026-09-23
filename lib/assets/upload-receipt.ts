import { createHmac, timingSafeEqual } from "node:crypto"
export const MANUAL_ASSET_LIMIT = 500 * 1024 * 1024
export type AssetUploadReceipt = { id: string; workspaceId: string; userId: string; path: string; name: string; size: number; type: string; kind: "file" | "media" | "document"; expires: number }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function assetUploadPath(workspaceId: string, userId: string, id: string) { return `${workspaceId}/assets/${userId}/${id}/original` }
const mac = (body: string, secret: string) => createHmac("sha256", secret).update(`manual-asset-v1:${body}`).digest()
export function signAssetUploadReceipt(receipt: AssetUploadReceipt, secret: string) {
    const body = Buffer.from(JSON.stringify(receipt)).toString("base64url")
    return `${body}.${mac(body, secret).toString("base64url")}`
}
export function readAssetUploadReceipt(value: unknown, secret: string, workspaceId: string, userId: string, now = Date.now(), allowExpired = false): AssetUploadReceipt {
    if (typeof value !== "string" || value.length > 6000) throw new Error("A verified upload receipt is required. Keep your draft and reload the uploader.")
    const [body, signature, extra] = value.split(".")
    const actual = Buffer.from(signature ?? "", "base64url"), expected = mac(body, secret)
    if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid upload receipt.")
    let receipt: AssetUploadReceipt
    try { receipt = JSON.parse(Buffer.from(body, "base64url").toString()) } catch { throw new Error("Invalid upload receipt.") }
    if (!receipt || receipt.workspaceId !== workspaceId || receipt.userId !== userId || !uuid.test(receipt.id) || receipt.path !== assetUploadPath(workspaceId, userId, receipt.id)
        || !Number.isSafeInteger(receipt.size) || receipt.size <= 0 || receipt.size > MANUAL_ASSET_LIMIT || typeof receipt.name !== "string" || !receipt.name || receipt.name.length > 240
        || typeof receipt.type !== "string" || !receipt.type || receipt.type.length > 200 || !["file", "media", "document"].includes(receipt.kind)
        || !Number.isFinite(receipt.expires) || (!allowExpired && receipt.expires <= now)) throw new Error("This upload receipt is invalid, expired or belongs to another account.")
    return receipt
}
export function assertUploadedAsset(receipt: AssetUploadReceipt, object: { ContentLength?: number; ContentType?: string; ETag?: string }) {
    if (object.ContentLength !== receipt.size || object.ContentType !== receipt.type || !object.ETag) throw new Error("The uploaded file could not be verified. Retry the upload before saving.")
}
