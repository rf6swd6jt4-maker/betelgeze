import type { PillTone } from "@/components/ui/pill-styles"

/** Lead stages (docs/campaign-booking.md). Texted and Replied are activity, not stages. */
export const CAMPAIGN_STAGES = ["not_booked", "paid_not_booked", "booked", "showed", "no_show", "sold", "lost"] as const
export type CampaignStage = (typeof CAMPAIGN_STAGES)[number]

export const campaignStageLabels: Record<CampaignStage, string> = {
    not_booked: "Not booked",
    paid_not_booked: "Paid, not booked",
    booked: "Booked",
    showed: "Showed",
    no_show: "No-show",
    sold: "Sold",
    lost: "Lost",
}

/** The stage diamond's colour. Like relationship stages, red is never a stage. */
export const campaignStageMarks: Record<CampaignStage, PillTone> = {
    not_booked: "sky",
    paid_not_booked: "amber",
    booked: "emerald",
    showed: "emerald",
    no_show: "neutral",
    sold: "violet",
    lost: "neutral",
}

export const CAMPAIGN_TAG_TONES = ["emerald", "sky", "violet", "amber", "red", "neutral"] as const
export type CampaignTagTone = (typeof CAMPAIGN_TAG_TONES)[number]

export const campaignSourceStatusLabels = { testing: "Testing", live: "Live", off: "Off" } as const
export type CampaignSourceStatus = keyof typeof campaignSourceStatusLabels

export const meetingPlaceLabels = { zoom: "Zoom", phone: "Phone call, we call them", google_meet: "Google Meet" } as const
export type MeetingPlace = keyof typeof meetingPlaceLabels

export const CAMPAIGN_TIME_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles"] as const
export const timeZoneLabels: Record<(typeof CAMPAIGN_TIME_ZONES)[number], string> = {
    "America/New_York": "Eastern",
    "America/Chicago": "Central",
    "America/Denver": "Mountain",
    "America/Phoenix": "Arizona",
    "America/Los_Angeles": "Pacific",
}

export function isCampaignStage(value: unknown): value is CampaignStage {
    return typeof value === "string" && (CAMPAIGN_STAGES as readonly string[]).includes(value)
}

export function formatMoney(cents: number | null | undefined) {
    if (cents === null || cents === undefined) return ""
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100)
}

/** "Tue Nov 24, 10:00 AM CT" in the source's time zone. */
export function formatAppointment(iso: string, timeZone: string) {
    const date = new Date(iso)
    const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(date)
    const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date)
    const zone = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(date).find(part => part.type === "timeZoneName")?.value ?? ""
    return `${day}, ${time}${zone ? ` ${zone.replace(/^(C|E|M|P)[SD]T$/, "$1T")}` : ""}`
}

export function minuteLabel(minute: number) {
    const hours = Math.floor(minute / 60) % 24
    const minutes = minute % 60
    const suffix = hours < 12 ? "AM" : "PM"
    const twelve = hours % 12 === 0 ? 12 : hours % 12
    return `${twelve}:${String(minutes).padStart(2, "0")} ${suffix}`
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

/** A booking address from a source name: "Funnel teardown" -> "funnel-teardown". */
export function bookingSlugFrom(name: string) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "")
    return slug.length >= 3 ? slug : `${slug || "book"}-call`
}

/** https://scaylup.com/teardown/ -> https://scaylup.com, or null when it is not a full https address. */
export function originOf(value: string) {
    try {
        const url = new URL(value.trim())
        return url.protocol === "https:" && url.hostname.includes(".") ? url.origin.toLowerCase() : null
    } catch {
        return null
    }
}
