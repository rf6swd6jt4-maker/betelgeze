import { NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE_NAME, sessionCookieDomain } from "@/lib/supabase/session-cookies"

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
