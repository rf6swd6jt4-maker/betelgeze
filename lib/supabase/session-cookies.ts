export const SESSION_COOKIE_NAME = "betelgeze-auth"
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14

export function sessionCookieDomain() {
    return process.env.SUPABASE_SESSION_DOMAIN ?? ".betelgeze.com"
}

export function browserSessionCookieDomain() {
    return process.env.NEXT_PUBLIC_SUPABASE_SESSION_DOMAIN ?? ".betelgeze.com"
}

export function sessionCookieOptions(domain: string) {
    return {
        name: SESSION_COOKIE_NAME,
        domain,
        path: "/",
        sameSite: "lax" as const,
        maxAge: SESSION_MAX_AGE_SECONDS,
    }
}

type SameSite = boolean | "lax" | "strict" | "none"

export function persistentSessionOptions<T extends { maxAge?: number; domain?: string; path?: string; sameSite?: SameSite }>(options: T, domain: string) {
    return {
        ...options,
        domain,
        path: options.path ?? "/",
        sameSite: options.sameSite ?? "lax" as const,
        maxAge: options.maxAge && options.maxAge > 0 ? Math.min(options.maxAge, SESSION_MAX_AGE_SECONDS) : options.maxAge,
    }
}
