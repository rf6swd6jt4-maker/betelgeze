import { DetailField, DetailFields } from "@/components/detail/DetailFields"
import { DetailPageHeader } from "@/components/detail/DetailPageHeader"
import { Status } from "@/components/ui/Status"
import { summaryDateTime, summaryStatus, type AppointmentSummary } from "@/lib/client-portal/appointment-summary"

export function ClientPortalAppointmentSummary({ summary, displayName }: { summary: AppointmentSummary; displayName: string }) {
    const status = summaryStatus(summary)
    return <main data-client-portal-main data-client-portal-appointment="ready" className="min-h-screen bg-[#F8F7F3] px-5 py-8 text-slate-900 sm:px-8">
        <div className="mx-auto w-full max-w-3xl">
            <p className="mb-7 text-sm font-semibold text-slate-700">{displayName} <span className="font-normal">· Client portal</span></p>
            <DetailPageHeader surface="light" category="Appointment" reference={summary.reference} title={summary.title} subtitle={summary.calendarName} updated={summaryDateTime(summary.observedAt, summary.timezone)} />
            <DetailFields surface="light" columns={1}>
                <DetailField label="Status" icon="status"><Status surface="light" label={status.label} tone={status.tone} wrap /></DetailField>
                <DetailField label="Contact" icon="person"><span className="break-words">{summary.contactName}</span></DetailField>
                <DetailField label={summary.removed || status.label === "Cancelled" ? "Was scheduled" : "Starts"} icon="schedule"><span>{summaryDateTime(summary.startTime, summary.timezone)}</span></DetailField>
                {summary.endTime ? <DetailField label="Ends" icon="time">{summaryDateTime(summary.endTime, summary.timezone)}</DetailField> : null}
                <DetailField label="Time zone" icon="location"><span className="break-words">{summary.timezone}{!summary.timezoneKnown ? " (calendar time zone unavailable)" : ""}</span></DetailField>
                <DetailField label="Contact details" icon="contact" stackOnMobile multiline><p className="whitespace-pre-wrap break-words">{summary.contactDetails || "Not provided"}</p></DetailField>
                <DetailField label="Meeting details" icon="location" stackOnMobile multiline><p className="whitespace-pre-wrap break-words">{summary.meetingDetails || "Not provided"}</p></DetailField>
                <DetailField label="Booking details" icon="description" stackOnMobile multiline><p className="whitespace-pre-wrap break-words">{summary.bookingDetails || "Not provided"}</p></DetailField>
            </DetailFields>
            {status.explanation ? <p className="mt-5 text-sm text-slate-700">{status.explanation}</p> : null}
            <p className="mt-5 text-xs leading-relaxed text-slate-600">This summary shows the latest saved calendar update. Reload this page to check for a newer saved update.</p>
        </div>
    </main>
}

export function ClientPortalAppointmentUnavailable({ retryable = false }: { retryable?: boolean }) {
    return <main data-client-portal-main data-client-portal-appointment={retryable ? "error" : "unavailable"} className="flex min-h-screen items-center justify-center bg-[#F8F7F3] px-6 text-center text-slate-900">
        <div className="max-w-sm">
            <h1 className="text-xl font-semibold">{retryable ? "The appointment summary could not load" : "This appointment link is not available"}</h1>
            <p className="mt-2 text-sm text-slate-600">{retryable ? "Reload this page to try again. If this continues, contact your agency." : "Ask your agency for a current appointment link."}</p>
        </div>
    </main>
}
