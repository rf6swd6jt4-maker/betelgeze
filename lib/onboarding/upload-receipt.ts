import { createHmac, timingSafeEqual } from "node:crypto"
import type { StoredUpload } from "./forms"

export type UploadReceiptScope = { workspaceId: string; relationshipId: string; sessionId: string; stepKey: string; fieldName: string }
const RECEIPT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

function signature(scope: UploadReceiptScope, upload: StoredUpload, issuedAt: number, key: string) {
    return createHmac("sha256", key).update(JSON.stringify([
        "onboarding-upload-v1", issuedAt, scope.workspaceId, scope.relationshipId, scope.sessionId, scope.stepKey, scope.fieldName,
        upload.path, upload.name, upload.size, upload.type, upload.provider ?? "r2",
    ])).digest("base64url")
}

export function signUploadReceipt(scope: UploadReceiptScope, upload: StoredUpload, key: string, now = Date.now()) {
    return `${now}.${signature(scope, upload, now, key)}`
}

export function validUploadReceipt(scope: UploadReceiptScope, upload: StoredUpload, key: string, now = Date.now()) {
    if (typeof upload.receipt !== "string") return false
    const [timestamp, mac, extra] = upload.receipt.split(".")
    const issuedAt = Number(timestamp)
    if (extra || !mac || !Number.isSafeInteger(issuedAt) || issuedAt > now || now - issuedAt > RECEIPT_LIFETIME_MS) return false
    const actual = Buffer.from(mac)
    const expected = Buffer.from(signature(scope, upload, issuedAt, key))
    return actual.length === expected.length && timingSafeEqual(actual, expected)
}
