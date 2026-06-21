import { NextResponse, type NextRequest } from "next/server"

export function proxy(request: NextRequest) {
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
    matcher: "/onboarding/:path*",
}
