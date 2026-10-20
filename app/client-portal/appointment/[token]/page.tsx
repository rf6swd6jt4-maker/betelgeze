import type { Metadata } from "next"
import { ClientPortalAppointmentSummary, ClientPortalAppointmentUnavailable } from "@/components/client-portal/ClientPortalAppointmentSummary"
import { loadAppointmentSummary } from "@/lib/client-portal/appointment-summary-server"

export const dynamic = "force-dynamic"
export const revalidate = 0

// No appointment/contact data or capability is put in link-preview metadata.
export const metadata: Metadata = {
    title: { absolute: "Appointment summary" },
    applicationName: "Client portal",
    description: "View your appointment summary.",
    robots: { index: false, follow: false, noarchive: true },
    referrer: "no-referrer",
    icons: { icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", shortcut: [], apple: [] },
}

export default async function AppointmentSummaryPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    const result = await loadAppointmentSummary(token)
    if (result.status !== "ready") return <ClientPortalAppointmentUnavailable retryable={result.status === "error"} />
    return <ClientPortalAppointmentSummary summary={result.summary} displayName={result.displayName} />
}
