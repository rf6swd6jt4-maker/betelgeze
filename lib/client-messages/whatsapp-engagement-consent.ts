import { supabaseAdmin } from "@/lib/supabase/admin"
import { normalizeProviderAddress } from "@/lib/client-messages/addresses"

export type WhatsAppConsentResult =
    | { ok: true; address: string }
    | { ok: false; status: number; error: string }

/**
 * Shared by the call-request and report-ready engagement routes: both need the
 * same proof-of-consent check the reconfirmation route already performs before
 * paying for a Utility template send, including the channel-selected sale
 * fallback for relationships confirmed before reply-based tracking existed.
 */
export async function resolveConfirmedWhatsAppAddress(
    workspaceId: string,
    relationshipId: string,
    relationship: { whatsapp_phone: string | null; primary_phone: string | null },
): Promise<WhatsAppConsentResult> {
    const address = normalizeProviderAddress("meta_whatsapp", relationship.whatsapp_phone || relationship.primary_phone || "")
    if (!address) return { ok: false, status: 409, error: "This client has no WhatsApp number." }
    const choices = await supabaseAdmin.rpc("relationship_messaging_choices", {
        p_workspace_id: workspaceId, p_relationship_id: relationshipId,
    })
    if (choices.error || !Array.isArray(choices.data)) return { ok: false, status: 503, error: "Could not verify WhatsApp consent." }
    const phone = address.slice("whatsapp:".length)
    const whatsappChoice = choices.data.find((choice: { provider?: unknown }) => choice.provider === "meta_whatsapp") as { confirmedAt?: unknown; address?: unknown; confirmationStatus?: unknown } | undefined
    let confirmed = Boolean(whatsappChoice?.confirmedAt && whatsappChoice.address === phone)
    if (!confirmed && whatsappChoice?.address === phone && whatsappChoice.confirmationStatus !== "revoked") {
        // Channel-selected sales record confirmation without a WhatsApp reply ID.
        // Recognize that evidence only here, never for freeform sends. The existing
        // relationship_sale_confirmation_lookup index bounds this to the latest
        // confirmed sale; do not scan or transfer the sale history.
        const sale = await supabaseAdmin.from("client_sales")
            .select("consent_confirmed_at, raw_payload->confirmation_source, raw_payload->delivery_choices")
            .eq("workspace_id", workspaceId).eq("relationship_id", relationshipId)
            .not("consent_confirmed_at", "is", null)
            .order("consent_confirmed_at", { ascending: false }).limit(1).maybeSingle()
        if (sale.error) return { ok: false, status: 503, error: "Could not verify WhatsApp consent." }
        confirmed = Boolean(sale.data?.consent_confirmed_at
            && sale.data.confirmation_source === "relationship_channels"
            && Array.isArray(sale.data.delivery_choices)
            && sale.data.delivery_choices.some((choice: unknown) =>
                choice && typeof choice === "object" && "provider" in choice && "address" in choice
                && choice.provider === "meta_whatsapp" && choice.address === phone))
    }
    if (!confirmed) return { ok: false, status: 409, error: "This contact has not confirmed WhatsApp communications. Use the initial consent flow first." }
    return { ok: true, address }
}
