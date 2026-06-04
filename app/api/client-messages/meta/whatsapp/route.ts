import { NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import {
    formatClientInboundMessage,
    normalizeMessageAddress,
} from "@/lib/client-messages/addresses"
import { createClickUpChatMessage } from "@/lib/client-messages/clickup"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type WhatsAppTextMessage = {
    from?: string
    id?: string
    timestamp?: string
    type?: string
    text?: {
        body?: string
    }
}

type WhatsAppChangeValue = {
    metadata?: {
        display_phone_number?: string
    }
    messages?: WhatsAppTextMessage[]
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

function getMessageTimestampMs(message: WhatsAppTextMessage) {
    const timestamp = Number(message.timestamp)

    return Number.isFinite(timestamp) ? timestamp * 1000 : Date.now()
}

async function handleInboundMessage({
    message,
    value,
    payload,
}: {
    message: WhatsAppTextMessage
    value: WhatsAppChangeValue
    payload: WhatsAppWebhookPayload
}) {
    const from = normalizeMessageAddress(`whatsapp:${message.from ?? ""}`)
    const to = value.metadata?.display_phone_number
        ? normalizeMessageAddress(`whatsapp:${value.metadata.display_phone_number}`)
        : null
    const messageBody = message.text?.body?.trim()
    const messageId = message.id ?? null

    if (!from || !messageBody) return

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
            body: messageBody,
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
            body: messageBody,
            status: "received",
            raw_payload: payload,
        })
        .select("id")
        .single()

    try {
        const clickupMessage = await createClickUpChatMessage({
            workspaceId: channel.clickup_workspace_id,
            channelId: channel.clickup_channel_id,
            content: formatClientInboundMessage({
                clientName,
                body: messageBody,
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
        })
    }

    return Response.json({ ok: true })
}
