import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { clearLegacyHostOnlyAuthCookies } from "@/lib/supabase/legacy-cookies"
import { persistentSessionOptions, sessionCookieDomain, sessionCookieOptions } from "@/lib/supabase/session-cookies"

async function refreshSession(request: NextRequest) {
    const headers = requestHeadersWithCurrentPath(request)
    const response = NextResponse.next({ request: { headers } })
    const sessionDomain = sessionCookieDomain()
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookieOptions: sessionCookieOptions(sessionDomain), cookies: { getAll: () => request.cookies.getAll(), setAll: (items) => items.forEach(({ name, value, options }) => response.cookies.set(name, value, persistentSessionOptions(options, sessionDomain))) } })
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
const APP_HOST = "app.betelgeze.com"
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
    return NextResponse.rewrite(url, { request: { headers: requestHeadersWithCurrentPath(request, headers) } })
}

function withRedirect(request: NextRequest, pathname: string) {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    return NextResponse.redirect(url)
}

function isPlatformHost(domain: string) {
    if (["betelgeze.com", "www.betelgeze.com", APP_HOST, DASHBOARD_HOST, ONBOARDING_HOST, AUTH_HOST, LEADGEN_HOST].includes(domain)) return true
    if (!process.env.NEXT_PUBLIC_SITE_URL) return false
    return new URL(process.env.NEXT_PUBLIC_SITE_URL).hostname.toLowerCase() === domain
}

function shouldRefreshSessionForDomain(domain: string | null) {
    if (!domain) return false
    if (isPlatformHost(domain)) return true
    return domain === "localhost" || domain === "127.0.0.1" || domain === "::1"
}

function requestCurrentPath(request: NextRequest) {
    return `${request.nextUrl.pathname}${request.nextUrl.search}`
}

function requestHeadersWithCurrentPath(request: NextRequest, headers = request.headers) {
    const nextHeaders = new Headers(headers)
    nextHeaders.set("x-betelgeze-current-path", requestCurrentPath(request))
    return nextHeaders
}

function isAppHost(domain: string | null) {
    return domain === APP_HOST || domain === DASHBOARD_HOST
}

