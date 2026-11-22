import { after } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { decryptWorkspaceIntegration } from "@/lib/workspace-integrations"
import { verifySignalHouseSignature } from "@/lib/signalhouse/signature"
import { syncSignalHouseAccount } from "@/lib/signalhouse/server"
import { applyLeadTextStatus, recordInboundLeadText } from "@/lib/campaigns/lead-texts"
import { applyFlowReply, kickFlows } from "@/lib/campaigns/flows-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY = 65_536
const RESYNC_AFTER_MS = 60_000
const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } })

/**
 * SignalHouse's signed Global webhook for one connected account (docs/signalhouse.md). SignalHouse allows 3 seconds per
 * attempt and retries 5xx/429 only, so this verifies, stores the delivery once (by X-SignalHouse-Delivery-Id) and answers;
 * number and registration changes trigger a re-read of the account after the answer. A lead's text becomes a message in
 * their Comms conversation (docs/comms-leads.md), which follows Comms' read, unread and alert rules; receipts update the
 * texts Betelgeze sent. A text from a phone that is no lead stays stored, unprocessed.
 */
export async function POST(request: Request, context: { params: Promise<{ accountId: string }> }) {
    const { accountId } = await context.params
    if (!/^[0-9a-f-]{36}$/i.test(accountId)) return json(404, { error: "Unknown account." })
    const rawBody = await request.text()
    if (rawBody.length > MAX_BODY) return json(413, { error: "Too large." })

    const { data: account, error } = await supabaseAdmin.from("signalhouse_accounts").select("id, workspace_id, config_encrypted, status, last_synced_at").eq("id", accountId).maybeSingle()
    if (error) return json(503, { error: "Try again." })
    if (!account || account.status === "disconnected") return json(404, { error: "Unknown account." })
    let secret = ""
    try { secret = decryptWorkspaceIntegration(account.config_encrypted).webhook_secret ?? "" } catch { return json(503, { error: "Try again." }) }

    const verified = verifySignalHouseSignature({
        rawBody,
        headers: { timestamp: request.headers.get("x-signalhouse-timestamp"), signature: request.headers.get("x-signalhouse-signature"), signatureV1: request.headers.get("x-signalhouse-signature-v1") },
        secrets: [secret],
    })
    if (!verified.valid) return json(401, { error: "Signature not accepted." })

    const deliveryId = request.headers.get("x-signalhouse-delivery-id")?.trim() ?? ""
    let envelope: Record<string, unknown>
    try {
        envelope = JSON.parse(rawBody)
        if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error()
    } catch {
        return json(400, { error: "Not JSON." })
    }
    const event = typeof envelope.event === "string" && /^[A-Z0-9_]{1,60}$/.test(envelope.event) ? envelope.event : null
    if (!event || !deliveryId || deliveryId.length > 100) return json(400, { error: "Missing event or delivery id." })
    const identifier = Array.isArray(envelope.identifier) ? envelope.identifier.map(String).join(",") : envelope.identifier == null ? null : String(envelope.identifier)

    const { error: insertError } = await supabaseAdmin.from("signalhouse_webhook_events").insert({ account_id: account.id, delivery_id: deliveryId, event, identifier: identifier?.slice(0, 4000) ?? null, payload: envelope })
    const duplicate = insertError?.code === "23505"
    if (insertError && !duplicate) return json(503, { error: "Try again." })
    await supabaseAdmin.from("signalhouse_accounts").update({ last_webhook_at: new Date().toISOString() }).eq("id", account.id)

    if (!duplicate) after(async () => {
        let handled = true
        try {
            if (event === "MESSAGE_RECEIVED") {
                const reply = await recordInboundLeadText(account.workspace_id, account.id, envelope)
                handled = Boolean(reply)
                // Reply words and "stops when they reply" (docs/text-flows.md); a resent delivery is not a second reply.
                if (reply?.fresh) { await applyFlowReply(account.workspace_id, reply.leadId, reply.body); await kickFlows(reply.leadId) }
            }
            else if (["MESSAGE_DELIVERED", "MESSAGE_FAILED", "SMS_FAILED", "MMS_FAILED"].includes(event)) await applyLeadTextStatus(account.workspace_id, envelope)
            else if (event.startsWith("NUMBER_") || event.startsWith("CAMPAIGN_")) {
                const stale = !account.last_synced_at || Date.now() - Date.parse(account.last_synced_at) > RESYNC_AFTER_MS
                if (stale) await syncSignalHouseAccount(account.workspace_id, account.id)
            }
        } catch (error) {
            handled = false
            console.warn("SignalHouse event not processed", event, error instanceof Error ? error.message : "unknown")
        }
        if (handled) await supabaseAdmin.from("signalhouse_webhook_events").update({ processed_at: new Date().toISOString() }).eq("delivery_id", deliveryId)
    })
    return json(200, { ok: true, duplicate })
}
