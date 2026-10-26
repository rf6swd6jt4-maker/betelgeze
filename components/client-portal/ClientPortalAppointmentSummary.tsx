import type { AppointmentSummary } from "@/lib/client-portal/appointment-summary"
import { ClientPortalAppointmentDetails } from "./ClientPortalAppointmentDetails"

export function ClientPortalAppointmentSummary({ summary, displayName, notifiedVersion, embedded = false, onBackToCalendar }: { summary: AppointmentSummary; displayName: string; notifiedVersion?: number | null; embedded?: boolean; onBackToCalendar?: () => void }) {
    const Container = embedded ? "section" : "main"
    return <Container data-client-portal-main={embedded ? undefined : true} data-client-portal-appointment="ready" className={embedded ? "pb-6 text-slate-900" : "min-h-screen bg-[#F8F7F3] px-5 py-8 text-slate-900 sm:px-8"}>
        <div className="mx-auto w-full max-w-3xl">
            {onBackToCalendar ? <button type="button" onClick={onBackToCalendar} className="mb-4 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)] hover:bg-black/5"><svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8"><path d="m15 18-6-6 6-6" /></svg><span>Back to calendar</span></button> : null}
            <p className="mb-7 text-sm font-semibold text-slate-700">{displayName} <span className="font-normal">· Client portal</span></p>
            <ClientPortalAppointmentDetails summary={summary} notifiedVersion={notifiedVersion} />
        </div>
    </Container>
}

export function ClientPortalAppointmentUnavailable({ retryable = false }: { retryable?: boolean }) {
    return <main data-client-portal-main data-client-portal-appointment={retryable ? "error" : "unavailable"} className="flex min-h-screen items-center justify-center bg-[#F8F7F3] px-6 text-center text-slate-900">
        <div className="max-w-sm">
            <h1 className="text-xl font-semibold">{retryable ? "The appointment summary could not load" : "This appointment link is not available"}</h1>
            <p className="mt-2 text-sm text-slate-600">{retryable ? "Reload this page to try again. If this continues, contact your agency." : "Ask your agency for a current appointment link."}</p>
        </div>
    </main>
}
