import { createHash, verify } from "node:crypto"

// Published by HighLevel's webhook integration guide. Legacy RSA signatures are
// deliberately not accepted (retired September 2026).
export const GHL_WEBHOOK_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=\n-----END PUBLIC KEY-----"
const MAX_BYTES = 1_048_576
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value)
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
export type WebhookIngest = { locationId: string; calendarId?: string; appointmentId: string; eventType: string; eventKey: string; payloadHash: string; payload: Record<string, unknown>; occurredAt?: string }
export type GhlAppEvent = { eventType: "ContactUpdate" | "UNINSTALL"; eventKey: string; payloadHash: string; appId: string; locationId?: string; companyId?: string; contactId?: string }
type Dependencies = { enabled: boolean; ingest: (event: WebhookIngest) => Promise<{ failure?: string; accepted?: boolean }>; publicKey?: string; appId?: string; ingestAppEvent?: (event: GhlAppEvent) => Promise<{ failure?: string; accepted?: boolean }> }
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } })

export async function handleGhlAppointmentWebhook(request: Request, dependencies: Dependencies): Promise<Response> {
    if (!dependencies.enabled) return reply(200, { accepted: false, disabled: true })
    const signature = request.headers.get("x-ghl-signature") ?? ""
    // Ed25519 signatures are exactly 64 bytes, encoded canonically as base64.
    if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) return reply(401, { error: "Invalid signature." })
    const length = request.headers.get("content-length")
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) return reply(413, { error: "Payload too large." })
    const reader = request.body?.getReader()
    if (!reader) return reply(400, { error: "Invalid payload." })
    const chunks: Uint8Array[] = []; let size = 0, expired = false
    const timeout = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}) }, 10_000)
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (expired) return reply(408, { error: "Payload timeout." })
            if (done) break
            size += value.byteLength
            if (size > MAX_BYTES) { await reader.cancel(); return reply(413, { error: "Payload too large." }) }
            chunks.push(value)
        }
    } catch { return reply(400, { error: "Invalid payload." }) }
    finally { clearTimeout(timeout); reader.releaseLock() }
    const raw = Buffer.concat(chunks)
    let verified = false
    try { verified = verify(null, raw, dependencies.publicKey ?? GHL_WEBHOOK_PUBLIC_KEY, Buffer.from(signature, "base64")) } catch { /* Reject malformed signature/key. */ }
    if (!verified) return reply(401, { error: "Invalid signature." })
    let payload: unknown
    try { payload = JSON.parse(raw.toString("utf8")) } catch { return reply(400, { error: "Invalid payload." }) }
    if (!object(payload)) return reply(400, { error: "Invalid payload." })
    const hash = createHash("sha256").update(raw).digest("hex")
    const webhookId = payload.webhookId
    if (webhookId != null && (typeof webhookId !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(webhookId))) return reply(400, { error: "Invalid event identity." })
    if (payload.type === "ContactUpdate" || payload.type === "UNINSTALL") {
        if (!dependencies.ingestAppEvent || !identifier(dependencies.appId)) return reply(503, { error: "App event intake is unavailable." })
        if (payload.appId != null && payload.appId !== dependencies.appId) return reply(400, { error: "Invalid app identity." })
        if (payload.type === "ContactUpdate" && (!identifier(payload.locationId) || !identifier(payload.id))) return reply(400, { error: "Invalid contact event." })
        if (payload.type === "UNINSTALL" && (payload.appId !== dependencies.appId || (!identifier(payload.locationId) && !identifier(payload.companyId)))) return reply(400, { error: "Invalid uninstall event." })
        try {
            // Store only routing identifiers. Contact DOB/custom fields are not needed.
            const result = await dependencies.ingestAppEvent({ eventType: payload.type, eventKey: typeof webhookId === "string" ? webhookId : hash, payloadHash: hash, appId: dependencies.appId,
                ...(identifier(payload.locationId) ? { locationId: payload.locationId } : {}), ...(identifier(payload.companyId) ? { companyId: payload.companyId } : {}), ...(payload.type === "ContactUpdate" ? { contactId: String(payload.id) } : {}) })
            return result.accepted === true && !result.failure ? reply(202, { accepted: true }) : reply(503, { error: "Could not retain event." })
        } catch { return reply(503, { error: "Could not retain event." }) }
    }
    if (!["AppointmentCreate", "AppointmentUpdate", "AppointmentDelete"].includes(String(payload.type))) return reply(200, { accepted: false, ignored: true })
    const appointment = payload.appointment
    if (!identifier(payload.locationId) || !object(appointment) || !identifier(appointment.id) || (appointment.calendarId != null && !identifier(appointment.calendarId)) || (appointment.locationId != null && appointment.locationId !== payload.locationId)) return reply(400, { error: "Invalid appointment event." })
    const updated = appointment.dateUpdated
    const occurredAt = typeof updated === "string" && updated.length <= 64 && /(Z|[+-]\d\d:\d\d)$/i.test(updated) && Number.isFinite(Date.parse(updated)) ? new Date(updated).toISOString() : undefined
    try {
        const result = await dependencies.ingest({ locationId: payload.locationId, ...(appointment.calendarId ? { calendarId: appointment.calendarId as string } : {}), appointmentId: appointment.id, eventType: String(payload.type), eventKey: typeof webhookId === "string" ? webhookId : hash, payloadHash: hash, payload, ...(occurredAt ? { occurredAt } : {}) })
        if (result.failure || result.accepted !== true) return reply(503, { error: "Could not retain event." })
        return reply(202, { accepted: true })
    } catch { return reply(503, { error: "Could not retain event." }) }
}
