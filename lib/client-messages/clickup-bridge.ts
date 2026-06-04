import { supabaseAdmin } from "@/lib/supabase/admin"
import { sendMetaWhatsAppMessage } from "@/lib/client-messages/meta-whatsapp"
import { shouldIgnoreClickUpMessage } from "@/lib/client-messages/clickup-message-filters"

export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

type BridgeChannel = {
    id: string
    client_id: string
    external_address: string
}

type SendLoggedClickUpMessageToWhatsAppInput = {
    channel: BridgeChannel
    messageId?: string | null
    body: string
    rawPayload: JsonObject
}

type BridgeRequest = {
    headers: {
        get(name: string): string | null
    }
    url: string
}

export function isBridgeRequestAuthorized(
    request: BridgeRequest,
    { allowQuerySecret = false }: { allowQuerySecret?: boolean } = {}
) {
    const secret = process.env.CLIENT_MESSAGES_BRIDGE_SECRET

    if (!secret) return false

    const authorization = request.headers.get("authorization")
    const bridgeSecret = request.headers.get("x-bridge-secret")
    const querySecret = allowQuerySecret
        ? new URL(request.url).searchParams.get("secret")
        : null

    return (
        authorization === `Bearer ${secret}` ||
        bridgeSecret === secret ||
        querySecret === secret
    )
}

export function getByPath(payload: JsonValue, path: string) {
    return path.split(".").reduce<JsonValue | undefined>((current, key) => {
        if (!current || typeof current !== "object" || Array.isArray(current)) {
            return undefined
        }

        return current[key]
    }, payload)
}

export function firstString(payload: JsonValue, paths: string[]) {
    for (const path of paths) {
        const value = getByPath(payload, path)

        if (typeof value === "string" && value.trim()) {
            return value.trim()
        }

        if (typeof value === "number") {
            return String(value)
        }
    }

    return null
}

export function getMessagesFromResponse(response: JsonValue): JsonObject[] {
    const candidates = [
        response,
        getByPath(response, "data"),
        getByPath(response, "messages"),
        getByPath(response, "data.messages"),
    ]

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate.filter(
                (item): item is JsonObject =>
                    Boolean(item) &&
                    typeof item === "object" &&
                    !Array.isArray(item)
            )
        }
    }

    return []
}

export { shouldIgnoreClickUpMessage }


function stripBoldHeader(value: string) {
    return value.replace(/^\*\*[^*]+\*\*\s*/u, "").trim()
}

export async function wasClickUpMessageProcessed(messageId: string) {
    const { data: duplicate } = await supabaseAdmin
        .from("client_messages")
        .select("id")
        .eq("provider", "clickup_chat")
        .eq("provider_message_id", messageId)
        .maybeSingle()

    return Boolean(duplicate)
}

export async function isRecentInboundEcho({
    clientId,
    body,
}: {
    clientId: string
    body: string
}) {
    const { data: lastInbound } = await supabaseAdmin
        .from("client_messages")
        .select("body, created_at")
        .eq("client_id", clientId)
        .eq("direction", "inbound")
        .eq("provider", "meta_whatsapp")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

    if (!lastInbound) return false

    const twoMinutesAgo = Date.now() - 2 * 60 * 1000

    if (new Date(lastInbound.created_at).getTime() < twoMinutesAgo) {
        return false
    }

    const normalizedBody = body.trim()
    const normalizedBodyWithoutHeader = stripBoldHeader(normalizedBody)

    return (
        normalizedBody === lastInbound.body ||
        normalizedBodyWithoutHeader === lastInbound.body
    )
}

export async function sendLoggedClickUpMessageToWhatsApp({
    channel,
    messageId,
    body,
    rawPayload,
}: SendLoggedClickUpMessageToWhatsAppInput) {
    const { data: messageLog } = await supabaseAdmin
        .from("client_messages")
        .insert({
            client_id: channel.client_id,
            communication_channel_id: channel.id,
            direction: "outbound",
            provider: "clickup_chat",
            provider_message_id: messageId,
            clickup_message_id: messageId,
            to_address: channel.external_address,
            body,
            status: "sending",
            raw_payload: rawPayload,
        })
        .select("id")
        .single()

    try {
        const whatsappMessage = await sendMetaWhatsAppMessage({
            to: channel.external_address,
            body,
        })
        const whatsappMessageId = whatsappMessage?.messages?.[0]?.id

        await supabaseAdmin
            .from("client_messages")
            .update({
                status: "sent",
                provider_message_id: messageId ?? whatsappMessageId ?? null,
                clickup_message_id: messageId ?? null,
            })
            .eq("id", messageLog?.id)

        return {
            ok: true,
            messageLogId: messageLog?.id,
            whatsappMessageId,
        }
    } catch (error) {
        await supabaseAdmin
            .from("client_messages")
            .update({
                status: "send_failed",
                error:
                    error instanceof Error
                        ? error.message
                        : "Unknown Meta WhatsApp error",
            })
            .eq("id", messageLog?.id)

        return {
            ok: false,
            messageLogId: messageLog?.id,
            error,
        }
    }
}
