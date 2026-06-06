import { NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import {
    formatClientInboundMessage,
    normalizeMessageAddress,
} from "@/lib/client-messages/addresses"
import { createClickUpChatMessage } from "@/lib/client-messages/clickup"
import {
    downloadMetaWhatsAppMedia,
    getMetaWhatsAppMedia,
} from "@/lib/client-messages/meta-whatsapp"
import { formatMediaMessageForClickUp } from "@/lib/client-messages/media-format"
import { storeClientMessageMedia } from "@/lib/onboarding/uploads"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type WhatsAppMediaPayload = {
    id?: string
    mime_type?: string
    sha256?: string
    caption?: string
    filename?: string
}

type WhatsAppMessage = {
    from?: string
    id?: string
    timestamp?: string
    type?: string
    text?: {
        body?: string
    }
    image?: WhatsAppMediaPayload
    video?: WhatsAppMediaPayload
    audio?: WhatsAppMediaPayload
    document?: WhatsAppMediaPayload
    sticker?: WhatsAppMediaPayload
}

type WhatsAppChangeValue = {
    metadata?: {
        display_phone_number?: string
    }
    messages?: WhatsAppMessage[]
}

type WhatsAppWebhookPayload = {
    entry?: Array<{
        changes?: Array<{
            value?: WhatsAppChangeValue
        }>
    }>
}

function getClickUpMessageId(response: unknown): string | null {
    if (!response || typeof response !== "object") return null

    const value = response as {
        id?: string
        data?: { id?: string }
        message?: { id?: string }
    }

    return value.id ?? value.data?.id ?? value.message?.id ?? null
}

type InboundMessageContent = {
    body: string
    clickupBody: string
    media?: {
        id: string
        type: string
        fileName: string
        mimeType: string
        storagePath: string
        url: string
    }
}

function getMessageTimestampMs(message: WhatsAppMessage) {
    const timestamp = Number(message.timestamp)

    return Number.isFinite(timestamp) ? timestamp * 1000 : Date.now()
}

function getMediaPayload(message: WhatsAppMessage) {
    switch (message.type) {
        case "image":
            return message.image ? { type: "image", media: message.image } : null
        case "video":
            return message.video ? { type: "video", media: message.video } : null
        case "audio":
            return message.audio ? { type: "audio", media: message.audio } : null
        case "document":
            return message.document
                ? { type: "document", media: message.document }
                : null
        case "sticker":
            return message.sticker
                ? { type: "sticker", media: message.sticker }
                : null
        default:
            return null
    }
}

function getExtensionFromMimeType(mimeType: string) {
    const extensionByMimeType: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "video/mp4": "mp4",
        "audio/aac": "aac",
        "audio/mp4": "m4a",
        "audio/mpeg": "mp3",
        "audio/ogg": "ogg",
        "application/pdf": "pdf",
        "text/plain": "txt",
    }

    return extensionByMimeType[mimeType.toLowerCase()] ?? "bin"
}

function titleCase(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1)
}

async function getInboundMessageContent({
    clientId,
    message,
    appBaseUrl,
}: {
    clientId: string
    message: WhatsAppMessage
    appBaseUrl: string
}): Promise<InboundMessageContent | null> {
    const textBody = message.text?.body?.trim()

    if (message.type === "text" && textBody) {
        return {
            body: textBody,
            clickupBody: textBody,
        }
    }

    const mediaPayload = getMediaPayload(message)

    if (!mediaPayload?.media.id) return null

    const mediaInfo = await getMetaWhatsAppMedia(mediaPayload.media.id)
    const mediaUrl =
        typeof mediaInfo?.url === "string" ? mediaInfo.url : null
    const mimeType =
        mediaPayload.media.mime_type ??
        (typeof mediaInfo?.mime_type === "string"
            ? mediaInfo.mime_type
            : "application/octet-stream")

    if (!mediaUrl) {
        throw new Error("Meta WhatsApp media lookup did not return a URL")
    }

    const downloadedMedia = await downloadMetaWhatsAppMedia(mediaUrl)
    const contentType =
        downloadedMedia.contentType === "application/octet-stream"
            ? mimeType
            : downloadedMedia.contentType
    const fileName =
        mediaPayload.media.filename ??
        `whatsapp-${mediaPayload.type}-${mediaPayload.media.id}.${getExtensionFromMimeType(contentType)}`
    const storedMedia = await storeClientMessageMedia({
        clientId,
        mediaId: mediaPayload.media.id,
        fileName,
        contentType,
        body: downloadedMedia.bytes,
        appBaseUrl,
    })
    const caption = mediaPayload.media.caption?.trim()
    const clickupBody = formatMediaMessageForClickUp({
        type: mediaPayload.type,
        url: storedMedia.url,
        caption,
    })

    return {
        body: caption
            ? `[${titleCase(mediaPayload.type)}] ${caption}`
            : `[${titleCase(mediaPayload.type)}] ${fileName}`,
        clickupBody,
        media: {
            id: mediaPayload.media.id,
            type: mediaPayload.type,
            fileName,
            mimeType: contentType,
            storagePath: storedMedia.path,
            url: storedMedia.url,
        },
    }
}

