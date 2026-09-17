import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"
import { clearCurrentDeviceAuthCookies } from "@/lib/supabase/legacy-cookies"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { PUSH_DEVICE_COOKIE, UUID_PATTERN } from "@/lib/push/device"
import { WORKSPACE_LAUNCH_COOKIE, WORKSPACE_LAUNCH_COOKIE_DOMAIN } from "@/lib/workspace-launch"

export function GET(request: NextRequest) {
    // GET must never mutate authentication state. Next.js may prefetch links
    // to GET routes before the user clicks them.
    return NextResponse.redirect(new URL("/", request.url))
}

export async function POST(request: NextRequest) {
    if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 })
    // Complete the POST/redirect/GET flow with 303 so the browser does not
    // preserve the POST method when it follows the redirect to the login page.
    const response = NextResponse.redirect(new URL("/login?loggedOut=1", request.url), 303)
    const auth = createSupabaseRouteClient(request, response)
    const pushDeviceId = request.cookies.get(PUSH_DEVICE_COOKIE)?.value
    if (pushDeviceId && UUID_PATTERN.test(pushDeviceId)) {
        const { error } = await supabaseAdmin.rpc("revoke_chat_push_device", { p_device: pushDeviceId })
        if (error) return NextResponse.json({ error: "Could not stop this device’s notifications. Please retry Log out." }, { status: 503 })
    }
    await auth.auth.signOut({ scope: "local" }).catch(() => undefined)
    response.cookies.set(PUSH_DEVICE_COOKIE, "", { path: "/", maxAge: 0 })
    response.cookies.set(WORKSPACE_LAUNCH_COOKIE, "", { path: "/", maxAge: 0 })
    response.cookies.set(WORKSPACE_LAUNCH_COOKIE, "", { domain: WORKSPACE_LAUNCH_COOKIE_DOMAIN, path: "/", maxAge: 0 })
    clearCurrentDeviceAuthCookies(request, response)
    return response
}
