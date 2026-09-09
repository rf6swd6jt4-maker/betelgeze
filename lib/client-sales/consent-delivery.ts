type ConsentSale = {
    status: string
    raw_payload: unknown
    consent_template_message_id: string | null
    updated_at: string
}

export function consentFailureUpdate(sale: ConsentSale, input: {
    providerMessageId: string
    claimedAt?: string | null
    statusPayload: unknown
    webhookPayload: unknown
}) {
    const sending = ["manual_consent_template_sending", "sold_confirmation_sending", "paid_consent_template_sending"].includes(sale.status)
    const awaiting = ["manual_awaiting_whatsapp_confirm", "sold_awaiting_whatsapp_confirm", "paid_awaiting_whatsapp_confirm"].includes(sale.status)
    if (!sending && !awaiting) return null
    // A late callback from an older attempt must not cancel a newer send.
    if (sending ? !input.claimedAt || sale.updated_at !== input.claimedAt : sale.consent_template_message_id !== input.providerMessageId) return null
    const original = sale.raw_payload && typeof sale.raw_payload === "object" && !Array.isArray(sale.raw_payload)
        ? sale.raw_payload as Record<string, unknown> : {}
    return {
        status: sale.status.startsWith("manual_") ? "manual_consent_template_failed"
            : sale.status.startsWith("paid_") ? "paid_consent_template_failed" : "sold_confirmation_failed",
        consent_template_sent_at: null,
        consent_template_message_id: input.providerMessageId,
        raw_payload: { ...original, meta_status: input.statusPayload, meta_status_payload: input.webhookPayload },
    }
}
