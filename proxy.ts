import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

async function refreshSession(request: NextRequest) {
    const response = NextResponse.next({ request: { headers: new Headers(request.headers) } })
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => request.cookies.getAll(), setAll: (items) => items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)) } })
    await supabase.auth.getUser()
    return response
}

function carryCookies(target: NextResponse, source: NextResponse) {
    source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie))
    return target
}

function requestHostname(request: NextRequest) {
    return request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? null
}

function isPlatformHost(domain: string) {
    if (!process.env.NEXT_PUBLIC_SITE_URL) return false
    return new URL(process.env.NEXT_PUBLIC_SITE_URL).hostname.toLowerCase() === domain
}

async function getCustomDomainWorkspace(domain: string) {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!baseUrl || !anonKey) return null

    const response = await fetch(`${baseUrl}/rest/v1/rpc/resolve_workspace_onboarding_domain`, {
        method: "POST",
        headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ requested_domain: domain }),
        cache: "no-store",
    })
    if (!response.ok) return null

    const result = await response.json() as Array<{ workspace_slug?: string; domain_status?: string }>
    const workspace = result[0]
    return workspace?.workspace_slug
        ? { slug: workspace.workspace_slug, status: workspace.domain_status ?? "verified" }
        : null
}

export async function proxy(request: NextRequest) {
    const path = request.nextUrl.pathname
    const domain = requestHostname(request)

    if (domain && !isPlatformHost(domain)) {
        const workspace = await getCustomDomainWorkspace(domain)
        if (workspace) {
            const customToken = path.match(/^\/([a-f0-9]{64})$/i)
            if (workspace.status !== "verified" || !customToken) {
                return new NextResponse("Not Found", { status: 404 })
            }
            const headers = new Headers(request.headers)
            headers.set("x-betelgeze-workspace-slug", workspace.slug)
            headers.set("x-betelgeze-custom-onboarding-domain", domain)
            const url = request.nextUrl.clone()
            url.pathname = `/session/${customToken[1]}`
            return NextResponse.rewrite(url, { request: { headers } })
        }
    }

    const sessionResponse = await refreshSession(request)
    const legacyMatch = path.match(/^\/admin(?:\/(.*))?$/)
    if (legacyMatch) {
        const referer = request.headers.get("referer")
        const workspaceSlug = referer ? new URL(referer).pathname.match(/^\/dashboard\/([^/]+)/)?.[1] ?? "scaylup" : "scaylup"
        const suffix = (legacyMatch[1] ?? "").replace(/^new$/, "clients/new").replace(/^client\/(.+)$/, "clients/$1")
        const url = request.nextUrl.clone()
        url.pathname = `/dashboard/${workspaceSlug}${suffix ? `/${suffix}` : ""}`
        return carryCookies(NextResponse.redirect(url), sessionResponse)
    }

    const dashboardMatch = path.match(/^\/dashboard\/([^/]+)(?:\/(.*))?$/)
    if (dashboardMatch) {
        const [, workspaceSlug, suffix = ""] = dashboardMatch
        if (suffix !== "users" && suffix !== "settings") {
            const headers = new Headers(request.headers)
            headers.set("x-betelgeze-workspace-slug", workspaceSlug)
            const url = request.nextUrl.clone()
            const legacyDestination = suffix.replace(/^clients\/new$/, "new").replace(/^clients\/(.+)$/, "client/$1")
            url.pathname = `/admin${legacyDestination ? `/${legacyDestination}` : ""}`
            return carryCookies(NextResponse.rewrite(url, { request: { headers } }), sessionResponse)
        }
    }

    const onboarding = path.match(/^\/onboarding\/([a-z0-9][a-z0-9-]*)\/([a-f0-9]+)$/i)
    if (!onboarding) return sessionResponse
    const headers = new Headers(request.headers)
    headers.set("x-betelgeze-workspace-slug", onboarding[1].toLowerCase())
    const url = request.nextUrl.clone()
    url.pathname = `/session/${onboarding[2]}`
    return carryCookies(NextResponse.rewrite(url, { request: { headers } }), sessionResponse)
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"] }
