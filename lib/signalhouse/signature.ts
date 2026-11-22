import { createHmac, timingSafeEqual } from "node:crypto"

/** How old a signed delivery may be. SignalHouse signs each attempt afresh, so a real one is seconds old. */
export const SIGNALHOUSE_SIGNATURE_TOLERANCE_MS = 5 * 60_000

export type SignalHouseSignatureHeaders = {
    timestamp: string | null
    signature: string | null
    signatureV1: string | null
}

function hmac(secret: string, timestamp: string, rawBody: string) {
    return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
}

function sameHex(a: string, b: string) {
    if (!/^[0-9a-f]+$/i.test(a) || a.length !== b.length) return false
    return timingSafeEqual(Buffer.from(a.toLowerCase(), "hex"), Buffer.from(b.toLowerCase(), "hex"))
}

/**
 * Verifies a SignalHouse webhook delivery (https://app2.signalhouse.io/docs/webhook-signing): hex HMAC-SHA256 over
 * `${timestamp}.${rawBody}`, timestamp in Unix milliseconds. Prefers X-SignalHouse-Signature-V1 (`t=<ms>,v1=<hex>,...`,
 * one signature per valid secret during a rotation), falls back to X-SignalHouse-Signature with X-SignalHouse-Timestamp.
 * An unsigned or stale delivery is refused. `secrets` holds the current secret and, during a rotation, the previous one.
 */
export function verifySignalHouseSignature(input: { rawBody: string; headers: SignalHouseSignatureHeaders; secrets: string[]; now?: number }) {
    const secrets = input.secrets.filter(Boolean)
    if (!secrets.length) return { valid: false as const, reason: "no_secret" }
    let timestamp: string | null = null
    let candidates: string[] = []
    const v1 = input.headers.signatureV1?.trim()
    if (v1) {
        for (const part of v1.split(",")) {
            const [key, value] = part.split("=", 2).map(item => item?.trim() ?? "")
            if (key === "t") timestamp = value
            if (key === "v1" && value) candidates.push(value)
        }
    } else if (input.headers.signature && input.headers.timestamp) {
        timestamp = input.headers.timestamp.trim()
        candidates = [input.headers.signature.trim()]
    }
    if (!timestamp || !candidates.length) return { valid: false as const, reason: "unsigned" }
    if (!/^\d{10,16}$/.test(timestamp)) return { valid: false as const, reason: "bad_timestamp" }
    const age = Math.abs((input.now ?? Date.now()) - Number(timestamp))
    if (age > SIGNALHOUSE_SIGNATURE_TOLERANCE_MS) return { valid: false as const, reason: "stale" }
    for (const secret of secrets) {
        const expected = hmac(secret, timestamp, input.rawBody)
        if (candidates.some(candidate => sameHex(candidate, expected))) return { valid: true as const, reason: null }
    }
    return { valid: false as const, reason: "mismatch" }
}
