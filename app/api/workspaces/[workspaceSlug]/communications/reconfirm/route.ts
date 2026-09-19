import { NextRequest } from "next/server"
import { clientConversationCanAccess } from "@/lib/communications/access"
import { requireCommunicationsWorkspace } from "@/lib/communications/workspace-access"
import { normalizeProviderAddress } from "@/lib/client-messages/addresses"
import { sendCommunicationDeliveries } from "@/lib/client-messages/omnichannel"
import { whatsappWindowIsOpen } from "@/lib/client-messages/whatsapp-window"
import { getWorkspaceProviderConfig } from "@/lib/workspace-integrations"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireCommunicationsWorkspace(workspaceSlug)
    const input = await request.json().catch(() => null) as { relationshipId?: unknown; clientRequestId?: unknown } | null
    const relationshipId = typeof input?.relationshipId === "string" ? input.relationshipId : ""
    const clientRequestId = typeof input?.clientRequestId === "string" ? input.clientRequestId : ""
    if (!UUID.test(relationshipId) || !UUID.test(clientRequestId)) return Response.json({ error: "Invalid confirmation request." }, { status: 400 })
    if (!await clientConversationCanAccess(workspace.id, relationshipId, user.id)) return Response.json({ error: "Conversation not found." }, { status: 404 })
    const { data: relationship, error } = await supabaseAdmin.from("relationships")
        .select("id, client_id, status, whatsapp_phone, primary_phone, last_whatsapp_inbound_at, whatsapp_opted_out_at")
        .eq("workspace_id", workspace.id).eq("id", relationshipId).maybeSingle()
    if (error) return Response.json({ error: "Could not check the WhatsApp response window." }, { status: 503 })
    if (!relationship || relationship.status === "archived") return Response.json({ error: "Conversation not found." }, { status: 404 })
    if (relationship.whatsapp_opted_out_at) return Response.json({ error: "This client opted out of WhatsApp messages." }, { status: 409 })
    if (whatsappWindowIsOpen(relationship.last_whatsapp_inbound_at)) return Response.json({ error: "The WhatsApp response window is already open." }, { status: 409 })
    const address = normalizeProviderAddress("meta_whatsapp", relationship.whatsapp_phone || relationship.primary_phone || "")
    if (!address) return Response.json({ error: "This client has no WhatsApp number." }, { status: 409 })
    const choices = await supabaseAdmin.rpc("relationship_messaging_choices", {
        p_workspace_id: workspace.id, p_relationship_id: relationshipId,
    })
    if (choices.error || !Array.isArray(choices.data)) return Response.json({ error: "Could not verify WhatsApp consent." }, { status: 503 })
    const whatsappChoice = choices.data.find((choice: { provider?: unknown }) => choice.provider === "meta_whatsapp") as { confirmedAt?: unknown; address?: unknown } | undefined
    if (!whatsappChoice?.confirmedAt || whatsappChoice.address !== address.slice("whatsapp:".length)) {
        return Response.json({ error: "This contact has not confirmed WhatsApp communications. Use the initial consent flow first." }, { status: 409 })
    }
    try {
        const config = await getWorkspaceProviderConfig(workspace.id, "meta_whatsapp")
        if (config.waba_id !== "1928719317836909") return Response.json({ error: "The approved reconfirmation template is not configured for this WhatsApp account." }, { status: 409 })
    } catch {
        return Response.json({ error: "WhatsApp is not connected for this workspace." }, { status: 409 })
    }

    const body = "WhatsApp communication confirmation request. Please reply CONFIRM to continue receiving service updates."
    const { data: inserted, error: insertError } = await supabaseAdmin.from("client_messages").insert({
        workspace_id: workspace.id,
        relationship_id: relationshipId,
        client_id: relationship.client_id,
        direction: "outbound",
        provider: "meta_whatsapp",
        to_address: address,
        body,
        status: "sending",
        sender_kind: "staff",
        sender_user_id: user.id,
        automation_kind: "whatsapp_reconfirmation",
        automation_label: "WhatsApp reconfirmation",
        client_request_id: clientRequestId,
        raw_payload: { template_name: "scaylup_service_updates_preference" },
    }).select("id").single()
    let messageId = inserted?.id as string | undefined
    if (insertError?.code === "23505") {
        const previous = await supabaseAdmin.from("client_messages")
            .select("id, status")
            .eq("workspace_id", workspace.id).eq("relationship_id", relationshipId)
            .eq("automation_kind", "whatsapp_reconfirmation")
            .order("created_at", { ascending: false }).limit(1).maybeSingle()
        if (previous.error || !previous.data) return Response.json({ error: "Could not verify the previous reconfirmation." }, { status: 503 })
        if (previous.data.status !== "send_failed") return Response.json({ messageId: previous.data.id, status: previous.data.status, reused: true })
        messageId = previous.data.id
    } else if (insertError || !messageId) {
        return Response.json({ error: insertError?.message ?? "Could not queue the reconfirmation." }, { status: 503 })
    }
    if (!messageId) return Response.json({ error: "Could not resolve the reconfirmation message." }, { status: 503 })

    const delivery = await sendCommunicationDeliveries({
        workspaceId: workspace.id,
        relationshipId,
        messageId,
        body,
        destinations: [{ provider: "meta_whatsapp", address, channelId: null, primary: true }],
        whatsappTemplate: { name: "scaylup_service_updates_preference", language: "en" },
    })
    return Response.json({ messageId, status: delivery.status, error: delivery.error }, { status: delivery.status === "sent" ? 200 : 502 })
}
