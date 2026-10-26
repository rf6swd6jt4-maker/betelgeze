import "server-only"
import { ClientPortalShell } from "@/components/client-portal/ClientPortalShell"
import { OnboardingThemeProvider } from "@/components/onboarding/OnboardingThemeProvider"
import { loadClientPortalSessionByToken } from "@/lib/client-portal/session"
import type { GhlAppointmentEntry } from "@/lib/client-portal/appointment-summary"
import { loadWorkspacePublicBranding } from "@/lib/client-branding/public-branding"
import { clientBrandLogoUrl, loadWorkspaceClientBrandAssets } from "@/lib/client-branding/assets"

/** Both portal links enter the same authorized shell without another navigation. */
export async function ClientPortalEntry({ token, initialAppointment }: { token: string; initialAppointment?: GhlAppointmentEntry }) {
    const resolved = await loadClientPortalSessionByToken(token)

    if (!resolved) {
        return <main data-betelgeze-client-portal-session="invalid" className="flex min-h-screen items-center justify-center bg-[#F8F7F3] px-6 text-center text-slate-900">
            <div><h1 className="text-xl font-semibold">This portal link is not available</h1><p className="mt-2 text-sm text-slate-600">Ask your agency for a new client portal link.</p></div>
        </main>
    }

    const { workspace, relationship, theme, metaAdsReporting, hasGoogleAds, overview } = resolved
    const [publicBranding, brandAssets] = await Promise.all([
        loadWorkspacePublicBranding(workspace.id, workspace.name),
        loadWorkspaceClientBrandAssets(workspace.id),
    ])
    const logoSrc = clientBrandLogoUrl("client-portal", token, brandAssets.logoPath)
    return <OnboardingThemeProvider theme={theme}>
        <ClientPortalShell token={token} workspaceName={publicBranding.displayName} logoSrc={logoSrc} primaryPersonName={relationship.primary_person_name} overview={overview} metaAdsReporting={metaAdsReporting} hasGoogleAds={hasGoogleAds} privacyPolicyUrl={publicBranding.privacyPolicyUrl} termsOfServiceUrl={publicBranding.termsOfServiceUrl} initialAppointment={initialAppointment} />
    </OnboardingThemeProvider>
}
