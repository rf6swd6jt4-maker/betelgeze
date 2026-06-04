import { NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { retrieveClickUpChannelMessages } from "@/lib/client-messages/clickup"
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

type ActiveChannel = {
    id: string
    client_id: string
    external_address: string
    clickup_workspace_id: string | null
    clickup_channel_id: string
}

const BRIDGE_USER_NAME =
    process.env.CLICKUP_BRIDGE_USER_NAME?.trim().toLowerCase() || "scaylup"

function isAuthorized(request: NextRequest) {
    const secret = process.env.CLIENT_MESSAGES_BRIDGE_SECRET

    if (!secret) return false

    const url = new URL(request.url)
    const authorization = request.headers.get("authorization")
    const bridgeSecret = request.headers.get("x-bridge-secret")
    const querySecret = url.searchParams.get("secret")

    return (
        authorization === `Bearer ${secret}` ||
        bridgeSecret === secret ||
        querySecret === secret
    )
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

function getMessagesFromResponse(response: JsonValue): JsonObject[] {
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

function extractMessage(message: JsonObject) {
    return {
        id: firstString(message, ["id", "message_id", "message.id"]),
        body: firstString(message, [
            "content",
            "text",
            "body",
            "message",
            "content.text",
            "data.content",
        ]),
        authorName: firstString(message, [
            "author.name",
            "author.username",
            "user.name",
            "user.username",
            "creator.name",
            "creator.username",
            "sender.name",
            "sender.username",
        ]),
        authorId: firstString(message, [
            "author.id",
            "user.id",
            "creator.id",
            "sender.id",
        ]),
        createdAt: firstString(message, [
            "created_at",
            "date_created",
            "timestamp",
        ]),
    }
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

async function wasAlreadyProcessed(messageId: string) {
    const { data: duplicate } = await supabaseAdmin
        .from("client_messages")
        .select("id")
        .eq("provider", "clickup_chat")
        .eq("provider_message_id", messageId)
        .maybeSingle()

    return Boolean(duplicate)
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

async function sendClickUpMessageToWhatsApp({
    channel,
    messageId,
    body,
    rawMessage,
}: {
    channel: ActiveChannel
    messageId: string
    body: string
    rawMessage: JsonObject
}) {
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
            raw_payload: rawMessage,
        })
        .select("id")
        .single()

    try {
        await sendMetaWhatsAppMessage({
            to: channel.external_address,
            body,
        })

        await supabaseAdmin
            .from("client_messages")
            .update({
                status: "sent",
            })
            .eq("id", messageLog?.id)

        return true
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

        return false
    }
}

async function pollChannel(channel: ActiveChannel) {
    const response = await retrieveClickUpChannelMessages({
        workspaceId: channel.clickup_workspace_id,
        channelId: channel.clickup_channel_id,
        limit: 20,
    })
    const messages = getMessagesFromResponse(response)
    const orderedMessages = [...messages].reverse()
    let sent = 0
    let ignored = 0

    for (const rawMessage of orderedMessages) {
        const message = extractMessage(rawMessage)

        if (!message.id || !message.body) {
            ignored += 1
            continue
        }

        if (await wasAlreadyProcessed(message.id)) {
            ignored += 1
            continue
        }

        if (
            isBridgeOrSystemMessage({
                body: message.body,
                authorId: message.authorId,
                authorName: message.authorName,
            })
        ) {
            ignored += 1
            continue
        }

        if (
            await isRecentInboundEcho({
                clientId: channel.client_id,
                body: message.body,
            })
        ) {
            ignored += 1
            continue
        }

        const didSend = await sendClickUpMessageToWhatsApp({
            channel,
            messageId: message.id,
            body: message.body,
            rawMessage,
        })

        if (didSend) {
            sent += 1
        }
    }

    return {
        sent,
        ignored,
    }
}

export async function GET(request: NextRequest) {
    if (!isAuthorized(request)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: channels, error } = await supabaseAdmin
        .from("client_communication_channels")
        .select(
            "id, client_id, external_address, clickup_workspace_id, clickup_channel_id"
        )
        .eq("provider", "meta_whatsapp")
        .eq("is_active", true)
        .not("clickup_channel_id", "is", null)

    if (error) {
        return Response.json(
            { error: "Could not load active channels" },
            { status: 500 }
        )
    }

    let sent = 0
    let ignored = 0
    const errors: string[] = []

    for (const channel of (channels ?? []) as ActiveChannel[]) {
        try {
            const result = await pollChannel(channel)
            sent += result.sent
            ignored += result.ignored
        } catch (error) {
            errors.push(
                error instanceof Error
                    ? error.message
                    : "Unknown polling error"
            )
        }
    }

    return Response.json({
        ok: errors.length === 0,
        checkedChannels: channels?.length ?? 0,
        sent,
        ignored,
        errors,
    })
}

export async function POST(request: NextRequest) {
    return GET(request)
}
