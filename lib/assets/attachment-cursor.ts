import "server-only"

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { getRequiredEnv } from "@/lib/env"
import { decodeAttachmentCursor, encodeAttachmentCursor, type AttachmentCursor } from "@/lib/attachment-pages"

const prefix = "private1."
function key() { return createHash("sha256").update("library-attachment-cursor\0").update(getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY")).digest() }

/** Source-page progress can include denied IDs. Keep it opaque and scoped to its parent. */
export function encodePrivateAttachmentCursor(cursor: AttachmentCursor, scope: string) {
    const raw = encodeAttachmentCursor(cursor)
    if (!raw) return null
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv)
    cipher.setAAD(Buffer.from(scope))
    const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()])
    return prefix + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")
}

export function decodePrivateAttachmentCursor(raw: string | null | undefined, scope: string) {
    if (!raw) return undefined
    // Keep already-open pre-release pages usable. These old cursors only choose
    // a position; every requested candidate still passes current record RLS.
    if (!raw.startsWith(prefix)) return decodeAttachmentCursor(raw)
    if (raw.length > 2000) throw new Error("Invalid attachment page")
    try {
        const bytes = Buffer.from(raw.slice(prefix.length), "base64url")
        if (bytes.length < 29) throw new Error()
        const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12))
        decipher.setAAD(Buffer.from(scope))
        decipher.setAuthTag(bytes.subarray(12, 28))
        return decodeAttachmentCursor(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"))
    } catch { throw new Error("Invalid attachment page") }
}
