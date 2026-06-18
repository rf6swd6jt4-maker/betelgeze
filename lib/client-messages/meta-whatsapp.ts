import { getRequiredEnv } from "@/lib/env"
import { toMetaWhatsAppRecipient } from "@/lib/client-messages/addresses"
import { formatMetaWhatsAppApiError } from "@/lib/client-messages/meta-whatsapp-errors"

type SendMetaWhatsAppMessageInput = {
    to: string
    body: string
    replyToMessageId?: string | null
}

type SendMetaWhatsAppTemplateInput = {
    to: string
    templateName: string
    languageCode: string
    components?: unknown[]
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
    replyToMessageId,
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
                context: replyToMessageId
                    ? {
                          message_id: replyToMessageId,
                      }
                    : undefined,
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
            formatMetaWhatsAppApiError({
                action: "Meta WhatsApp message",
                status: response.status,
                responseBody,
            })
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

export async function sendMetaWhatsAppTemplate({
    to,
    templateName,
    languageCode,
    components,
}: SendMetaWhatsAppTemplateInput) {
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
                type: "template",
                template: {
                    name: templateName,
                    language: {
                        code: languageCode,
                    },
                    components:
                        components && components.length > 0
                            ? components
                            : undefined,
                },
            }),
        }
    )

    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            formatMetaWhatsAppApiError({
                action: "Meta WhatsApp template message",
                status: response.status,
                responseBody,
            })
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

export async function getMetaWhatsAppMedia(mediaId: string) {
    const phoneNumberId = getRequiredEnv("META_WHATSAPP_PHONE_NUMBER_ID")
    const accessToken = getRequiredEnv("META_WHATSAPP_ACCESS_TOKEN")
    const params = new URLSearchParams({
        phone_number_id: phoneNumberId,
    })

    const response = await fetch(
        `https://graph.facebook.com/v25.0/${mediaId}?${params.toString()}`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                accept: "application/json",
            },
        }
    )
    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            formatMetaWhatsAppApiError({
                action: "Meta WhatsApp media lookup",
                status: response.status,
                responseBody,
            })
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

export async function downloadMetaWhatsAppMedia(mediaUrl: string) {
    const accessToken = getRequiredEnv("META_WHATSAPP_ACCESS_TOKEN")
    const response = await fetch(mediaUrl, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    })

    if (!response.ok) {
        const responseBody = await response.text()

        throw new Error(
            formatMetaWhatsAppApiError({
                action: "Meta WhatsApp media download",
                status: response.status,
                responseBody,
            })
        )
    }

    return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType:
            response.headers.get("content-type") ??
            "application/octet-stream",
    }
}

export async function checkMetaWhatsAppAccess() {
    const phoneNumberId = getRequiredEnv("META_WHATSAPP_PHONE_NUMBER_ID")
    const accessToken = getRequiredEnv("META_WHATSAPP_ACCESS_TOKEN")
    const params = new URLSearchParams({
        fields: "id,display_phone_number,verified_name",
    })
    const response = await fetch(
        `https://graph.facebook.com/v25.0/${phoneNumberId}?${params.toString()}`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                accept: "application/json",
            },
        }
    )
    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            formatMetaWhatsAppApiError({
                action: "Meta WhatsApp connection check",
                status: response.status,
                responseBody,
            })
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}
