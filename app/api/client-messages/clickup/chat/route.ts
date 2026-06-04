import { NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import {
    firstString,
    isBridgeRequestAuthorized,
    isRecentInboundEcho,
    JsonObject,
    sendLoggedClickUpMessageToWhatsApp,
    shouldIgnoreClickUpMessage,
    wasClickUpMessageProcessed,
} from "@/lib/client-messages/clickup-bridge"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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
    if (!isBridgeRequestAuthorized(request)) {
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
        shouldIgnoreClickUpMessage({
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
        if (await wasClickUpMessageProcessed(extracted.clickupMessageId)) {
            return Response.json({
                ignored: true,
                reason: "Duplicate ClickUp message ignored",
            })
        }
    }

    const result = await sendLoggedClickUpMessageToWhatsApp({
        channel,
        messageId: extracted.clickupMessageId,
        body,
        rawPayload: payload,
    })

    if (result.ok) {
        return Response.json({ ok: true })
    }

    return Response.json(
        { error: "Meta WhatsApp send failed" },
        { status: 502 }
    )
}
