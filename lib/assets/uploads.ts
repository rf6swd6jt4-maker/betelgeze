import "server-only"
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { getRequiredEnv } from "@/lib/env"
import { getR2BucketName, getR2Client } from "@/lib/onboarding/uploads"
import { assetUploadPath, assertUploadedAsset, MANUAL_ASSET_LIMIT, signAssetUploadReceipt, type AssetUploadReceipt } from "./upload-receipt"

export async function prepareAssetUpload(workspaceId: string, userId: string, id: string, file: { name: string; size: number; type: string }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !file.name || file.name.length > 240 || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MANUAL_ASSET_LIMIT || !file.type || file.type.length > 200) throw new Error("Choose a file no larger than 500MB with a valid name.")
    const receipt: AssetUploadReceipt = { ...file, id, workspaceId, userId, path: assetUploadPath(workspaceId, userId, id), kind: /^(image|video|audio)\//.test(file.type) ? "media" : /pdf|document|text\//.test(file.type) ? "document" : "file", expires: Date.now() + 86400000 }
    const uploadUrl = await getSignedUrl(getR2Client(), new PutObjectCommand({ Bucket: getR2BucketName(), Key: receipt.path, ContentType: file.type, ContentLength: file.size, IfNoneMatch: "*" }), { expiresIn: 900, signableHeaders: new Set(["content-type", "if-none-match"]) })
    // The signed condition cannot be removed: repeated PUTs cannot overwrite this key.
    return { uploadUrl, uploadHeaders: { "content-type": file.type, "if-none-match": "*" }, storedAsset: { ...file, path: receipt.path, kind: receipt.kind }, receipt: signAssetUploadReceipt(receipt, getRequiredEnv("R2_SECRET_ACCESS_KEY")) }
}
export async function verifyAssetUpload(receipt: AssetUploadReceipt) {
    const object = await getR2Client().send(new HeadObjectCommand({ Bucket: getR2BucketName(), Key: receipt.path }), { abortSignal: AbortSignal.timeout(15000) })
    assertUploadedAsset(receipt, object)
}
