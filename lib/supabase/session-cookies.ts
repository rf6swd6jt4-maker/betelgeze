export const SESSION_COOKIE_NAME = "betelgeze-auth"
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90
export const SESSION_RESPONSE_HEADER_NAMES = ["cache-control", "expires", "pragma"] as const

function configuredCookieDomain(value: string | undefined) {
    const domain = value?.trim()
    return domain || undefined
}

function defaultSessionCookieDomain() {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
    if (siteUrl) {
        try {
            const hostname = new URL(siteUrl).hostname.toLowerCase()
            if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return undefined
            if (hostname === "betelgeze.com" || hostname.endsWith(".betelgeze.com")) return ".betelgeze.com"
            return undefined
        } catch {
            return ".betelgeze.com"
        }
    }

    return ".betelgeze.com"
}

export function sessionCookieDomain() {
    return configuredCookieDomain(process.env.SUPABASE_SESSION_DOMAIN) ?? defaultSessionCookieDomain()
}

export function browserSessionCookieDomain() {
    return configuredCookieDomain(process.env.NEXT_PUBLIC_SUPABASE_SESSION_DOMAIN) ?? defaultSessionCookieDomain()
}

export function sessionCookieOptions(domain?: string) {
    const options = {
        name: SESSION_COOKIE_NAME,
        path: "/",
        sameSite: "lax" as const,
        maxAge: SESSION_MAX_AGE_SECONDS,
        secure: process.env.NODE_ENV === "production",
    }

    return domain ? { ...options, domain } : options
}

type SameSite = boolean | "lax" | "strict" | "none"

export function persistentSessionOptions<T extends { maxAge?: number; domain?: string; path?: string; sameSite?: SameSite; secure?: boolean }>(options: T, domain?: string) {
    const rest = { ...options }
    delete rest.domain

    return {
        ...rest,
        ...(domain ? { domain } : {}),
        path: options.path ?? "/",
        sameSite: options.sameSite ?? "lax" as const,
        maxAge: options.maxAge && options.maxAge > 0 ? Math.min(options.maxAge, SESSION_MAX_AGE_SECONDS) : options.maxAge,
    }
}

export function applySessionResponseHeaders(response: Response, headers: Record<string, string>) {
    for (const [name, value] of Object.entries(headers)) {
        response.headers.set(name, value)
    }
}

export function carrySessionResponse(source: Response, target: Response & { cookies: { set: (cookie: { name: string; value: string }) => unknown } }) {
    const sourceWithCookies = source as Response & { cookies?: { getAll: () => Array<{ name: string; value: string }> } }
    sourceWithCookies.cookies?.getAll().forEach((cookie) => target.cookies.set(cookie))
    for (const name of SESSION_RESPONSE_HEADER_NAMES) {
        const value = source.headers.get(name)
        if (value) target.headers.set(name, value)
    }
    return target
}
