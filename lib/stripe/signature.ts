import { createHmac, timingSafeEqual } from "crypto"

export function verifyStripeWebhookSignature({
    payload,
    signatureHeader,
    secret,
    toleranceSeconds = 300,
}: {
    payload: string
    signatureHeader: string | null
    secret: string
    toleranceSeconds?: number
}) {
    if (!signatureHeader) return false

    const parts = signatureHeader.split(",").reduce<Record<string, string[]>>(
        (accumulator, part) => {
            const [key, value] = part.split("=")

            if (key && value) {
                accumulator[key] = [...(accumulator[key] ?? []), value]
            }

            return accumulator
        },
        {}
    )
    const timestamp = parts.t?.[0]
    const signatures = parts.v1 ?? []

    if (!timestamp || signatures.length === 0) return false

    const timestampSeconds = Number(timestamp)

    if (
        !Number.isFinite(timestampSeconds) ||
        Math.abs(Date.now() / 1000 - timestampSeconds) > toleranceSeconds
    ) {
        return false
    }

    const expected = createHmac("sha256", secret)
        .update(`${timestamp}.${payload}`, "utf8")
        .digest("hex")

    return signatures.some((signature) => {
        const expectedBuffer = Buffer.from(expected)
        const signatureBuffer = Buffer.from(signature)

        if (expectedBuffer.length !== signatureBuffer.length) {
            timingSafeEqual(expectedBuffer, Buffer.alloc(expectedBuffer.length))
            return false
        }

        return timingSafeEqual(expectedBuffer, signatureBuffer)
    })
}
