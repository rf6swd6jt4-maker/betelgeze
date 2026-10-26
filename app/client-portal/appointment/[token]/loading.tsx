import { headers } from "next/headers"
import { ClientPortalStartupScreen } from "@/components/client-portal/ClientPortalStartupScreen"
import { appointmentSummaryHost } from "@/lib/client-portal/appointment-summary"

export default async function AppointmentPortalLoading() {
    const requestHeaders = await headers()
    const hostname = appointmentSummaryHost(requestHeaders.get("host"))
    const portalDomain = appointmentSummaryHost(requestHeaders.get("x-betelgeze-custom-client-portal-domain"))
    // Proxy strips incoming scope headers and sets these only for its verified
    // host. The public logo resolver needs no appointment or session credential.
    const publicWorkspaceSlug = hostname && hostname === portalDomain
        ? requestHeaders.get("x-betelgeze-workspace-slug") : null
    return <ClientPortalStartupScreen publicWorkspaceSlug={publicWorkspaceSlug} />
}
