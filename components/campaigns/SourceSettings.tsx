"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { Button, RoundPill, Selector } from "@/components/ui"
import { SegmentedSwitch } from "@/components/ui/SegmentedSwitch"
import { SectionHeading } from "@/components/detail"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { campaignCommand } from "@/app/[workspaceSlug]/campaigns/actions"
import {
    CAMPAIGN_TAG_TONES, CAMPAIGN_TIME_ZONES, WEEKDAY_LABELS, bookingSlugFrom, formatMoney, meetingPlaceLabels, minuteLabel, originOf, timeZoneLabels,
    type CampaignTagTone, type MeetingPlace,
} from "@/lib/campaigns/model"
import type { CampaignSourceRow } from "@/lib/campaigns/server"

// The same face as the Selector's input appearance, so text fields and choices line up row after row.
const inputClass = "h-10 w-full min-w-0 rounded-lg border border-neutral-700 bg-black px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 hover:border-neutral-500 focus:border-neutral-400"
const rowClass = "grid min-h-9 grid-cols-1 items-start gap-1.5 py-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4"

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return <div className={rowClass}>
        <div className="pt-2 text-sm text-neutral-500">{label}</div>
        <div className="min-w-0 max-w-xl">{children}{hint ? <p className="mt-1.5 text-xs leading-5 text-neutral-500">{hint}</p> : null}</div>
    </div>
}

function Copy({ value }: { value: string }) {
    const [copied, setCopied] = useState(false)
    return <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-[var(--color-surface-hover)] px-2.5 py-2 font-mono text-xs text-neutral-200">{value}</code>
        <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }, () => undefined) }}>{copied ? "Copied" : "Copy"}</Button>
    </div>
}

const TIMES = Array.from({ length: 49 }, (_, index) => index * 30)

/**
 * A source's settings, saved field by field as they change (text on blur, choices at once). The server validates
 * every value; a refusal is shown and the local value is kept so it can be corrected.
 */
