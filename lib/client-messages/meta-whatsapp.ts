import { getRequiredEnv } from "@/lib/env"
import { toMetaWhatsAppRecipient } from "@/lib/client-messages/addresses"

type SendMetaWhatsAppMessageInput = {
    to: string
    body: string
}

export function hasMetaWhatsAppConfig() {
    return Boolean(
        process.env.META_WHATSAPP_ACCESS_TOKEN &&
            process.env.META_WHATSAPP_PHONE_NUMBER_ID
    )
}

export async function sendMetaWhatsAppMessage({
    to,
    body,
}: SendMetaWhatsAppMessageInput) {
    const phoneNumberId = getRequiredEnv("META_WHATSAPP_PHONE_NUMBER_ID")
    const accessToken = getRequiredEnv("META_WHATSAPP_ACCESS_TOKEN")

    const response = await fetch(
        `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: toMetaWhatsAppRecipient(to),
                type: "text",
                text: {
                    preview_url: false,
                    body,
                },
            }),
        }
    )

    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            `Meta WhatsApp message failed with ${response.status}: ${responseBody}`
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}
