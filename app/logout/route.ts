import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"
import { clearCurrentDeviceAuthCookies } from "@/lib/supabase/legacy-cookies"

export async function GET(request: NextRequest) {
    const response = NextResponse.redirect(new URL("/login?loggedOut=1", request.url))
    await createSupabaseRouteClient(request, response).auth.signOut({ scope: "local" }).catch(() => undefined)
    clearCurrentDeviceAuthCookies(request, response)
    return response
}
