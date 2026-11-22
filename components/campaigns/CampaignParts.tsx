import { RoundPill, SquarePill } from "@/components/ui"
import { StageLabel } from "@/components/ui/RelationshipStage"
import { campaignStageLabels, campaignStageMarks, formatAppointment, formatMoney, isCampaignStage, type CampaignStage } from "@/lib/campaigns/model"
import type { CampaignSourceRow } from "@/lib/campaigns/server"

export function CampaignStageLabel({ stage, className = "" }: { stage: CampaignStage; className?: string }) {
    return <StageLabel label={campaignStageLabels[stage]} tone={campaignStageMarks[stage]} className={className} />
}

/** A source's tag: an attached-thing pill in the source's chosen tone. */
export function SourceTag({ source }: { source: Pick<CampaignSourceRow, "tag" | "tag_tone"> | null | undefined }) {
    if (!source) return <span className="text-neutral-600">No source</span>
    return <RoundPill tone={source.tag_tone}>{source.tag}</RoundPill>
}

export function TestLabel() {
    return <SquarePill tone="yellow">Test</SquarePill>
}

export const shortId = (id: string) => id.replace(/-/g, "").slice(0, 7)

export function leadName(lead: { first_name: string; last_name: string | null }) {
    return [lead.first_name, lead.last_name].filter(Boolean).join(" ")
}

/** One activity line for a lead event, in the source's time zone. */
export function eventText(event: { kind: string; detail: Record<string, unknown> }, timeZone: string, sourceName: (id: string) => string | null) {
    const at = (value: unknown) => typeof value === "string" ? formatAppointment(value, timeZone) : "a time"
    const detail = event.detail ?? {}
    switch (event.kind) {
        case "submitted": {
            const name = typeof detail.source_id === "string" ? sourceName(detail.source_id) : null
            return `Submitted the form${name ? ` on ${name}` : ""}${detail.test ? " (test)" : ""}`
        }
        case "time_held": return `Picked ${at(detail.starts_at)}, held until ${typeof detail.held_until === "string" ? new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(detail.held_until)) : "payment"}`
        case "paid": return `Paid ${formatMoney(typeof detail.amount_cents === "number" ? detail.amount_cents : null) || "the booking"} on Stripe`
        case "booked": return `Booked for ${at(detail.starts_at)}${detail.by === "lead" ? " on the booking page" : detail.by === "payment" ? " when the payment came in" : ""}`
        case "paid_time_taken": return `Paid after ${at(detail.starts_at)} was taken. They pick a new time without paying again`
        case "booking_cancelled": return `Booking for ${at(detail.starts_at)} cancelled`
        case "showed": return "Marked showed"
        case "no_show": return "Marked no-show"
        // Text flows (docs/text-flows.md).
        case "flow_started": return `Started ${String(detail.flow ?? "a text flow")}`
        case "flow_text": return `Texted by ${String(detail.flow ?? "a text flow")}${detail.picture ? ", with a picture" : ""}`
        case "flow_done": return detail.reason === "condition" ? `Left ${String(detail.flow ?? "a text flow")}: a condition wasn't met` : `Finished ${String(detail.flow ?? "a text flow")}`
        case "flow_stopped": {
            const why: Record<string, string> = { replied: "they replied", booked: "they booked", paid: "they paid", closed: "Sold or Lost", opted_out: "they opted out", removed: "taken out", reply_word: `they replied ${String(detail.word ?? "")}`.trim(), flow_off: "the flow was switched off", flow_deleted: "the flow was deleted", no_number: "no texting number", failed: "texts kept failing" }
            return `Left ${String(detail.flow ?? "a text flow")}: ${why[String(detail.reason)] ?? "stopped"}`
        }
        case "flow_failed": return `${String(detail.flow ?? "A text flow")} could not text: ${String(detail.error ?? "unknown error")}`
        case "call_due": return `Call task added${detail.flow ? ` by ${String(detail.flow)}` : ""}`
        case "called": return "Marked called"
        case "setter_set": return detail.setter_id ? `Setter set${detail.flow ? ` by ${String(detail.flow)}` : ""}` : "Setter removed"
        case "confirmed": return `Appointment confirmed${detail.word ? ` (replied ${String(detail.word)})` : detail.flow ? ` by ${String(detail.flow)}` : ""}`
        case "stage_changed": {
            const to = isCampaignStage(detail.to) ? campaignStageLabels[detail.to] : String(detail.to ?? "")
            return `Moved to ${to}`
        }
        default: return null
    }
}
