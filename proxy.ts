import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

async function refreshSession(request: NextRequest) {
    const response = NextResponse.next({ request: { headers: new Headers(request.headers) } })
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookieOptions: { name: "betelgeze-auth", domain: process.env.SUPABASE_SESSION_DOMAIN ?? ".betelgeze.com" }, cookies: { getAll: () => request.cookies.getAll(), setAll: (items) => items.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, domain: process.env.SUPABASE_SESSION_DOMAIN ?? ".betelgeze.com" })) } })
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

const DASHBOARD_HOST = "dashboard.betelgeze.com"
const ONBOARDING_HOST = "onboarding.betelgeze.com"
const AUTH_HOST = "auth.betelgeze.com"
const LEADGEN_HOST = "leadgen.betelgeze.com"
const AUTH_PATHS = [
    "/login", "/mfa", "/forgot-password", "/update-password",
    "/confirmed", "/check-email", "/auth", "/logout", "/privacy",
]
const APEX_ACCOUNT_PATHS = ["/sign-up", "/invitation"]

function withRewrite(request: NextRequest, pathname: string, headers = request.headers) {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    return NextResponse.rewrite(url, { request: { headers: new Headers(headers) } })
}

function withRedirect(request: NextRequest, pathname: string) {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    return NextResponse.redirect(url)
}

