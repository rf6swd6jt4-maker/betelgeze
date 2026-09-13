"use server"
import { revalidatePath } from "next/cache"
import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { validServiceSaleInput, type ServiceSaleInput } from "@/lib/service-pos"
import { resolveCommunicationDestinations } from "@/lib/client-messages/omnichannel"
import { toE164Recipient } from "@/lib/client-messages/addresses"
import { getWhatsAppConsentTemplate, getWorkspaceProviderConfig } from "@/lib/workspace-integrations"
import { sendSaleConsentTemplate, retrySelectedServiceOnboardingLink } from "@/lib/client-sales/automation"
import { sendSaleSmsConfirmationIfOptedIn } from "@/lib/client-sales/sms-consent"
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
async function deliver(workspaceId: string, relationshipId: string, saleId: string) {
    const relationship = await supabaseAdmin
        .from("relationships")
        .select("communication_primary_provider, status")
        .eq("workspace_id", workspaceId)
        .eq("id", relationshipId)
        .single()
    if (relationship.error) throw new Error("Could not check the client’s communication settings.")
    if (relationship.data.status === "archived")
        throw new Error("Archived relationships cannot receive new confirmation requests.")
    const result =
        relationship.data.communication_primary_provider === "twilio_sms"
            ? await sendSaleSmsConfirmationIfOptedIn({ workspaceId, saleId })
            : await sendSaleConsentTemplate(saleId, workspaceId)
    if (!result.ok)
        return {
            deliveryPending: true,
            notice:
                "Sale saved. Confirmation needs attention: " +
                (result.error ?? "Check the messaging connection and retry."),
        }
    return {
        deliveryPending: false,
        notice:
            "sent" in result && !result.sent
                ? "Sale saved. Waiting for the client’s SMS opt-in; retry confirmation after they opt in."
                : "Sale saved. The client will receive their onboarding link after confirming. Payment unlocks the selected services’ onboarding.",
    }
}
export async function sellRelationshipServices(
    slug: string,
    relationshipId: string,
    request: { expectedUserId: string; requestId: string; input: ServiceSaleInput; quoteHash: string },
) {
    const { workspace, user, access } = await requireWorkspacePanel(slug, "relationships")
    await requireRelationshipAccess(access, relationshipId)
    if (
        user.id !== request.expectedUserId ||
        !uuid.test(request.requestId) ||
        !validServiceSaleInput(request.input) ||
        !/^[0-9a-f]{64}$/.test(request.quoteHash)
    )
        return {
            ok: false as const,
            uncertain: false,
            error: "Your account or sale details changed. Reload and review the sale.",
        }
    let committed: { saleId: string; sessionId: string } | null = null
    let dispatched = false
    try {
        // A recovered receipt does not depend on the current provider configuration.
        const prior = await supabaseAdmin
            .from("service_sale_receipts")
            .select("sale_id")
            .eq("workspace_id", workspace.id)
            .eq("actor_user_id", user.id)
            .eq("request_id", request.requestId)
            .maybeSingle()
        if (prior.error)
            return {
                ok: false as const,
                uncertain: true,
                error: "Could not check whether this sale was already saved. Retry this same sale.",
            }
        let destination: string,
            sms: string | null = null
        if (prior.data) {
            const saved = await supabaseAdmin
                .from("client_sales")
                .select("client_phone, sms_recipient_e164")
                .eq("workspace_id", workspace.id)
                .eq("id", prior.data.sale_id)
                .single()
            if (saved.error)
                return {
                    ok: false as const,
                    uncertain: true,
                    error: "Could not recover the saved sale. Retry this same sale.",
                }
            destination = saved.data.client_phone
            sms = saved.data.sms_recipient_e164
        } else if (request.input.uiVersion === 2) {
            if (!request.input.delivery?.length) throw new Error("Choose a confirmed contact method.")
            await Promise.all([getWorkspaceProviderConfig(workspace.id, "stripe"), ...request.input.delivery.map(choice => getWorkspaceProviderConfig(workspace.id, choice.provider))])
            destination = request.input.delivery[0].address
            sms = request.input.delivery.find(choice => choice.provider === "twilio_sms")?.address ?? null
        } else {
            const [channels] = await Promise.all([
                resolveCommunicationDestinations({
                    workspaceId: workspace.id,
                    relationshipId,
                    purpose: "confirmation",
                }),
                getWorkspaceProviderConfig(workspace.id, "stripe"),
            ])
            const primary =
                channels.destinations.find((d) => d.provider === channels.primaryProvider) ?? channels.destinations[0]
            if (!primary)
                throw new Error(
                    "Add a usable client number and connect its selected messaging provider before selling.",
                )
            for (const provider of new Set(channels.destinations.map((d) => d.provider))) {
                if (provider !== "meta_whatsapp" && provider !== "twilio_sms") continue
                const config = await getWorkspaceProviderConfig(workspace.id, provider)
                if (provider === "meta_whatsapp") await getWhatsAppConsentTemplate(config)
                if (
                    provider === "twilio_sms" &&
                    channels.destinations.some(
                        (d) =>
                            d.provider === provider &&
                            toE164Recipient(d.address) === toE164Recipient(config.phone_number ?? ""),
                    )
                )
                    throw new Error("The client number cannot be the workspace SMS sending number.")
            }
            destination = primary.address
            const smsDestination = channels.destinations.find((d) => d.provider === "twilio_sms")
            sms = smsDestination ? toE164Recipient(smsDestination.address) : null
        }
        dispatched = true
        const { data, error } = await supabaseAdmin.rpc("commit_relationship_service_sale", {
            p_workspace_id: workspace.id,
            p_relationship_id: relationshipId,
            p_actor_user_id: user.id,
            p_request_id: request.requestId,
            p_input: request.input,
            p_quote_hash: request.quoteHash,
            p_destination: destination,
            p_sms_destination: sms,
        })
        if (error)
            return {
                ok: false as const,
                uncertain: !/^[0-9A-Z]{5}$/.test(error.code ?? ""),
                error:
                    error.code === "P0001" ? error.message : "The save could not be confirmed. Retry this same sale.",
            }
        committed = data
        let delivery: { deliveryPending: boolean; notice: string }
        try {
            if (request.input.uiVersion === 2) {
                // The sale transaction already durably queued its exact channel choices.
                const queued = await retrySelectedServiceOnboardingLink(workspace.id, relationshipId, data.saleId)
                delivery = { deliveryPending: false, notice: queued.notice }
            } else delivery = await deliver(workspace.id, relationshipId, data.saleId)
        } catch {
            delivery = {
                deliveryPending: true,
                notice: "Sale saved. Confirmation could not be verified. Retry confirmation from this sale.",
            }
        }
        revalidatePath(`/${slug}/relationships/${relationshipId}`)
        revalidatePath(`/${slug}/relationships/${relationshipId}/pos`)
        revalidatePath(`/${slug}/onboarding`)
        return { ok: true as const, ...committed!, ...delivery }
    } catch (error) {
        if (committed)
            return {
                ok: true as const,
                ...committed,
                deliveryPending: true,
                notice: "Sale saved. Reload the POS to check confirmation.",
            }
        return {
            ok: false as const,
            uncertain: dispatched,
            error: error instanceof Error ? error.message : "Could not prepare this sale.",
        }
    }
}
export async function retryServiceSaleConfirmation(
    slug: string,
    relationshipId: string,
    saleId: string,
    expectedUserId: string,
) {
    const { workspace, user, access } = await requireWorkspacePanel(slug, "relationships")
    await requireRelationshipAccess(access, relationshipId)
    if (user.id !== expectedUserId || !uuid.test(saleId)) return { ok: false, error: "Reload the POS before retrying." }
    const [sale, permission] = await Promise.all([
        supabaseAdmin
            .from("client_sales")
            .select("seller_user_id,consent_confirmed_at")
            .eq("workspace_id", workspace.id)
            .eq("relationship_id", relationshipId)
            .eq("id", saleId)
            .eq("service_scope", "selected_services")
            .single(),
        supabaseAdmin.rpc("workspace_user_can_sell", { p_workspace_id: workspace.id, p_user_id: user.id }),
    ])
    if (
        sale.error ||
        !permission.data ||
        (sale.data.seller_user_id !== user.id && !["owner", "admin"].includes(access.role ?? ""))
    )
        return { ok: false, error: "Seller access required." }
    if (sale.data.consent_confirmed_at) {
        try {
            return await retrySelectedServiceOnboardingLink(workspace.id, relationshipId, saleId)
        } catch {
            return { ok: false, error: "The saved onboarding link could not be queued. Retry this sale." }
        }
    }
    try {
        const result = await deliver(workspace.id, relationshipId, saleId)
        revalidatePath(`/${slug}/relationships/${relationshipId}/pos`)
        return { ok: true, ...result }
    } catch {
        return { ok: false, error: "Could not verify confirmation delivery. Retry this saved sale." }
    }
}
