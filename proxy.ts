import { NextResponse, type NextRequest } from "next/server"

export function proxy(request: NextRequest) {
    const legacyPath = request.nextUrl.pathname
    const legacyMatch = legacyPath.match(/^\/admin(?:\/(.*))?$/)
    if (legacyMatch) {
        const referer = request.headers.get("referer")
        const refererPath = referer ? new URL(referer).pathname : ""
        const refererWorkspace = refererPath.match(/^\/dashboard\/([^/]+)/)?.[1]
        const workspaceSlug = refererWorkspace ?? "scaylup"
        const suffix = legacyMatch[1] ?? ""
        const destination = suffix
            .replace(/^new$/, "clients/new")
            .replace(/^client\/(.+)$/, "clients/$1")
        const url = request.nextUrl.clone()
        url.pathname = `/dashboard/${workspaceSlug}${destination ? `/${destination}` : ""}`
        return NextResponse.redirect(url)
    }

    const dashboardMatch = legacyPath.match(/^\/dashboard\/([^/]+)(?:\/(.*))?$/)
    if (dashboardMatch) {
        const workspaceSlug = dashboardMatch[1]
        const suffix = dashboardMatch[2] ?? ""
        if (suffix !== "users") {
            const legacyDestination = suffix
                .replace(/^clients\/new$/, "new")
                .replace(/^clients\/(.+)$/, "client/$1")
            const headers = new Headers(request.headers)
            headers.set("x-betelgeze-workspace-slug", workspaceSlug)
            const url = request.nextUrl.clone()
            url.pathname = `/admin${legacyDestination ? `/${legacyDestination}` : ""}`
            return NextResponse.rewrite(url, { request: { headers } })
        }
    }

    const match = request.nextUrl.pathname.match(
        /^\/onboarding\/([a-z0-9][a-z0-9-]*)\/([a-f0-9]+)$/i
    )
    if (!match) return NextResponse.next()

    const headers = new Headers(request.headers)
    headers.set("x-betelgeze-workspace-slug", match[1].toLowerCase())
    const url = request.nextUrl.clone()
    url.pathname = `/session/${match[2]}`
    return NextResponse.rewrite(url, { request: { headers } })
}

export const config = {
    matcher: ["/onboarding/:path*", "/admin/:path*", "/dashboard/:path*"],
}
