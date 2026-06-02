import { createHmac, timingSafeEqual } from "node:crypto"
import { getRequiredEnv } from "@/lib/env"
import { toTwilioAddress } from "@/lib/client-messages/addresses"

type SendTwilioMessageInput = {
    to: string
    body: string
    from?: string | null
}

export function hasTwilioConfig() {
    return Boolean(
        process.env.TWILIO_ACCOUNT_SID &&
            process.env.TWILIO_AUTH_TOKEN &&
            process.env.TWILIO_FROM_ADDRESS
    )
}

export function validateTwilioSignature({
    authToken,
    signature,
    url,
    params,
}: {
    authToken: string
    signature: string
    url: string
    params: URLSearchParams
}) {
    const sortedParams = [...params.entries()].sort(([a], [b]) =>
        a.localeCompare(b)
    )

    const data = sortedParams.reduce(
        (current, [key, value]) => `${current}${key}${value}`,
        url
    )

    const expected = createHmac("sha1", authToken)
        .update(data)
        .digest("base64")

    const signatureBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)

    return (
        signatureBuffer.length === expectedBuffer.length &&
        timingSafeEqual(signatureBuffer, expectedBuffer)
    )
}

export async function sendTwilioMessage({
    to,
    body,
    from,
}: SendTwilioMessageInput) {
    const accountSid = getRequiredEnv("TWILIO_ACCOUNT_SID")
    const authToken = getRequiredEnv("TWILIO_AUTH_TOKEN")
    const fromAddress = from || getRequiredEnv("TWILIO_FROM_ADDRESS")

    const params = new URLSearchParams({
        To: toTwilioAddress(to),
        From: toTwilioAddress(fromAddress),
        Body: body,
    })

    const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
            method: "POST",
            headers: {
                Authorization: `Basic ${Buffer.from(
                    `${accountSid}:${authToken}`
                ).toString("base64")}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
        }
    )

    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            `Twilio message failed with ${response.status}: ${responseBody}`
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}
