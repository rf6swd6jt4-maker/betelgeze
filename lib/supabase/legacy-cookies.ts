import { NextRequest, NextResponse } from "next/server"

// Clear only host-only cookies left by the pre-SSO deployment. The shared
// .betelgeze.com session remains intact.
export function clearLegacyHostOnlyAuthCookies(request: NextRequest, response: NextResponse) {
    const names = new Set(request.cookies.getAll().map((cookie) => cookie.name).filter((name) => /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/i.test(name)))
    for (const name of names) {
        response.headers.append("Set-Cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`)
    }
}
