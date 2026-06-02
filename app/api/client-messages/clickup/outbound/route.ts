import { NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { sendTwilioMessage } from "@/lib/client-messages/twilio"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type OutboundBody = {
    clientId?: string
    clickupChannelId?: string
    body?: string
    message?: string
    authorName?: string
}

function isAuthorized(request: NextRequest) {
    const secret = process.env.CLIENT_MESSAGES_BRIDGE_SECRET

    if (!secret) return false

    const authorization = request.headers.get("authorization")
    const bridgeSecret = request.headers.get("x-bridge-secret")

    return authorization === `Bearer ${secret}` || bridgeSecret === secret
}

export async function POST(request: NextRequest) {
    if (!isAuthorized(request)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payload = (await request.json()) as OutboundBody
    const body = String(payload.body ?? payload.message ?? "").trim()

    if (!body) {
        return Response.json(
            { error: "Missing outbound message body" },
            { status: 400 }
        )
    }

    let query = supabaseAdmin
        .from("client_communication_channels")
        .select("id, client_id, external_address")
        .eq("provider", "twilio")
        .eq("is_active", true)
        .limit(1)

    if (payload.clientId) {
        query = query.eq("client_id", payload.clientId)
    } else if (payload.clickupChannelId) {
        query = query.eq("clickup_channel_id", payload.clickupChannelId)
    } else {
        return Response.json(
            { error: "Provide clientId or clickupChannelId" },
            { status: 400 }
        )
    }

    const { data: channels } = await query
    const channel = channels?.[0]

    if (!channel) {
        return Response.json(
            { error: "No active communication channel found" },
            { status: 404 }
        )
    }

    const messageText = payload.authorName
        ? `${payload.authorName}: ${body}`
        : body

    const { data: messageLog } = await supabaseAdmin
        .from("client_messages")
        .insert({
            client_id: channel.client_id,
            communication_channel_id: channel.id,
            direction: "outbound",
            provider: "twilio",
            to_address: channel.external_address,
            body: messageText,
            status: "sending",
            raw_payload: payload,
        })
        .select("id")
        .single()

    try {
        const twilioMessage = await sendTwilioMessage({
            to: channel.external_address,
            body: messageText,
        })

        await supabaseAdmin
            .from("client_messages")
            .update({
                status: "sent",
                provider_message_id: twilioMessage?.sid ?? null,
            })
            .eq("id", messageLog?.id)

        return Response.json({ ok: true, sid: twilioMessage?.sid ?? null })
    } catch (error) {
        await supabaseAdmin
            .from("client_messages")
            .update({
                status: "send_failed",
                error:
                    error instanceof Error
                        ? error.message
                        : "Unknown Twilio error",
            })
            .eq("id", messageLog?.id)

        return Response.json(
            { error: "Twilio send failed" },
            { status: 502 }
        )
    }
}