function appReturnUrl(domain: string | null, nextParam: string | null) {
    if (nextParam && /^https:\/\/(app|dashboard|onboarding|leadgen)\.betelgeze\.com(?:\/|$)/.test(nextParam)) {
        return nextParam
    }
    const host = domain ?? APP_HOST
    if (nextParam?.startsWith("/") && !nextParam.startsWith("//")) return `https://${host}${nextParam}`
    return `https://${host}/`
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
    let sessionResponsePromise: Promise<NextResponse> | null = null

    async function refreshedSessionResponse() {
        if (!shouldRefreshSessionForDomain(domain)) {
            return NextResponse.next({ request: { headers: requestHeadersWithCurrentPath(request) } })
        }
        sessionResponsePromise ??= refreshSession(request)
        return sessionResponsePromise
    }

    async function withSession(response: NextResponse) {
        const responseWithSession = carryCookies(response, await refreshedSessionResponse())
        clearLegacyHostOnlyAuthCookies(request, responseWithSession)
        return responseWithSession
    }

    const isCentralAuthRoute = AUTH_PATHS.some((authPath) => path === authPath || path.startsWith(`${authPath}/`))
    const isApexAccountRoute = APEX_ACCOUNT_PATHS.some((accountPath) => path === accountPath || path.startsWith(`${accountPath}/`))

    if (domain && domain !== "betelgeze.com" && domain !== "www.betelgeze.com" && isApexAccountRoute) {
        const destination = new URL(`https://betelgeze.com${path}`)
        destination.search = request.nextUrl.search
        return withSession(NextResponse.redirect(destination))
    }

    if ((domain === "betelgeze.com" || domain === "www.betelgeze.com") && path === "/" && (request.nextUrl.searchParams.has("code") || request.nextUrl.searchParams.has("token_hash"))) {
        const destination = new URL(`https://${AUTH_HOST}/auth/callback`)
        request.nextUrl.searchParams.forEach((value, key) => destination.searchParams.set(key, value))
        if (!destination.searchParams.has("next")) destination.searchParams.set("next", "/confirmed")
        destination.searchParams.set("confirmed_redirect", "1")
        return withSession(NextResponse.redirect(destination))
    }

    if (domain === DASHBOARD_HOST && (path === "/login" || path === "/mfa")) {
        const next = appReturnUrl(domain, request.nextUrl.searchParams.get("next"))
        return withSession(NextResponse.redirect(new URL(`${path}?next=${encodeURIComponent(next)}`, `https://${AUTH_HOST}`)))
    }

    if (domain === DASHBOARD_HOST && isCentralAuthRoute) {
        const destination = new URL(`https://${AUTH_HOST}${path}`)
        destination.search = request.nextUrl.search
        return withSession(NextResponse.redirect(destination))
    }

    // Keep the existing route tree intact while presenting clean product URLs.
    // The redirects also clean up legacy /dashboard links copied from old emails
    // or rendered by pages that have not yet been converted to relative links.
    if (isAppHost(domain)) {
        if (path === "/leadgen" || path.startsWith("/leadgen/")) {
            const headers = new Headers(request.headers)
            const workspaceSlug = path.match(/^\/leadgen\/([a-z0-9][a-z0-9-]*)/i)?.[1]
            if (workspaceSlug) headers.set("x-betelgeze-workspace-slug", workspaceSlug.toLowerCase())
            return withSession(withRewrite(request, path, headers))
        }
        if (path === "/dashboard") return withSession(withRedirect(request, "/"))
        if (path.startsWith("/dashboard/")) return withSession(withRedirect(request, path.slice("/dashboard".length)))

        const publicDashboardPaths = [
            "/login", "/sign-up", "/forgot-password", "/update-password",
            "/mfa", "/logout", "/privacy", "/users", "/invites", "/auth", "/workspaces", "/install",
        ]
        const isPublicDashboardPath = publicDashboardPaths.some(
            (publicPath) => path === publicPath || path.startsWith(`${publicPath}/`)
        )
        const workspacePath = path.match(/^\/([a-z0-9][a-z0-9-]*)(?:\/(.*))?$/i)
        if (!isPublicDashboardPath && workspacePath) {
            const [, workspaceSlug, suffix = ""] = workspacePath
            const headers = new Headers(request.headers)
            headers.set("x-betelgeze-workspace-slug", workspaceSlug)
            if (!suffix) {
                return withSession(withRewrite(request, `/dashboard/${workspaceSlug}/relationships`, headers))
            }
            if (
                suffix === "settings" ||
                suffix === "users" ||
                suffix === "communications" ||
                suffix === "work" ||
                suffix.startsWith("work/") ||
                suffix === "onboarding" ||
                suffix.startsWith("onboarding/") ||
                suffix === "relationships" ||
                suffix.startsWith("relationships/")
            ) {
                return withSession(withRewrite(request, `/dashboard/${workspaceSlug}/${suffix}`, headers))
            }
            if (suffix === "leadgen" || suffix.startsWith("leadgen/")) {
                const leadgenSuffix = suffix.replace(/^leadgen\/?/, "")
                return withSession(withRewrite(request, `/leadgen/${workspaceSlug}${leadgenSuffix ? `/${leadgenSuffix}` : ""}`, headers))
            }
        }
        if (path === "/") return withSession(withRewrite(request, "/dashboard"))
    }

    if (domain === AUTH_HOST) {
        if (path === "/") return withSession(withRewrite(request, "/login"))
        const isAuthPath = AUTH_PATHS.some((authPath) => path === authPath || path.startsWith(`${authPath}/`))
        if (!isAuthPath) {
            const destination = new URL(`https://${DASHBOARD_HOST}${path}`)
            destination.search = request.nextUrl.search
            return withSession(NextResponse.redirect(destination))
        }
    }

    // Leadgen is being restarted in the canonical application. Keep the host
    // out of custom-domain resolution and expose only its dedicated reset
    // surface until the new evidence-led workflow is ready.
    if (domain === LEADGEN_HOST) {
        if (isCentralAuthRoute) {
            const destination = new URL(`https://${AUTH_HOST}${path}`)
            destination.search = request.nextUrl.search
            return withSession(NextResponse.redirect(destination))
        }
        if (path === "/leadgen" || path.startsWith("/leadgen/")) {
            const headers = new Headers(request.headers)
            const workspaceSlug = path.match(/^\/leadgen\/([a-z0-9][a-z0-9-]*)/i)?.[1]
            if (workspaceSlug) headers.set("x-betelgeze-workspace-slug", workspaceSlug.toLowerCase())
            return withSession(withRewrite(request, path, headers))
        }
        if (path === "/dashboard" || path.startsWith("/dashboard/")) {
            const destination = new URL(`https://${DASHBOARD_HOST}${path === "/dashboard" ? "/" : path.slice("/dashboard".length)}`)
            destination.search = request.nextUrl.search
            return withSession(NextResponse.redirect(destination))
        }
        if (path === "/" || path === "/leadgen") return withSession(withRewrite(request, "/leadgen"))
        const workspacePath = path.match(/^\/([a-z0-9][a-z0-9-]*)(?:\/(.*))?$/i)
        if (workspacePath) {
            const headers = new Headers(request.headers)
            headers.set("x-betelgeze-workspace-slug", workspacePath[1].toLowerCase())
            const suffix = workspacePath[2] ? `/${workspacePath[2].replace(/\/$/, "")}` : ""
            return withSession(withRewrite(request, `/leadgen/${workspacePath[1].toLowerCase()}${suffix}`, headers))
        }
    }

    if ((domain === "betelgeze.com" || domain === "www.betelgeze.com") && isCentralAuthRoute) {
        const destination = new URL(`https://${AUTH_HOST}${path}`)
        destination.search = request.nextUrl.search
        return withSession(NextResponse.redirect(destination))
    }

    if (domain === ONBOARDING_HOST) {
        const canonicalOnboarding = path.match(/^\/onboarding\/[a-z0-9][a-z0-9-]*\/([a-f0-9]{64})$/i)
        if (canonicalOnboarding) return withSession(withRedirect(request, `/${canonicalOnboarding[1]}`))

        const token = path.match(/^\/([a-f0-9]{64})$/i)
        if (token) {
            const headers = new Headers(request.headers)
            headers.set("x-betelgeze-custom-onboarding-domain", domain)
            return withSession(withRewrite(request, `/session/${token[1]}`, headers))
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

    const refreshedResponse = await refreshedSessionResponse()
    clearLegacyHostOnlyAuthCookies(request, refreshedResponse)

    const onboarding = path.match(/^\/onboarding\/([a-z0-9][a-z0-9-]*)\/([a-f0-9]+)$/i)
    if (!onboarding) return refreshedResponse
    const headers = new Headers(request.headers)
    headers.set("x-betelgeze-workspace-slug", onboarding[1].toLowerCase())
    const url = request.nextUrl.clone()
    url.pathname = `/session/${onboarding[2]}`
    return carryCookies(NextResponse.rewrite(url, { request: { headers } }), refreshedResponse)
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"] }
