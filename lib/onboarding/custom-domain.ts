const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export function normalizeOnboardingDomain(value: string) {
    const domain = value.trim().toLowerCase().replace(/\.$/, "")

    if (!hostnamePattern.test(domain)) return null

    return domain
}

export function getOnboardingUrl({
    workspaceSlug,
    sessionToken,
    customDomain,
    customDomainVerified = false,
}: {
    workspaceSlug: string
    sessionToken: string
    customDomain?: string | null
    customDomainVerified?: boolean
}) {
    if (customDomain && customDomainVerified) return `https://${customDomain}/${sessionToken}`

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
    return `${baseUrl}/onboarding/${workspaceSlug}/${sessionToken}`
}