function isPlatformHost(domain: string) {
    if (["betelgeze.com", "www.betelgeze.com", DASHBOARD_HOST, ONBOARDING_HOST, AUTH_HOST, LEADGEN_HOST].includes(domain)) return true
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

    const isCentralAuthRoute = AUTH_PATHS.some((authPath) => path === authPath || path.startsWith(`${authPath}/`))
    const isApexAccountRoute = APEX_ACCOUNT_PATHS.some((accountPath) => path === accountPath || path.startsWith(`${accountPath}/`))

    if (domain && domain !== "betelgeze.com" && domain !== "www.betelgeze.com" && isApexAccountRoute) {
        const destination = new URL(`https://betelgeze.com${path}`)
        destination.search = request.nextUrl.search
        return NextResponse.redirect(destination)
    }

    if ((domain === "betelgeze.com" || domain === "www.betelgeze.com") && path === "/" && (request.nextUrl.searchParams.has("code") || request.nextUrl.searchParams.has("token_hash"))) {
        const destination = new URL(`https://${AUTH_HOST}/auth/callback`)
        request.nextUrl.searchParams.forEach((value, key) => destination.searchParams.set(key, value))
        if (!destination.searchParams.has("next")) destination.searchParams.set("next", "/confirmed")
        destination.searchParams.set("confirmed_redirect", "1")
        return NextResponse.redirect(destination)
    }

    if (domain === DASHBOARD_HOST && isCentralAuthRoute) {
        const destination = new URL(`https://${AUTH_HOST}${path}`)
        destination.search = request.nextUrl.search
        return NextResponse.redirect(destination)
    }

    // Keep the existing route tree intact while presenting clean product URLs.
    // The redirects also clean up legacy /dashboard links copied from old emails
    // or rendered by pages that have not yet been converted to relative links.
    if (domain === DASHBOARD_HOST) {
        if (path === "/login" || path === "/mfa") {
            const next = `https://${DASHBOARD_HOST}${request.nextUrl.searchParams.get("next") ?? "/"}`
            return NextResponse.redirect(new URL(`${path}?next=${encodeURIComponent(next)}`, `https://${AUTH_HOST}`))
        }
        if (path === "/dashboard") return withRedirect(request, "/")
        if (path.startsWith("/dashboard/")) return withRedirect(request, path.slice("/dashboard".length))

        // The mature dashboard is implemented under /admin. Translate both
        // old internal links and the clean public workspace URLs before a
        // request reaches the parallel, minimal /dashboard route tree.
        const legacyAdminPath = path.match(/^\/admin(?:\/(.*))?$/)
        if (legacyAdminPath) {
            const referer = request.headers.get("referer")
            const workspaceSlug = referer
                ? new URL(referer).pathname.match(/^\/([a-z0-9][a-z0-9-]*)/i)?.[1] ?? "scaylup"
                : "scaylup"
            const suffix = (legacyAdminPath[1] ?? "").replace(/^new$/, "clients/new")
            return withRedirect(request, `/${workspaceSlug}${suffix ? `/${suffix}` : ""}`)
        }

        const publicDashboardPaths = [
            "/login", "/sign-up", "/forgot-password", "/update-password",
            "/mfa", "/logout", "/privacy", "/users", "/invites", "/auth", "/workspaces",
        ]
        const isPublicDashboardPath = publicDashboardPaths.some(
            (publicPath) => path === publicPath || path.startsWith(`${publicPath}/`)
        )
        const workspacePath = path.match(/^\/([a-z0-9][a-z0-9-]*)(?:\/(.*))?$/i)
        if (!isPublicDashboardPath && workspacePath) {
            const [, workspaceSlug, suffix = ""] = workspacePath
            const headers = new Headers(request.headers)
            headers.set("x-betelgeze-workspace-slug", workspaceSlug)
            if (suffix === "settings" || suffix === "users") {
                return withRewrite(request, `/dashboard/${workspaceSlug}/${suffix}`, headers)
            }
            const adminSuffix = suffix.replace(/^clients\/new$/, "new")
            return withRewrite(request, `/admin${adminSuffix ? `/${adminSuffix}` : ""}`, headers)
        }
        if (path === "/") return withRewrite(request, "/dashboard")
    }

    if (domain === AUTH_HOST) {
        if (path === "/") return withRewrite(request, "/login")
        const isAuthPath = AUTH_PATHS.some((authPath) => path === authPath || path.startsWith(`${authPath}/`))
        if (!isAuthPath) {
            const destination = new URL(`https://${DASHBOARD_HOST}${path}`)
            destination.search = request.nextUrl.search
            return NextResponse.redirect(destination)
        }
    }

    // Leadgen is being restarted in the canonical application. Keep the host
    // out of custom-domain resolution and expose only its dedicated reset
    // surface until the new evidence-led workflow is ready.
    if (domain === LEADGEN_HOST) {
        if (isCentralAuthRoute) {
            const destination = new URL(`https://${AUTH_HOST}${path}`)
            destination.search = request.nextUrl.search
            return NextResponse.redirect(destination)
        }
        if (path === "/" || path === "/leadgen") return withRewrite(request, "/leadgen")
    }

    if ((domain === "betelgeze.com" || domain === "www.betelgeze.com") && isCentralAuthRoute) {
        const destination = new URL(`https://${AUTH_HOST}${path}`)
        destination.search = request.nextUrl.search
        return NextResponse.redirect(destination)
    }

    if (domain === ONBOARDING_HOST) {
        const canonicalOnboarding = path.match(/^\/onboarding\/[a-z0-9][a-z0-9-]*\/([a-f0-9]{64})$/i)
        if (canonicalOnboarding) return withRedirect(request, `/${canonicalOnboarding[1]}`)

        const token = path.match(/^\/([a-f0-9]{64})$/i)
        if (token) {
            const headers = new Headers(request.headers)
            headers.set("x-betelgeze-custom-onboarding-domain", domain)
            return withRewrite(request, `/session/${token[1]}`, headers)
        }
    }

    if (domain && !isPlatformHost(domain)) {
        const workspace = await getCustomDomainWorkspace(domain)
        if (workspace) {
            const customToken = path.match(/^\/([a-f0-9]{64})$/i)
            const isDomainProbe = request.nextUrl.searchParams.has("__betelgeze_domain_probe")
            if ((!isDomainProbe && workspace.status !== "verified") || !customToken) {
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
