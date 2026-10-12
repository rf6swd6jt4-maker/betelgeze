import { supabaseAdmin } from "@/lib/supabase/admin"
import { expireStripeCheckoutSession, getCheckoutFields, retrieveStripeCheckoutSession } from "@/lib/stripe/api"
import { getWorkspaceProviderConfig } from "@/lib/workspace-integrations"
import { handleCompletedStripeCheckout } from "@/lib/client-sales/automation"
import type { PriceCorrectionRecord, PriceCorrectionRequest } from "./price-correction-types"

/** The DB reservation blocks checkout creation before the provider is inspected.
 * Unknown provider outcomes leave the reservation intact for an identical retry. */
export async function correctUnpaidSalePrices(workspaceId: string, relationshipId: string, actorId: string, input: PriceCorrectionRequest) {
    const begin = await supabaseAdmin.rpc("begin_client_sale_price_correction", {
        p_workspace: workspaceId, p_relationship: relationshipId, p_sale: input.saleId, p_actor: actorId,
        p_request: input.requestId, p_version: input.expectedVersion, p_terms: input.terms, p_reason: input.reason,
    })
    if (begin.error) return { ok: false, uncertain: !/^[0-9A-Z]{5}$/.test(begin.error.code ?? ""), error: begin.error.code === "P0001" ? begin.error.message : "Could not reserve this correction. Retry the same request." }
    const correction = begin.data as PriceCorrectionRecord
    if (correction.state === "committed") return { ok: true }
    if (correction.state === "rejected") return { ok: false, uncertain: false, error: "This correction was stopped because checkout was completed. Reload the sale to review payment." }
    const finish = async (accept: boolean) => {
        const result = await supabaseAdmin.rpc("finish_client_sale_price_correction", { p_workspace: workspaceId, p_actor: actorId, p_request: input.requestId, p_accept: accept })
        if (result.error) throw new Error("The correction could not be confirmed. Retry this same correction to recover it.")
        return (result.data as PriceCorrectionRecord).state
    }
    try {
        if (correction.previous_checkout_id) {
            const config = await getWorkspaceProviderConfig(workspaceId, "stripe")
            const secretKey = config.access_token || config.secret_key
            const inspect = (raw: unknown) => {
                const fields = getCheckoutFields(raw)
                if (fields.checkoutSessionId !== correction.previous_checkout_id || fields.metadata.client_sale_id !== input.saleId || fields.metadata.workspace_id !== workspaceId) throw new Error("The checkout identity could not be verified. The correction remains reserved for review.")
                return fields
            }
            let raw = await retrieveStripeCheckoutSession({ secretKey, checkoutSessionId: correction.previous_checkout_id })
            let checkout = inspect(raw)
            if (checkout.checkoutStatus === "open" && checkout.paymentStatus === "unpaid") {
                // Completion can win between retrieval and expiry. If expiry fails, retrieve
                // once to distinguish a completed payment from a transient provider failure.
                try { raw = await expireStripeCheckoutSession({ secretKey, checkoutSessionId: correction.previous_checkout_id, idempotencyKey: `${input.requestId}:expire` }) }
                catch { raw = await retrieveStripeCheckoutSession({ secretKey, checkoutSessionId: correction.previous_checkout_id }) }
                checkout = inspect(raw)
            }
            if (checkout.checkoutStatus === "complete" || checkout.paymentStatus === "paid" || checkout.paymentStatus === "no_payment_required") {
                if (checkout.paymentStatus === "paid" || checkout.paymentStatus === "no_payment_required") {
                    const recorded = await handleCompletedStripeCheckout(raw, workspaceId)
                    if (!recorded.ok) throw new Error("Payment completed but its recording needs recovery. Retry this same correction.")
                }
                await finish(false)
                return { ok: false, uncertain: false, error: "Checkout completed before the correction. Its payment must be reconciled; prices were not changed." }
            }
            if (checkout.checkoutStatus !== "expired" || checkout.paymentStatus !== "unpaid") throw new Error("Checkout expiry is not confirmed. Retry this same correction; the original prices remain recorded.")
        }
        const state = await finish(true)
        return state === "committed" ? { ok: true } : { ok: false, uncertain: false, error: "This correction was stopped. Reload the sale." }
    } catch (error) {
        return { ok: false, uncertain: true, error: error instanceof Error ? error.message : "Correction outcome unknown. Retry this same correction." }
    }
}
