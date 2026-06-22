import { NextRequest, NextResponse } from "next/server"
import { clearLegacyHostOnlyAuthCookies } from "@/lib/supabase/legacy-cookies"

export async function POST(request: NextRequest) {
    const response = NextResponse.json({ ok: true })
    clearLegacyHostOnlyAuthCookies(request, response)
    return response
}
