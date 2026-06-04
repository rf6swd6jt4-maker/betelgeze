import { NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { retrieveClickUpChannelMessages } from "@/lib/client-messages/clickup"
import {
    firstString,
    getMessagesFromResponse,
    isBridgeRequestAuthorized,
    isRecentInboundEcho,
    JsonObject,
    sendLoggedClickUpMessageToWhatsApp,
    shouldIgnoreClickUpMessage,
    wasClickUpMessageProcessed,
} from "@/lib/client-messages/clickup-bridge"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ActiveChannel = {
    id: string
    client_id: string
    external_address: string
    clickup_workspace_id: string | null
    clickup_channel_id: string
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

        if (await wasClickUpMessageProcessed(message.id)) {
            ignored += 1
            continue
        }

        if (
            shouldIgnoreClickUpMessage({
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

        const result = await sendLoggedClickUpMessageToWhatsApp({
            channel,
            messageId: message.id,
            body: message.body,
            rawPayload: rawMessage,
        })

        if (result.ok) {
            sent += 1
        }
    }

    return {
        sent,
        ignored,
    }
}

export async function GET(request: NextRequest) {
    if (!isBridgeRequestAuthorized(request, { allowQuerySecret: true })) {
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