export function SourceSettings({ workspaceSlug, source, appOrigin }: { workspaceSlug: string; source: CampaignSourceRow; appOrigin: string }) {
    const router = useRouter()
    const [value, setValue] = useState(source)
    const [state, setState] = useState<{ kind: "idle" | "saving" | "saved" | "error"; message?: string }>({ kind: "idle" })
    const [extraOrigin, setExtraOrigin] = useState("")

    function save(fields: Partial<CampaignSourceRow>) {
        setValue(current => ({ ...current, ...fields }))
        setState({ kind: "saving" })
        // Each save writes only the fields it names, so saves of different settings do not overwrite each other.
        void runWorkspaceMutation(() => campaignCommand(workspaceSlug, "update_source", { source_id: source.id, fields })).then(result => {
            if (!result.ok) { setState({ kind: "error", message: result.error }); return }
            setState({ kind: "saved" })
            router.refresh()
        }, () => setState({ kind: "error", message: "Could not save. Please retry." }))
    }
    const text = (field: keyof CampaignSourceRow) => ({
        value: String(value[field] ?? ""),
        onChange: (event: { target: { value: string } }) => setValue(current => ({ ...current, [field]: event.target.value })),
        onBlur: () => { if ((value[field] ?? "") !== (source[field] ?? "")) save({ [field]: value[field] } as Partial<CampaignSourceRow>) },
    })

    const bookingUrl = value.booking_slug ? `${appOrigin}/book/${value.booking_slug}` : null
    const intakeUrl = `${appOrigin}/api/campaigns/intake/${value.intake_key}`

    return <div className="mt-8">
        <SectionHeading action={<span role="status" aria-live="polite" className={`text-xs ${state.kind === "error" ? "text-red-300" : "text-neutral-500"}`}>
            {state.kind === "saving" ? "Saving…" : state.kind === "saved" ? "Saved" : state.kind === "error" ? state.message : ""}
        </span>}>Name and tag</SectionHeading>
        <Row label="Name"><input className={inputClass} aria-label="Name" maxLength={120} {...text("name")} /></Row>
        <Row label="Tag" hint="The tag marks this source's leads in the pipeline and the leads list.">
            <div className="flex flex-wrap items-center gap-2">
                <input className={`${inputClass} sm:max-w-56`} aria-label="Tag" maxLength={40} {...text("tag")} />
                <div role="group" aria-label="Tag colour" className="flex flex-wrap items-center gap-1.5">
                    {CAMPAIGN_TAG_TONES.map(tone => <button key={tone} type="button" data-icon-button aria-pressed={value.tag_tone === tone} aria-label={tone} onClick={() => save({ tag_tone: tone as CampaignTagTone })}
                        className={`rounded-md p-0.5 outline-none ring-offset-1 ring-offset-neutral-950 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${value.tag_tone === tone ? "ring-2 ring-neutral-300" : ""}`}>
                        <RoundPill tone={tone}>{value.tag || "Tag"}</RoundPill>
                    </button>)}
                </div>
            </div>
        </Row>

        <SectionHeading className="mt-8">Landing page</SectionHeading>
        <Row label="Page address" hint={originOf(value.page_url ?? "") ? undefined : "The full https:// address of the page your ads send people to."}>
            <input className={inputClass} aria-label="Page address" placeholder="https://" maxLength={500} value={value.page_url ?? ""}
                onChange={event => setValue(current => ({ ...current, page_url: event.target.value }))}
                onBlur={() => {
                    if ((value.page_url ?? "") === (source.page_url ?? "")) return
                    const origin = originOf(value.page_url ?? "")
                    save({ page_url: value.page_url || null, allowed_origins: origin && !value.allowed_origins.includes(origin) ? [...value.allowed_origins, origin] : value.allowed_origins })
                }} />
        </Row>
        <Row label="Accepts leads from" hint="Anything sent from another site is refused.">
            <div className="flex flex-wrap items-center gap-2">
                {value.allowed_origins.length ? value.allowed_origins.map(origin => <span key={origin} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-surface-hover)] px-2 py-1 font-mono text-xs text-neutral-200">
                    {origin}<button type="button" data-icon-button aria-label={`Stop accepting ${origin}`} className="text-neutral-500 hover:text-white" onClick={() => save({ allowed_origins: value.allowed_origins.filter(entry => entry !== origin) })}>×</button>
                </span>) : <span className="pt-2 text-sm text-neutral-500">No site yet</span>}
                <span className="flex w-full items-center gap-2">
                    <input className={`${inputClass} min-w-0 flex-1`} aria-label="Also accept another site" placeholder="https://other-site.com" value={extraOrigin} onChange={event => setExtraOrigin(event.target.value)} />
                    <Button size="sm" variant="secondary" disabled={!originOf(extraOrigin)} onClick={() => { const origin = originOf(extraOrigin); if (origin && !value.allowed_origins.includes(origin)) save({ allowed_origins: [...value.allowed_origins, origin] }); setExtraOrigin("") }}>Add</Button>
                </span>
            </div>
        </Row>

        <SectionHeading className="mt-8">After the form</SectionHeading>
        <Row label="This source" hint={value.books ? "Visitors go straight to this source's booking page. Picking a time moves them to Booked." : "Leads land in Not booked. Your team calls them and books the time."}>
            <SegmentedSwitch label="After the form" className="max-w-sm" value={value.books ? "books" : "collects"}
                options={[{ value: "collects", label: "Collects leads" }, { value: "books", label: "Collects and books" }]}
                onChange={next => save(next === "books" ? { books: true, booking_slug: value.booking_slug ?? bookingSlugFrom(value.name) } : { books: false })} />
        </Row>

        {value.books ? <>
            <SectionHeading className="mt-8">Booking page</SectionHeading>
            {bookingUrl ? <Row label="Address" hint="The form sends visitors here with ?submission= and the submission ID, so they never type their details twice. To try it as a lead, send a test lead above."><Copy value={bookingUrl} /></Row> : null}
            <Row label="Address name"><input className={`${inputClass} font-mono sm:max-w-xs`} aria-label="Booking address name" maxLength={60} {...text("booking_slug")} /></Row>
            <Row label="Meeting"><input className={inputClass} aria-label="Meeting name" maxLength={80} {...text("meeting_title")} /></Row>
            <Row label="Length">
                <div className="w-48"><Selector appearance="input" ariaLabel="Length" value={String(value.meeting_minutes)} onChange={next => save({ meeting_minutes: Number(next) })} options={[15, 30, 45, 60].map(minutes => ({ value: String(minutes), label: `${minutes} minutes` }))} /></div>
            </Row>
            <Row label="Where">
                <Selector appearance="input" ariaLabel="Where" value={value.meeting_place} onChange={next => save({ meeting_place: next as MeetingPlace })} options={(Object.keys(meetingPlaceLabels) as MeetingPlace[]).map(key => ({ value: key, label: meetingPlaceLabels[key] }))} />
            </Row>
            {value.meeting_place !== "phone" ? <Row label="Meeting link" hint="Kept on the booking for your team. Sending it to the lead comes with text flows."><input className={inputClass} aria-label="Meeting link" placeholder="https://" maxLength={500} {...text("meeting_link")} /></Row> : null}
            <Row label="Time zone">
                <Selector appearance="input" ariaLabel="Time zone" value={value.time_zone} onChange={next => save({ time_zone: next })} options={CAMPAIGN_TIME_ZONES.map(zone => ({ value: zone, label: `${timeZoneLabels[zone]} time` }))} />
            </Row>
            <Row label="Days">
                <div role="group" aria-label="Booking days" className="grid grid-cols-7 gap-1 sm:flex sm:flex-wrap sm:gap-1.5">
                    {WEEKDAY_LABELS.map((label, day) => {
                        const on = value.booking_days.includes(day)
                        return <button key={label} type="button" aria-pressed={on} onClick={() => { const next = on ? value.booking_days.filter(entry => entry !== day) : [...value.booking_days, day].sort(); if (next.length) save({ booking_days: next }) }}
                            className={`h-9 min-w-0 rounded-md text-sm sm:min-w-12 sm:px-2.5 ${on ? "bg-[var(--color-surface-selected)] text-white" : "text-neutral-500 hover:bg-[var(--color-surface-hover)] hover:text-white"}`}>{label}</button>
                    })}
                </div>
            </Row>
            <Row label="Hours">
                <div className="flex items-center gap-2">
                    <div className="w-36"><Selector appearance="input" ariaLabel="From" value={String(value.day_start_minute)} onChange={next => save({ day_start_minute: Number(next) })} options={TIMES.filter(minute => minute < value.day_end_minute).map(minute => ({ value: String(minute), label: minuteLabel(minute) }))} /></div>
                    <span className="text-sm text-neutral-500">to</span>
                    <div className="w-36"><Selector appearance="input" ariaLabel="To" value={String(value.day_end_minute)} onChange={next => save({ day_end_minute: Number(next) })} options={TIMES.filter(minute => minute > value.day_start_minute).map(minute => ({ value: String(minute), label: minute === 1440 ? "Midnight" : minuteLabel(minute) }))} /></div>
                </div>
            </Row>
            <Row label="Notice" hint="How far ahead the first open time is.">
                <div className="w-48"><Selector appearance="input" ariaLabel="Notice" value={String(value.notice_hours)} onChange={next => save({ notice_hours: Number(next) })} options={[0, 1, 2, 4, 12, 24, 48].map(hours => ({ value: String(hours), label: hours ? `${hours} hour${hours > 1 ? "s" : ""}` : "None" }))} /></div>
            </Row>
            <Row label="Up to">
                <div className="w-48"><Selector appearance="input" ariaLabel="Up to" value={String(value.horizon_days)} onChange={next => save({ horizon_days: Number(next) })} options={[7, 14, 21, 30, 60].map(days => ({ value: String(days), label: `${days} days ahead` }))} /></div>
            </Row>

            <SectionHeading className="mt-8">Payment to confirm the booking</SectionHeading>
            <Row label="Payment" hint={value.pay_amount_cents !== null ? `They pick a time first. It is held for ${value.hold_minutes} minutes while they pay on Stripe, and paying moves them to Booked.` : "Visitors book without paying."}>
                <SegmentedSwitch label="Payment" className="max-w-sm" value={value.pay_amount_cents !== null ? "pay" : "free"}
                    options={[{ value: "free", label: "No payment" }, { value: "pay", label: "Takes payment" }]}
                    onChange={next => save({ pay_amount_cents: next === "pay" ? 29700 : null })} />
            </Row>
            {value.pay_amount_cents !== null ? <>
                <Row label="Amount" hint="Paid through Scaylup's connected Stripe account. At least $0.50.">
                    <AmountInput cents={value.pay_amount_cents} onSave={cents => save({ pay_amount_cents: cents })} />
                </Row>
                <Row label="Hold the time for">
                    <div className="w-48"><Selector appearance="input" ariaLabel="Hold the time for" value={String(value.hold_minutes)} onChange={next => save({ hold_minutes: Number(next) })} options={[10, 15, 20, 30].map(minutes => ({ value: String(minutes), label: `${minutes} minutes` }))} /></div>
                </Row>
                <Row label="Refund rule" hint="Shown on the booking page."><input className={inputClass} aria-label="Refund rule" maxLength={300} {...text("refund_rule")} /></Row>
            </> : null}
        </> : null}

        <SectionHeading className="mt-8">Connect the form</SectionHeading>
        <Row label="Send leads to" hint="Send each qualified form submission here. The address is not a secret: only the sites listed under Landing page can use it."><Copy value={intakeUrl} /></Row>
        {bookingUrl ? <Row label="Then open" hint="After the form is sent, open the booking page with the submission ID."><Copy value={`${bookingUrl}?submission={submission_id}`} /></Row> : null}
        {value.pay_amount_cents !== null ? <Row label="Price shown"><span className="pt-2 text-sm text-neutral-300">{formatMoney(value.pay_amount_cents)}</span></Row> : null}
    </div>
}

function AmountInput({ cents, onSave }: { cents: number; onSave: (cents: number) => void }) {
    const [draft, setDraft] = useState((cents / 100).toFixed(cents % 100 ? 2 : 0))
    return <span className="flex w-48 items-center gap-1.5"><span className="text-sm text-neutral-500">$</span>
        <input className={`${inputClass} tabular-nums`} inputMode="decimal" aria-label="Amount in dollars" value={draft} onChange={event => setDraft(event.target.value)}
            onBlur={() => { const next = Math.round(Number(draft.replace(/[^0-9.]/g, "")) * 100); if (Number.isFinite(next) && next >= 50 && next !== cents) onSave(next) }} />
    </span>
}
