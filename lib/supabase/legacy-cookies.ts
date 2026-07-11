import { NextRequest, NextResponse } from "next/server"
import { persistentSessionOptions, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, SESSION_MIGRATION_COOKIE_NAME, sessionCookieDomain, sessionCookieMigrationTarget } from "@/lib/supabase/session-cookies"

function authCookieNames(request: NextRequest) {
    return new Set(request.cookies.getAll().map((cookie) => cookie.name).filter(
        (name) => /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/i.test(name) || name === SESSION_COOKIE_NAME || name.startsWith(`${SESSION_COOKIE_NAME}.`)
    ))
}

function hostOnlyDeletion(name: string) {
    return `${name}=; Path=/; Max-Age=0; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
}

// Clear only host-only cookies left by the pre-SSO deployment. The shared
// .betelgeze.com session remains intact.
export function clearLegacyHostOnlyAuthCookies(request: NextRequest, response: NextResponse) {
    const sharedSessionUsesDomain = Boolean(sessionCookieDomain())
    const names = authCookieNames(request)
    for (const name of names) {
        if (!sharedSessionUsesDomain && (name === SESSION_COOKIE_NAME || name.startsWith(`${SESSION_COOKIE_NAME}.`))) continue
        response.headers.append("Set-Cookie", hostOnlyDeletion(name))
    }
}

export function clearCurrentDeviceAuthCookies(request: NextRequest, response: NextResponse) {
    const domain = sessionCookieDomain()
    for (const name of authCookieNames(request)) {
        if (domain) {
            response.cookies.set(name, "", {
                domain,
                path: "/",
                maxAge: 0,
                sameSite: "lax",
                secure: process.env.NODE_ENV === "production",
            })
        }
        response.headers.append("Set-Cookie", hostOnlyDeletion(name))
    }
}

export function migrateLegacyAuthCookies(request: NextRequest, response: NextResponse) {
    const domain = sessionCookieDomain()
    if (!domain || request.cookies.has(SESSION_MIGRATION_COOKIE_NAME)) return

    let migrated = false
    for (const cookie of request.cookies.getAll()) {
        const targetName = sessionCookieMigrationTarget(cookie.name)
        if (!targetName) continue

        migrated = true
        request.cookies.set(targetName, cookie.value)
        response.cookies.set(targetName, cookie.value, persistentSessionOptions({
            path: "/",
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: SESSION_MAX_AGE_SECONDS,
        }, domain))

        // Remove the host-only copy after the equivalent shared cookie has
        // been written. Deleting without Domain cannot remove the shared copy.
        response.headers.append("Set-Cookie", hostOnlyDeletion(cookie.name))
        if (cookie.name !== targetName) {
            response.cookies.set(cookie.name, "", {
                domain,
                path: "/",
                maxAge: 0,
                sameSite: "lax",
                secure: process.env.NODE_ENV === "production",
            })
        }
    }

    if (migrated) {
        response.cookies.set(SESSION_MIGRATION_COOKIE_NAME, "1", {
            domain,
            path: "/",
            maxAge: SESSION_MAX_AGE_SECONDS,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
        })
    }
}
