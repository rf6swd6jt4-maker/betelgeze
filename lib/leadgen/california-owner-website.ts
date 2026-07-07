export type CaliforniaOwnerWebsiteStageKey = "business_validation" | "owner_identity" | "owner_phone" | "phone_validation"

function urlFromValue(value: string | null | undefined) {
    if (!value) return null
    try {
        return new URL(value.startsWith("http") ? value : `https://${value}`)
    } catch {
        return null
    }
}

export function isCaliforniaOwnerIdentityProfileUrl(value: string | null | undefined) {
    const url = urlFromValue(value)
    if (!url) return false
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    return host === "google.com"
        || host.endsWith(".google.com")
        || host === "maps.google.com"
        || host === "cslb.ca.gov"
        || host === "yelp.com"
        || host.endsWith(".yelp.com")
        || host === "angi.com"
        || host.endsWith(".angi.com")
        || host === "homeadvisor.com"
        || host.endsWith(".homeadvisor.com")
        || host === "bbb.org"
        || host.endsWith(".bbb.org")
}

function defaultWebsiteUrls(baseUrl: string, depth: number, stageKey: CaliforniaOwnerWebsiteStageKey) {
    const url = new URL(baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`)
    const stagePaths = stageKey === "business_validation"
        ? ["/"]
        : [
            "/",
            "/about",
            "/about-us",
            "/our-story",
            "/our-company",
            "/company",
            "/who-we-are",
            "/meet-the-owner",
            "/meet-our-owner",
            "/meet-the-founder",
            "/team",
            "/our-team",
            "/meet-the-team",
            "/meet-our-team",
            "/staff",
            "/leadership",
            "/owners",
            "/owner",
            "/founder",
            "/license",
            "/licenses",
            "/contact",
            "/contact-us",
        ]
    const maxDefaults = depth <= 1 ? 1 : depth === 2 ? 9 : stagePaths.length
    return stagePaths.slice(0, maxDefaults).map((path) => new URL(path, url.origin).toString())
}

export function californiaOwnerIdentityWebsiteUrls(baseUrl: string, depth: number, stageKey: CaliforniaOwnerWebsiteStageKey) {
    const url = new URL(baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`)
    if (stageKey !== "owner_identity") return defaultWebsiteUrls(baseUrl, depth, stageKey)
    const firstPaths = ["/", "/about", "/about-us", "/our-story", "/our-company", "/company", "/who-we-are", "/contact", "/contact-us"]
    const firstUrls = firstPaths.map((path) => new URL(path, url.origin).toString())
    const seen = new Set(firstUrls)
    const remaining = defaultWebsiteUrls(baseUrl, depth, stageKey).filter((candidate) => {
        if (seen.has(candidate)) return false
        seen.add(candidate)
        return true
    })
    return [...firstUrls, ...remaining]
}
