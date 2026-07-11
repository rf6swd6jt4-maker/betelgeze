import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"
import { clearCurrentDeviceAuthCookies } from "@/lib/supabase/legacy-cookies"

export function GET(request: NextRequest) {
    // GET must never mutate authentication state. Next.js may prefetch links
    // to GET routes before the user clicks them.
    return NextResponse.redirect(new URL("/", request.url))
}

export async function POST(request: NextRequest) {
    const response = NextResponse.redirect(new URL("/login?loggedOut=1", request.url))
    await createSupabaseRouteClient(request, response).auth.signOut({ scope: "local" }).catch(() => undefined)
    clearCurrentDeviceAuthCookies(request, response)
    return response
}
