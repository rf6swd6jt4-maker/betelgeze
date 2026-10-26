import type { Metadata } from "next"
import { ClientPortalEntry } from "@/components/client-portal/ClientPortalEntry"
import { clientFaviconIcons } from "@/lib/client-branding/favicon"
import { agencyBrandedMetadata, currentPublicPageUrl, loadClientPagePublicBranding } from "@/lib/client-branding/public-branding"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ token: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { token } = await params
    const [branding, icons, canonicalUrl] = await Promise.all([
        loadClientPagePublicBranding("client-portal", token),
        clientFaviconIcons("client-portal", token),
        currentPublicPageUrl(),
    ])
    return {
        ...agencyBrandedMetadata(branding, "client-portal", canonicalUrl),
        robots: { index: false, follow: false },
        referrer: "no-referrer",
        icons,
    }
}

export default async function ClientPortalSessionPage({ params }: PageProps) {
    const { token } = await params
    return <ClientPortalEntry token={token} />
}