async function handleInboundMessage({
    message,
    value,
    payload,
    appBaseUrl,
}: {
    message: WhatsAppMessage
    value: WhatsAppChangeValue
    payload: WhatsAppWebhookPayload
    appBaseUrl: string
}) {
    const from = normalizeMessageAddress(`whatsapp:${message.from ?? ""}`)
    const to = value.metadata?.display_phone_number
        ? normalizeMessageAddress(`whatsapp:${value.metadata.display_phone_number}`)
        : null
    const messageId = message.id ?? null

    if (!from) return

    const { data: channel } = await supabaseAdmin
        .from("client_communication_channels")
        .select("id, client_id, clickup_workspace_id, clickup_channel_id")
        .eq("provider", "meta_whatsapp")
        .eq("external_address", from)
        .eq("is_active", true)
        .single()

    if (!channel) {
        await supabaseAdmin.from("client_messages").insert({
            direction: "inbound",
            provider: "meta_whatsapp",
            provider_message_id: messageId,
            from_address: from,
            to_address: to,
            body: `[Unsupported ${message.type ?? "message"}]`,
            status: "unmatched",
            raw_payload: payload,
        })

        return
    }

    const { data: existingMessage } = messageId
        ? await supabaseAdmin
              .from("client_messages")
              .select("id")
              .eq("provider", "meta_whatsapp")
              .eq("provider_message_id", messageId)
              .maybeSingle()
        : { data: null }

    if (existingMessage) return

    let content: InboundMessageContent | null = null

    try {
        content = await getInboundMessageContent({
            clientId: channel.client_id,
            message,
            appBaseUrl,
        })
    } catch (error) {
        const errorMessage =
            error instanceof Error
                ? error.message
                : "Unknown WhatsApp media error"

        await supabaseAdmin.from("client_messages").insert({
            client_id: channel.client_id,
            communication_channel_id: channel.id,
            direction: "inbound",
            provider: "meta_whatsapp",
            provider_message_id: messageId,
            from_address: from,
            to_address: to,
            body: `[${titleCase(message.type ?? "media")}]`,
            status: "media_failed",
            error: errorMessage,
            raw_payload: payload,
        })

        return
    }

    if (!content) return

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("name")
        .eq("id", channel.client_id)
        .single()

    const clientName = client?.name ?? "Client"
    const { data: lastMessage } = await supabaseAdmin
        .from("client_messages")
        .select("direction, provider, created_at")
        .eq("client_id", channel.client_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000
    const showClientName =
        !lastMessage ||
        lastMessage.direction !== "inbound" ||
        lastMessage.provider !== "meta_whatsapp" ||
        new Date(lastMessage.created_at).getTime() < tenMinutesAgo

    const { data: insertedMessage } = await supabaseAdmin
        .from("client_messages")
        .insert({
            client_id: channel.client_id,
            communication_channel_id: channel.id,
            direction: "inbound",
            provider: "meta_whatsapp",
            provider_message_id: messageId,
            from_address: from,
            to_address: to,
            body: content.body,
            status: "received",
            raw_payload: {
                ...payload,
                bridge_media: content.media ?? null,
            },
        })
        .select("id")
        .single()

    try {
        const clickupMessage = await createClickUpChatMessage({
            workspaceId: channel.clickup_workspace_id,
            channelId: channel.clickup_channel_id,
            content: formatClientInboundMessage({
                clientName,
                body: content.clickupBody,
                showClientName,
            }),
        })

        await supabaseAdmin
            .from("client_messages")
            .update({
                status: "posted_to_clickup",
                clickup_message_id: getClickUpMessageId(clickupMessage),
            })
            .eq("id", insertedMessage?.id)
    } catch (error) {
        await supabaseAdmin
            .from("client_messages")
            .update({
                status: "clickup_failed",
                error:
                    error instanceof Error
                        ? error.message
                        : "Unknown ClickUp error",
            })
            .eq("id", insertedMessage?.id)
    }
}

export async function GET(request: NextRequest) {
    const url = new URL(request.url)
    const mode = url.searchParams.get("hub.mode")
    const token = url.searchParams.get("hub.verify_token")
    const challenge = url.searchParams.get("hub.challenge")

    if (
        mode === "subscribe" &&
        token === process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN &&
        challenge
    ) {
        return new Response(challenge, { status: 200 })
    }

    return new Response("Forbidden", { status: 403 })
}

export async function POST(request: NextRequest) {
    const appBaseUrl = new URL(request.url).origin
    const payload = (await request.json()) as WhatsAppWebhookPayload
    const inboundMessages =
        payload.entry
            ?.flatMap((entry) => entry.changes ?? [])
            .flatMap((change) =>
                (change.value?.messages ?? []).map((message) => ({
                    message,
                    value: change.value ?? {},
                }))
            ) ?? []

    inboundMessages.sort(
        (left, right) =>
            getMessageTimestampMs(left.message) -
            getMessageTimestampMs(right.message)
    )

    for (const { message, value } of inboundMessages) {
        await handleInboundMessage({
            message,
            value,
            payload,
            appBaseUrl,
        })
    }

    return Response.json({ ok: true })
}
