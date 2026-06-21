import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

async function refreshSession(request: NextRequest) {
    const response = NextResponse.next({ request: { headers: new Headers(request.headers) } })
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => request.cookies.getAll(), setAll: (items) => items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)) } })
    await supabase.auth.getUser()
    return response
}
function carryCookies(target: NextResponse, source: NextResponse) { source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie)); return target }

export async function proxy(request: NextRequest) {
    const sessionResponse = await refreshSession(request)
    const path = request.nextUrl.pathname
    const legacyMatch = path.match(/^\/admin(?:\/(.*))?$/)
    if (legacyMatch) { const referer = request.headers.get("referer"); const workspaceSlug = referer ? new URL(referer).pathname.match(/^\/dashboard\/([^/]+)/)?.[1] ?? "scaylup" : "scaylup"; const suffix = (legacyMatch[1] ?? "").replace(/^new$/, "clients/new").replace(/^client\/(.+)$/, "clients/$1"); const url = request.nextUrl.clone(); url.pathname = `/dashboard/${workspaceSlug}${suffix ? `/${suffix}` : ""}`; return carryCookies(NextResponse.redirect(url), sessionResponse) }
    const dashboardMatch = path.match(/^\/dashboard\/([^/]+)(?:\/(.*))?$/)
    if (dashboardMatch) { const [, workspaceSlug, suffix = ""] = dashboardMatch; if (suffix !== "users" && suffix !== "settings") { const headers = new Headers(request.headers); headers.set("x-betelgeze-workspace-slug", workspaceSlug); const url = request.nextUrl.clone(); const legacyDestination = suffix.replace(/^clients\/new$/, "new").replace(/^clients\/(.+)$/, "client/$1"); url.pathname = `/admin${legacyDestination ? `/${legacyDestination}` : ""}`; return carryCookies(NextResponse.rewrite(url, { request: { headers } }), sessionResponse) } }
    const onboarding = path.match(/^\/onboarding\/([a-z0-9][a-z0-9-]*)\/([a-f0-9]+)$/i)
    if (!onboarding) return sessionResponse
    const headers = new Headers(request.headers); headers.set("x-betelgeze-workspace-slug", onboarding[1].toLowerCase()); const url = request.nextUrl.clone(); url.pathname = `/session/${onboarding[2]}`
    return carryCookies(NextResponse.rewrite(url, { request: { headers } }), sessionResponse)
}
export const config = { matcher: ["/onboarding/:path*", "/admin/:path*", "/dashboard/:path*"] }
