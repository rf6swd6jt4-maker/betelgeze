import { NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { sendMetaWhatsAppMessage } from "@/lib/client-messages/meta-whatsapp"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue }

type JsonObject = { [key: string]: JsonValue }

const BRIDGE_USER_NAME =
    process.env.CLICKUP_BRIDGE_USER_NAME?.trim().toLowerCase() || "scaylup"

function isAuthorized(request: NextRequest) {
    const secret = process.env.CLIENT_MESSAGES_BRIDGE_SECRET

    if (!secret) return false

    const authorization = request.headers.get("authorization")
    const bridgeSecret = request.headers.get("x-bridge-secret")

    return authorization === `Bearer ${secret}` || bridgeSecret === secret
}

function getByPath(payload: JsonValue, path: string) {
    return path.split(".").reduce<JsonValue | undefined>((current, key) => {
        if (!current || typeof current !== "object" || Array.isArray(current)) {
            return undefined
        }

        return current[key]
    }, payload)
}

function firstString(payload: JsonValue, paths: string[]) {
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

function isBridgeOrSystemMessage({
    body,
    authorId,
    authorName,
}: {
    body: string
    authorId: string | null
    authorName: string | null
}) {
    const normalizedAuthorName = authorName?.trim().toLowerCase()
    const bridgeUserId = process.env.CLICKUP_BRIDGE_USER_ID?.trim()
    const normalizedBody = body.trim().toLowerCase()

    return (
        Boolean(bridgeUserId && authorId === bridgeUserId) ||
        normalizedAuthorName === BRIDGE_USER_NAME ||
        normalizedAuthorName === `${BRIDGE_USER_NAME} bot` ||
        normalizedBody.startsWith("**update**") ||
        normalizedBody.startsWith("**error**") ||
        normalizedBody.startsWith("**client") ||
        normalizedBody.includes("[bridge-skip]") ||
        normalizedBody.includes("<!-- bridge-skip -->")
    )
}

function stripBoldHeader(value: string) {
    return value.replace(/^\*\*[^*]+\*\*\s*/u, "").trim()
}

async function isRecentInboundEcho({
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

function extractClickUpAutomationPayload(payload: JsonObject) {
    return {
        clickupChannelId: firstString(payload, [
            "clickupChannelId",
            "clickup_channel_id",
            "channelId",
            "channel_id",
            "chatChannelId",
            "chat_channel_id",
            "message.channel.id",
            "message.channel_id",
            "event.channel.id",
            "event.channel_id",
            "channel.id",
        ]),
        body: firstString(payload, [
            "body",
            "message",
            "text",
            "content",
            "message.text",
            "message.body",
            "message.content",
            "event.text",
            "event.body",
            "event.content",
        ]),
        authorName: firstString(payload, [
            "authorName",
            "author.name",
            "user.name",
            "user.username",
            "creator.name",
            "creator.username",
            "message.author.name",
            "message.user.name",
            "event.user.name",
        ]),
        authorId: firstString(payload, [
            "authorId",
            "author.id",
            "user.id",
            "creator.id",
            "message.author.id",
            "message.user.id",
            "event.user.id",
        ]),
        clickupMessageId: firstString(payload, [
            "clickupMessageId",
            "messageId",
            "message_id",
            "message.id",
            "event.message_id",
            "event.id",
        ]),
    }
}

export async function POST(request: NextRequest) {
    if (!isAuthorized(request)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payload = (await request.json()) as JsonObject
    const extracted = extractClickUpAutomationPayload(payload)
    const body = extracted.body?.trim()

    if (!body || !extracted.clickupChannelId) {
        return Response.json(
            {
                ignored: true,
                reason: "Missing ClickUp channel ID or message body",
            },
            { status: 200 }
        )
    }

    if (
        isBridgeOrSystemMessage({
            body,
            authorId: extracted.authorId,
            authorName: extracted.authorName,
        })
    ) {
        return Response.json({
            ignored: true,
            reason: "Bridge/system message ignored",
        })
    }

    const { data: channel } = await supabaseAdmin
        .from("client_communication_channels")
        .select("id, client_id, external_address")
        .eq("provider", "meta_whatsapp")
        .eq("clickup_channel_id", extracted.clickupChannelId)
        .eq("is_active", true)
        .single()

    if (!channel) {
        return Response.json(
            {
                ignored: true,
                reason: "No active client channel matched this ClickUp channel",
            },
            { status: 200 }
        )
    }

    if (
        await isRecentInboundEcho({
            clientId: channel.client_id,
            body,
        })
    ) {
        return Response.json({
            ignored: true,
            reason: "Recent inbound client message echo ignored",
        })
    }

    if (extracted.clickupMessageId) {
        const { data: duplicate } = await supabaseAdmin
            .from("client_messages")
            .select("id")
            .eq("provider", "clickup_chat")
            .eq("provider_message_id", extracted.clickupMessageId)
            .maybeSingle()

        if (duplicate) {
            return Response.json({
                ignored: true,
                reason: "Duplicate ClickUp message ignored",
            })
        }
    }

    const { data: messageLog } = await supabaseAdmin
        .from("client_messages")
        .insert({
            client_id: channel.client_id,
            communication_channel_id: channel.id,
            direction: "outbound",
            provider: "clickup_chat",
            provider_message_id: extracted.clickupMessageId,
            to_address: channel.external_address,
            body,
            status: "sending",
            raw_payload: payload,
        })
        .select("id")
        .single()

    try {
        const whatsappMessage = await sendMetaWhatsAppMessage({
            to: channel.external_address,
            body,
        })

        await supabaseAdmin
            .from("client_messages")
            .update({
                status: "sent",
                clickup_message_id: extracted.clickupMessageId,
                provider_message_id:
                    extracted.clickupMessageId ??
                    whatsappMessage?.messages?.[0]?.id ??
                    null,
            })
            .eq("id", messageLog?.id)

        return Response.json({ ok: true })
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

        return Response.json(
            { error: "Meta WhatsApp send failed" },
            { status: 502 }
        )
    }
}
