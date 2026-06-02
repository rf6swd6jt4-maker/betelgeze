import { NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import {
    formatClientInboundMessage,
    normalizeMessageAddress,
} from "@/lib/client-messages/addresses"
import { createClickUpChatMessage } from "@/lib/client-messages/clickup"
import { validateTwilioSignature } from "@/lib/client-messages/twilio"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function twimlResponse() {
    return new Response("<Response></Response>", {
        headers: {
            "Content-Type": "text/xml",
        },
    })
}

function getRequestUrl(request: NextRequest) {
    const forwardedProto = request.headers.get("x-forwarded-proto")
    const forwardedHost = request.headers.get("x-forwarded-host")

    if (forwardedProto && forwardedHost) {
        const url = new URL(request.url)
        return `${forwardedProto}://${forwardedHost}${url.pathname}${url.search}`
    }

    return request.url
}

export async function POST(request: NextRequest) {
    const bodyText = await request.text()
    const params = new URLSearchParams(bodyText)
    const authToken = process.env.TWILIO_AUTH_TOKEN
    const signature = request.headers.get("x-twilio-signature")

    if (
        authToken &&
        (!signature ||
            !validateTwilioSignature({
                authToken,
                signature,
                url: getRequestUrl(request),
                params,
            }))
    ) {
        return new Response("Invalid Twilio signature", { status: 403 })
    }

    const from = normalizeMessageAddress(params.get("From") ?? "")
    const to = normalizeMessageAddress(params.get("To") ?? "")
    const messageSid = params.get("MessageSid") ?? params.get("SmsSid")
    const messageBody = (params.get("Body") ?? "").trim()

    if (!from || !messageBody) {
        return twimlResponse()
    }

    const { data: channel } = await supabaseAdmin
        .from("client_communication_channels")
        .select("id, client_id, clickup_workspace_id, clickup_channel_id")
        .eq("provider", "twilio")
        .eq("external_address", from)
        .eq("is_active", true)
        .single()

    if (!channel) {
        await supabaseAdmin.from("client_messages").insert({
            direction: "inbound",
            provider: "twilio",
            provider_message_id: messageSid,
            from_address: from,
            to_address: to,
            body: messageBody,
            status: "unmatched",
            raw_payload: Object.fromEntries(params.entries()),
        })

        return twimlResponse()
    }

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("name")
        .eq("id", channel.client_id)
        .single()

    const clientName = client?.name ?? "Client"

    const { data: existingMessage } = messageSid
        ? await supabaseAdmin
              .from("client_messages")
              .select("id")
              .eq("provider", "twilio")
              .eq("provider_message_id", messageSid)
              .maybeSingle()
        : { data: null }

    if (existingMessage) {
        return twimlResponse()
    }

    const { data: insertedMessage } = await supabaseAdmin
        .from("client_messages")
        .insert({
            client_id: channel.client_id,
            communication_channel_id: channel.id,
            direction: "inbound",
            provider: "twilio",
            provider_message_id: messageSid,
            from_address: from,
            to_address: to,
            body: messageBody,
            status: "received",
            raw_payload: Object.fromEntries(params.entries()),
        })
        .select("id")
        .single()

    try {
        const clickupMessage = await createClickUpChatMessage({
            workspaceId: channel.clickup_workspace_id,
            channelId: channel.clickup_channel_id,
            content: formatClientInboundMessage({
                clientName,
                channel: from.split(":", 1)[0] ?? "sms",
                from,
                body: messageBody,
            }),
        })

        await supabaseAdmin
            .from("client_messages")
            .update({
                status: "posted_to_clickup",
                clickup_message_id:
                    clickupMessage?.id ??
                    clickupMessage?.data?.id ??
                    clickupMessage?.message?.id ??
                    null,
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

    return twimlResponse()
}
