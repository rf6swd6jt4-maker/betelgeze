import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"

export async function GET(request: NextRequest) {
    const response = NextResponse.json({ userId: null }, { status: 401, headers: { "Cache-Control": "private, no-store" } })
    const auth = createSupabaseRouteClient(request, response)
    const { data, error } = await auth.auth.getUser()
    if (error || !data.user) return response
    const result = NextResponse.json({ userId: data.user.id }, { headers: { "Cache-Control": "private, no-store" } })
    for (const cookie of response.cookies.getAll()) result.cookies.set(cookie)
    return result
}
