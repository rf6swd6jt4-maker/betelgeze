/** Immutable outbound components, decoded only from authorised message content. */
export type CommunicationTemplateEvidence = {
    schemaVersion: 1
    templateId: string
    templateName: string
    language: string
    capturedAt: string
    buttons: Array<{ index: number; type: "url"; label: string; url: string }>
}
const MAX_EVIDENCE_BYTES = 8192
function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function bounded(value: unknown, maximum: number): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
}
export function safeTemplateButtonUrl(value: unknown): string | null {
    if (!bounded(value, 2048)) return null
    try {
        const url = new URL(value)
        if (url.protocol !== "https:" || url.username || url.password) return null
        return url.href
    } catch { return null }
}
/** The encrypted JSON is never projected wholesale into a browser response. */
export function communicationTemplateEvidenceFromRawPayload(value: unknown): CommunicationTemplateEvidence | null {
    const encoded = record(record(value).template_evidence).text
    if (typeof encoded !== "string" || encoded.length > MAX_EVIDENCE_BYTES) return null
    let evidence: Record<string, unknown>
    try { evidence = record(JSON.parse(encoded)) } catch { return null }
    if (evidence.schemaVersion !== 1 || !bounded(evidence.templateId, 100) || !bounded(evidence.templateName, 150)
        || !bounded(evidence.language, 32) || !bounded(evidence.capturedAt, 40) || !Number.isFinite(Date.parse(evidence.capturedAt))
        || !Array.isArray(evidence.buttons) || evidence.buttons.length < 1 || evidence.buttons.length > 10) return null
    const buttons: CommunicationTemplateEvidence["buttons"] = []
    for (const [index, candidate] of evidence.buttons.entries()) {
        const button = record(candidate), url = safeTemplateButtonUrl(button.url)
        if (button.index !== index || button.type !== "url" || !bounded(button.label, 80) || !url) return null
        buttons.push({ index, type: "url", label: button.label, url })
    }
    return { schemaVersion: 1, templateId: evidence.templateId, templateName: evidence.templateName, language: evidence.language, capturedAt: evidence.capturedAt, buttons }
}
/** Never display appointment capability tokens or query values in the chat label. */
export function templateButtonDestinationLabel(value: string) {
    const url = new URL(value)
    const segments = url.pathname.split("/").filter(Boolean)
    const path = segments.length ? `/${segments[0].slice(0, 32)}${segments.length > 1 ? "/…" : ""}` : ""
    return `${url.host}${path}${url.search ? "?…" : ""}`
}
export function templateEvidenceState(message: { status: string; providerMessageId: string | null; deliveredAt: string | null; readAt: string | null }) {
    if (message.readAt || ["read", "whatsapp_read"].includes(message.status)) return "Message reported read"
    if (message.deliveredAt || ["delivered", "whatsapp_delivered"].includes(message.status)) return "Message reported delivered"
    if (["failed", "send_failed", "delivery_failed"].includes(message.status)) return "Message failed"
    if (message.status === "send_uncertain") return "Send confirmation pending"
    if (message.providerMessageId && ["sent", "whatsapp_sent"].includes(message.status)) return "Message accepted by WhatsApp"
    return "Prepared for WhatsApp"
}
