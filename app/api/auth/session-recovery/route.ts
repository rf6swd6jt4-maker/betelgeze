import { NextRequest, NextResponse } from "next/server"
import { clearCurrentDeviceAuthCookies } from "@/lib/supabase/legacy-cookies"

export async function POST(request: NextRequest) {
    const response = NextResponse.json({ ok: true })
    clearCurrentDeviceAuthCookies(request, response)
    return response
}
