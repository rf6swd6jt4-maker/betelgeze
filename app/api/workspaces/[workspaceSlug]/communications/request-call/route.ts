import { NextRequest } from "next/server"
import { clientConversationCanWrite } from "@/lib/communications/access"
import { requireCommunicationsWorkspace } from "@/lib/communications/workspace-access"
import { resolveConfirmedWhatsAppAddress } from "@/lib/client-messages/whatsapp-engagement-consent"
import { sendCommunicationDeliveries } from "@/lib/client-messages/omnichannel"
import { getWorkspaceProviderConfig, getWhatsAppCallRequestTemplate } from "@/lib/workspace-integrations"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_VARIABLE_LENGTH = 300

function boundedText(value: unknown) {
    return typeof value === "string" ? value.trim().slice(0, MAX_VARIABLE_LENGTH) : ""
}

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireCommunicationsWorkspace(workspaceSlug)
    const input = await request.json().catch(() => null) as { relationshipId?: unknown; clientRequestId?: unknown; serviceName?: unknown; requirement?: unknown } | null
    const relationshipId = typeof input?.relationshipId === "string" ? input.relationshipId : ""
    const clientRequestId = typeof input?.clientRequestId === "string" ? input.clientRequestId : ""
    const serviceName = boundedText(input?.serviceName)
    const requirement = boundedText(input?.requirement)
    if (!UUID.test(relationshipId) || !UUID.test(clientRequestId)) return Response.json({ error: "Invalid call request." }, { status: 400 })
    if (!serviceName || !requirement) return Response.json({ error: "Describe the service and what the client needs to do." }, { status: 400 })
    if (!await clientConversationCanWrite(workspace.id, relationshipId, user.id)) return Response.json({ error: "Conversation not found." }, { status: 404 })

    const { data: relationship, error } = await supabaseAdmin.from("relationships")
        .select("id, client_id, status, business_name, whatsapp_phone, primary_phone, whatsapp_opted_out_at")
        .eq("workspace_id", workspace.id).eq("id", relationshipId).maybeSingle()
    if (error) return Response.json({ error: "Could not load this conversation." }, { status: 503 })
    if (!relationship || relationship.status === "archived") return Response.json({ error: "Conversation not found." }, { status: 404 })
    if (relationship.whatsapp_opted_out_at) return Response.json({ error: "This client opted out of WhatsApp messages." }, { status: 409 })

    const consent = await resolveConfirmedWhatsAppAddress(workspace.id, relationshipId, relationship)
    if (!consent.ok) return Response.json({ error: consent.error }, { status: consent.status })

    let callRequestTemplate: { name: string; language: string; bodyVariableCount: number }
    try {
        const config = await getWorkspaceProviderConfig(workspace.id, "meta_whatsapp")
        callRequestTemplate = await getWhatsAppCallRequestTemplate(config)
    } catch (templateError) {
        return Response.json({ error: templateError instanceof Error ? templateError.message : "WhatsApp is not connected for this workspace." }, { status: 409 })
    }
    // The route fills exactly [service, business name, requirement] in that order; a
    // different variable count means the approved template body changed shape since
    // it was last verified in Settings, and must be re-verified before this can send.
    if (callRequestTemplate.bodyVariableCount !== 3) return Response.json({ error: "The configured call-request template no longer has 3 variables (service, business name, what's needed). Re-verify it in WhatsApp Settings." }, { status: 409 })

    const businessName = relationship.business_name || "your business"
    const body = `We need your assistance to complete the next step of the ${serviceName} service for ${businessName}. The step requires your participation in ${requirement}. Reply CALL to arrange a call so we can complete it with you.`
    const { data: inserted, error: insertError } = await supabaseAdmin.from("client_messages").insert({
        workspace_id: workspace.id,
        relationship_id: relationshipId,
        client_id: relationship.client_id,
        direction: "outbound",
        provider: "meta_whatsapp",
        to_address: consent.address,
        body,
        status: "sending",
        sender_kind: "staff",
        sender_user_id: user.id,
        automation_kind: "whatsapp_call_request",
        automation_label: "WhatsApp call request",
        client_request_id: clientRequestId,
        raw_payload: { template_name: callRequestTemplate.name, template_variables: [serviceName, businessName, requirement] },
    }).select("id").single()
    let messageId = inserted?.id as string | undefined
    if (insertError?.code === "23505") {
        const previous = await supabaseAdmin.from("client_messages")
            .select("id, status")
            .eq("workspace_id", workspace.id).eq("client_request_id", clientRequestId).maybeSingle()
        if (previous.error || !previous.data) return Response.json({ error: "Could not verify the previous call request." }, { status: 503 })
        if (previous.data.status !== "send_failed") return Response.json({ messageId: previous.data.id, status: previous.data.status, reused: true })
        messageId = previous.data.id
    } else if (insertError || !messageId) {
        return Response.json({ error: insertError?.message ?? "Could not queue the call request." }, { status: 503 })
    }
    if (!messageId) return Response.json({ error: "Could not resolve the call request message." }, { status: 503 })

    const delivery = await sendCommunicationDeliveries({
        workspaceId: workspace.id,
        relationshipId,
        messageId,
        body,
        destinations: [{ provider: "meta_whatsapp", address: consent.address, channelId: null, primary: true }],
        whatsappTemplate: {
            name: callRequestTemplate.name,
            language: callRequestTemplate.language,
            components: [{
                type: "body",
                parameters: [
                    { type: "text", text: serviceName },
                    { type: "text", text: businessName },
                    { type: "text", text: requirement },
                ],
            }],
        },
    })
    return Response.json({ messageId, status: delivery.status, error: delivery.error }, { status: delivery.status === "sent" ? 200 : 502 })
}
