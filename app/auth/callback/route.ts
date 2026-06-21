import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"

export async function GET(request: NextRequest) {
    const url = request.nextUrl; const code = url.searchParams.get("code"); const requestedNext = url.searchParams.get("next") || "/dashboard"; const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/dashboard"
    const response = NextResponse.redirect(new URL(next, url.origin)); if (code) await createSupabaseRouteClient(request, response).auth.exchangeCodeForSession(code)
    return response
}
