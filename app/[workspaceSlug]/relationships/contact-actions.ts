"use server"
import { revalidatePath } from "next/cache"
import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getWhatsAppConsentTemplate, getWorkspaceProviderConfig } from "@/lib/workspace-integrations"
import { sendCommunicationDeliveries } from "@/lib/client-messages/omnichannel"
import type { MessagingMethod } from "@/lib/relationship-contacts"

async function authorize(slug: string, relationshipId: string, expectedUserId: string) {
    const context = await requireWorkspacePanel(slug, "relationships")
    await requireRelationshipAccess(context.access, relationshipId)
    if (context.user.id !== expectedUserId) throw new Error("Your account changed. Reload this relationship.")
    return context
}
export async function attachRelationshipContact(slug: string, relationshipId: string, expectedUserId: string, provider: MessagingMethod) {
    const { workspace, user } = await authorize(slug, relationshipId, expectedUserId)
    const result = await supabaseAdmin.rpc("attach_relationship_contact", { p_workspace_id: workspace.id, p_relationship_id: relationshipId, p_actor_user_id: user.id, p_provider: provider })
    if (result.error) return { ok: false, error: "Could not add this contact method. Check seller access and try again." }
    revalidatePath(`/${slug}/relationships/${relationshipId}`)
    return { ok: true }
}
export async function requestRelationshipContactConfirmation(slug: string, relationshipId: string, expectedUserId: string, provider: MessagingMethod, requestId: string) {
    const { workspace, user } = await authorize(slug, relationshipId, expectedUserId)
    try {
        const config = await getWorkspaceProviderConfig(workspace.id, provider)
        const template = provider === "meta_whatsapp" ? await getWhatsAppConsentTemplate(config) : null
        const body = template?.body ?? `${workspace.name}: Please reply YES to confirm this messaging channel. Reply STOP to opt out or HELP for help.`
        const { data, error } = await supabaseAdmin.rpc("prepare_relationship_contact_confirmation", { p_workspace_id: workspace.id, p_relationship_id: relationshipId, p_actor_user_id: user.id, p_provider: provider, p_request_id: requestId, p_body: body })
        if (error) throw new Error(error.code === "P0001" ? error.message : "Could not prepare confirmation. Retry this same request.")
        if (!data.send) return { ok: true, notice: data.status === "confirmed" ? "Messaging confirmed." : data.status === "awaiting_confirmation" ? "Waiting for the client’s confirmation." : "The previous send is still being confirmed. Check Comms before retrying." }
        const delivery = await sendCommunicationDeliveries({ workspaceId: workspace.id, relationshipId, messageId: data.messageId, body, destinations: [{ provider, address: `${provider === "meta_whatsapp" ? "whatsapp" : "sms"}:${data.address}`, channelId: null, primary: true }], whatsappTemplate: template ? { name: template.name, language: template.language } : undefined, smsConsentContext: "relationship_confirmation" })
        const result = delivery.results[0]
        const saved = await supabaseAdmin.from("relationship_contact_confirmations").update({ status: result.ok ? "awaiting_confirmation" : result.safeToRetry ? "send_failed" : "send_uncertain" }).eq("workspace_id", workspace.id).eq("id", data.id).eq("status", "sending")
        if (saved.error) throw new Error("The send outcome is pending reconciliation. Check Comms before retrying.")
        revalidatePath(`/${slug}/relationships/${relationshipId}`)
        return result.ok ? { ok: true, notice: "Confirmation sent. This channel activates when the client replies." } : { ok: false, error: result.error ?? "Confirmation could not be sent." }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not confirm delivery. Check Comms before retrying." } }
}
