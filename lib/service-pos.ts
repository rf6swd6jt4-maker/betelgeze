import type { MessagingChoice, MessagingMethod } from "./relationship-contacts"
import type { RelationshipServiceRow } from "./service-stages"
export type ServicePosRow = RelationshipServiceRow & {
    service_type: "one_time" | "retainer"
    billing_interval: "week" | "month" | "year"
    billing_interval_count: number
}
export type ServiceSaleLine = {
    id: string
    version: number
    assigneeId: string
    upfrontCents: number
    recurringCents: number
}
export type ServiceSaleInput = {
    uiVersion?: 2
    offered?: Array<{ id: string; version: number }>
    delivery?: Array<{ provider: MessagingMethod; address: string }>
    relationshipVersion: string
    managerId: string
    billingInterval: "week" | "month" | "year"
    billingIntervalCount: number
    lines: ServiceSaleLine[]
}
export type ServiceSaleQuote = {
    hash: string
    currency: string
    upfrontTotal: number
    recurringTotal: number
    billingInterval: string | null
    billingIntervalCount: number | null
    configurationId: string | null
    client: { name: string; company: string | null; email: string; phone: string | null; whatsapp: string | null }
    lines: Array<
        ServiceSaleLine & {
            name: string
            description: string | null
            serviceId: string
            revisionId: string
            code: string
        }
    >
    modules: Array<{
        module_id: string
        module_revision_id: string
        code: string
        definition: Record<string, unknown>
        mandatory: boolean
        instance_ids: string[]
        sort_order: number
    }>
}
export type ServicePosPage = {
    contacts?: MessagingChoice[]
    relationship?: { name: string; company: string | null; email: string | null; phone: string | null; updatedAt: string; managerId: string | null }
    items: ServicePosRow[]
    hasMore: boolean
    managers: Array<{ id: string; name: string }>
    sales: Array<{
        id: string
        status: string
        created_at: string
        currency: string
        upfront_total_amount: number
        recurring_total_amount: number
        onboarding_session_id: string | null
        consent_confirmed_at: string | null
        services: Array<{ id: string; name: string }>
    }>
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export function validServiceSaleInput(value: unknown): value is ServiceSaleInput {
    if (!value || typeof value !== "object") return false
    const x = value as ServiceSaleInput
    return (
        (x.uiVersion === undefined || x.uiVersion === 2 && Array.isArray(x.offered) && x.offered.length > 0 && x.offered.length <= 300 && new Set(x.offered.map(row => row?.id)).size === x.offered.length && x.offered.every(row => uuid.test(row?.id) && Number.isSafeInteger(row?.version) && row.version > 0) && Array.isArray(x.delivery) && x.delivery.length <= 2 && new Set(x.delivery.map(row => row?.provider)).size === x.delivery.length && x.delivery.every(row => ["meta_whatsapp", "twilio_sms"].includes(row?.provider) && /^\+[1-9][0-9]{7,14}$/.test(row?.address))) &&
        typeof x.relationshipVersion === "string" &&
        Number.isFinite(Date.parse(x.relationshipVersion)) &&
        uuid.test(x.managerId) &&
        ["week", "month", "year"].includes(x.billingInterval) &&
        Number.isInteger(x.billingIntervalCount) &&
        x.billingIntervalCount >= 1 &&
        x.billingIntervalCount <= ({ week: 156, month: 36, year: 3 }[x.billingInterval] ?? 0) &&
        Array.isArray(x.lines) &&
        x.lines.length >= 1 &&
        x.lines.length <= 30 &&
        new Set(x.lines.map((l) => l?.id)).size === x.lines.length &&
        x.lines.every(
            (l) =>
                l &&
                uuid.test(l.id) &&
                uuid.test(l.assigneeId) &&
                Number.isSafeInteger(l.version) &&
                l.version > 0 &&
                [l.upfrontCents, l.recurringCents].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 99999999) &&
                l.upfrontCents + l.recurringCents > 0,
        )
    )
}
export function serviceSaleTotals(rows: ServicePosRow[], lines: ServiceSaleLine[]) {
    const selected = lines.map((line) => ({ line, row: rows.find((r) => r.id === line.id) }))
    const currencies = [...new Set(selected.map((x) => x.row?.currency).filter((x): x is string => Boolean(x)))]
    return {
        upfront: lines.reduce((n, l) => n + l.upfrontCents, 0),
        recurring: lines.reduce((n, l) => n + l.recurringCents, 0),
        currency: currencies.length === 1 ? currencies[0] : null,
        mixedCurrencies: currencies.length > 1,
    }
}

/** Display and new-sale default for catalogue schedules expressed per week/year. */
export function monthlyServicePrice(row: Pick<ServicePosRow, "recurring_cents" | "billing_interval" | "billing_interval_count">) {
    return Math.round(row.recurring_cents * (row.billing_interval === "year" ? 1 / 12 : row.billing_interval === "week" ? 52 / 12 : 1) / Math.max(1, row.billing_interval_count))
}

/** Incomplete drafts may omit people/prices, but never carry corrupt or non-monthly values into this UI. */
export function validServiceSaleDraft(value: unknown, rows: ServicePosRow[], version: string): value is ServiceSaleInput {
    if (!value || typeof value !== "object") return false
    const draft = value as ServiceSaleInput
    if (draft.uiVersion !== 2 || draft.relationshipVersion !== version || draft.billingInterval !== "month" || draft.billingIntervalCount !== 1 || typeof draft.managerId !== "string" || !Array.isArray(draft.lines) || draft.lines.length > 30) return false
    if (new Set(draft.lines.map(line => line?.id)).size !== draft.lines.length) return false
    return draft.lines.every(line => line && typeof line.assigneeId === "string" && rows.some(row => row.id === line.id && row.version === line.version) && [line.upfrontCents,line.recurringCents].every(price => Number.isSafeInteger(price) && price >= 0 && price <= 99999999))
}
