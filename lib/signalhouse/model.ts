/** SignalHouse texting: shared, client-safe helpers (docs/signalhouse.md). */

export const SIGNALHOUSE_GROUP_ID = /^G[A-Za-z0-9]{7}$/

/** Events the Betelgeze webhook subscribes to. Message bodies are stored for the Comms Leads tab, which comes later. */
export const SIGNALHOUSE_WEBHOOK_EVENTS = [
    "MESSAGE_RECEIVED", "MESSAGE_DELIVERED", "MESSAGE_FAILED", "SMS_FAILED", "MMS_FAILED",
    "NUMBER_UPDATED", "NUMBER_ASSIGNMENT_SUCCESSFUL", "NUMBER_UNASSIGNMENT_SUCCESSFUL", "NUMBER_DELETION_SUCCESSFUL",
    "CAMPAIGN_APPROVED_BY_SIGNAL_HOUSE", "CAMPAIGN_REJECTED_BY_SIGNAL_HOUSE", "CAMPAIGN_SUSPENDED", "CAMPAIGN_UNSUSPENDED",
] as const

/** SignalHouse writes numbers as digits only ("15125550199"); Betelgeze stores +E.164 ("+15125550199"). */
export function signalHousePhoneToE164(value: unknown) {
    const digits = String(value ?? "").replace(/\D/g, "")
    const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : ""
    return /^[2-9]\d{9}$/.test(national) ? `+1${national}` : null
}

export const e164ToSignalHouse = (value: string) => value.replace(/^\+/, "")

export function formatSmsNumber(value: string) {
    return value.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "+1 ($1) $2-$3")
}

/** A number can send once SignalHouse has it READY on an ACTIVE 10DLC registration. */
export function smsNumberCanSend(number: { status: string; registration_external_id: string | null }, registrationStatus: string | null | undefined) {
    return number.status === "READY" && Boolean(number.registration_external_id) && registrationStatus === "ACTIVE"
}

export function smsNumberName(number: { phone_e164: string; label: string } | null | undefined) {
    if (!number) return "No number"
    return number.label ? `${formatSmsNumber(number.phone_e164)} · ${number.label}` : formatSmsNumber(number.phone_e164)
}

/** The API key is a JWT valid for 365 days; its expiry is read for display only, never trusted for access. */
export function signalHouseKeyExpiry(apiKey: string) {
    const payload = apiKey.split(".")[1]
    if (!payload) return null
    try {
        const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")
        const json = JSON.parse(atob(base64)) as { exp?: unknown }
        return typeof json.exp === "number" && Number.isFinite(json.exp) ? new Date(json.exp * 1000).toISOString() : null
    } catch {
        return null
    }
}

export const registrationStatusLabels: Record<string, string> = {
    ACTIVE: "Active", PENDING_REVIEW: "Pending review", PENDING: "Pending review", REJECTED: "Rejected", EXPIRED: "Expired", DEACTIVATED: "Deactivated", SUSPENDED: "Suspended",
}
