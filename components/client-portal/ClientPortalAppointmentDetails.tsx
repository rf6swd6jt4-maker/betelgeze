import { DetailField, DetailFields } from "@/components/detail/DetailFields"
import { DetailPageHeader } from "@/components/detail/DetailPageHeader"
import { Status } from "@/components/ui/Status"
import { summaryDateTime, summaryStatus, type AppointmentSummary } from "@/lib/client-portal/appointment-summary"

function RetainedText({ value, label }: { value: string; label: string }) {
    if (value.length <= 500) return <p className="whitespace-pre-wrap break-words">{value}</p>
    return <div>
        <p className="whitespace-pre-wrap break-words">{value.slice(0, 240).trimEnd()}…</p>
        <details className="mt-2">
            <summary className="cursor-pointer text-sm underline underline-offset-4">View full {label}</summary>
            <p className="mt-3 whitespace-pre-wrap break-words">{value}</p>
        </details>
    </div>
}

function readableLeadValue(value: string) {
    const label = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim()
    return label.charAt(0).toUpperCase() + label.slice(1)
}

/** Both authorized portal entry paths share this presentation.
 * Authorization and capability resolution remain with their server readers. */
export function ClientPortalAppointmentDetails({ summary, notifiedVersion }: {
    summary: AppointmentSummary; notifiedVersion?: number | null
}) {
    const status = summaryStatus(summary), details = summary.details
    const phone = details?.contact.phone
    const phoneHref = phone && /^[+()\d .-]{3,80}$/.test(phone) ? `tel:${phone.replace(/[^+\d]/g, "")}` : null
    const email = details?.contact.email
    const emailHref = email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) && !/[?#%\r\n]/.test(email) ? `mailto:${email}` : null
    const lead = details?.lead
    const leadSource = lead?.source?.trim(), leadType = lead?.type?.trim()
    const leadFields = lead?.fields.filter(field => field.label.trim() && field.value.trim()) ?? []
    return <section data-appointment-details={summary.reference}>
        <DetailPageHeader surface="light" category="Appointment" reference={summary.reference} title={summary.title} subtitle={summary.calendarName} updated={summaryDateTime(summary.observedAt, summary.timezone)} />
        {notifiedVersion && summary.version > notifiedVersion ? <p role="status" className="mt-4 text-sm text-slate-700">This appointment has changed since the notification. The latest saved details are shown below.</p> : null}
        <DetailFields surface="light" columns={1}>
            <DetailField label="Status" icon="status"><Status surface="light" label={status.label} tone={status.tone} wrap /></DetailField>
            <DetailField label="Contact" icon="person"><span className="break-words">{summary.contactName}</span></DetailField>
            <DetailField label={summary.removed || status.label === "Cancelled" ? "Was scheduled" : "Starts"} icon="schedule"><span>{summaryDateTime(summary.startTime, summary.timezone)}</span></DetailField>
            {summary.endTime ? <DetailField label="Ends" icon="time">{summaryDateTime(summary.endTime, summary.timezone)}</DetailField> : null}
            <DetailField label="Time zone" icon="location"><span className="break-words">{summary.timezone}{!summary.timezoneKnown ? " (calendar time zone unavailable)" : ""}</span></DetailField>
            {phone ? <DetailField label="Phone" icon="contact">{phoneHref ? <a className="break-all underline underline-offset-4" href={phoneHref}>{phone}</a> : <span className="break-all">{phone}</span>}</DetailField> : null}
            {email ? <DetailField label="Email" icon="contact">{emailHref ? <a className="break-all underline underline-offset-4" href={emailHref}>{email}</a> : <span className="break-all">{email}</span>}</DetailField> : null}
            {!phone && !email ? <DetailField label="Contact details" icon="contact" stackOnMobile multiline><p className="whitespace-pre-wrap break-words">{summary.contactDetails || "Not provided"}</p></DetailField> : null}
            {details?.contact.company ? <DetailField label="Company" icon="company"><span className="break-words">{details.contact.company}</span></DetailField> : null}
            {details?.contact.address ? <DetailField label="Contact address" icon="location" stackOnMobile multiline><p className="whitespace-pre-wrap break-words">{details.contact.address}</p></DetailField> : null}
            <DetailField label="Meeting details" icon="location" stackOnMobile multiline><div className="min-w-0"><RetainedText value={details?.meeting.location || summary.meetingDetails || "Not provided"} label="meeting details" />{details?.meeting.joinUrl ? <a href={details.meeting.joinUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block underline underline-offset-4">Open meeting link</a> : null}</div></DetailField>
            <DetailField label="Booking details" icon="description" stackOnMobile multiline><p className="whitespace-pre-wrap break-words">{details?.booking.text || (details?.booking.state === "too_large" ? "The booking text exceeds the retained preview limit. Contact your agency for the complete original." : summary.bookingDetails) || "Not provided"}</p></DetailField>
        </DetailFields>
        {leadSource || leadType || leadFields.length ? <section aria-label="Lead information" className="mt-6">
            <h2 className="text-base font-semibold">Lead information</h2>
            <DetailFields surface="light" columns={1} className="[overflow-wrap:anywhere]">
                {leadSource ? <DetailField label="Source" icon="source" stackOnMobile multiline><p className="whitespace-pre-wrap">{readableLeadValue(leadSource)}</p></DetailField> : null}
                {leadType ? <DetailField label="Type" icon="identity" stackOnMobile multiline><p className="whitespace-pre-wrap">{readableLeadValue(leadType)}</p></DetailField> : null}
                {leadFields.map(field => <DetailField key={field.fieldId} label={field.label} icon="description" stackOnMobile multiline><p className="whitespace-pre-wrap">{field.value}</p></DetailField>)}
                {lead?.capturedAt ? <DetailField label="Last saved" icon="time" stackOnMobile multiline>{summaryDateTime(lead.capturedAt, summary.timezone)}</DetailField> : null}
            </DetailFields>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">Saved contact information from GHL. These are not verified original booking answers.</p>
        </section> : null}
        {status.explanation ? <p className="mt-5 text-sm text-slate-700">{status.explanation}</p> : null}
        <details className="mt-6 text-sm text-slate-600">
            <summary className="cursor-pointer text-slate-800">Source and saved update</summary>
            <div className="mt-3 space-y-2">
                <p>Last checked with GHL: {summaryDateTime(summary.observedAt, summary.timezone)}</p>
                {details?.source.createdAt ? <p>Created in GHL: {summaryDateTime(details.source.createdAt, summary.timezone)}</p> : null}
                {details?.source.updatedAt ? <p>Updated in GHL: {summaryDateTime(details.source.updatedAt, summary.timezone)}</p> : null}
                <p>Saved version: {summary.version}. Earlier notifications retain the details recorded when they were sent.</p>
                <p>Original booking form submissions, assigned staff names and internal CRM notes are not currently available in this view. Contact information reflects the latest saved contact read, not necessarily the original booking answers.</p>
            </div>
        </details>
        <p className="mt-5 text-xs leading-relaxed text-slate-600">This summary shows the latest saved calendar update.</p>
    </section>
}
