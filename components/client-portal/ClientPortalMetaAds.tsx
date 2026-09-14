import { PortalSection } from "@/components/client-portal/ClientPortalUI"

export type ClientPortalMetaAdsReporting = {
    accountId: string
    accountName: string | null
}

export function ClientPortalMetaAds({ reporting }: { reporting: ClientPortalMetaAdsReporting }) {
    return <PortalSection id="meta-ads-reporting" title="Meta Ads" description={reporting.accountName || "Campaign performance"} icon="chart">
        <div className="mt-5 flex min-h-0 flex-1 flex-col justify-center rounded-2xl border border-dashed border-black/15 bg-[var(--onboarding-page,#F8F7F3)] p-5 text-center sm:p-6">
            <div aria-hidden="true" className="mx-auto flex h-12 w-12 items-end justify-center gap-1 rounded-2xl bg-[color-mix(in_srgb,var(--onboarding-primary,#1E3A5F)_8%,transparent)] p-3 text-[var(--onboarding-primary,#1E3A5F)]"><span className="h-2 w-1.5 rounded-sm bg-current opacity-50" /><span className="h-4 w-1.5 rounded-sm bg-current opacity-70" /><span className="h-6 w-1.5 rounded-sm bg-current" /></div>
            <p className="mt-4 font-semibold text-[var(--onboarding-text,#0F172A)]">Reporting connection ready</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Campaign results will appear here when the first reporting view is released.</p>
            <p className="mt-3 break-all text-xs text-[var(--onboarding-muted,#475569)]">Account {reporting.accountId.replace(/^act_/, "")}</p>
        </div>
    </PortalSection>
}
