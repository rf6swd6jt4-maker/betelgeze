import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"
import { PUSH_DEVICE_COOKIE, PUSH_DEVICE_COOKIE_MAX_AGE, UUID_PATTERN } from "@/lib/push/device"
import { devicePlatform } from "@/lib/auth/device-platform"

export async function POST(request: NextRequest) {
    if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 })
    const input = await request.json().catch(() => null)
    const current = request.cookies.get(PUSH_DEVICE_COOKIE)?.value
    const device = current && UUID_PATTERN.test(current) ? current : randomUUID()
    const response = new NextResponse(null, { headers: { "Cache-Control": "no-store" } })
    const supabase = createSupabaseRouteClient(request, response)
    // The RPC validates the signed JWT, AAL2 and live Auth session. No caller-
    // supplied account/session ID or privileged client participates in this read.
    const { data, error } = await supabase.rpc("account_devices", { p_device: device, p_agent: request.headers.get("user-agent"), p_list: input?.list === true })
    if (error) return NextResponse.json({ error: "Could not load signed-in devices. Please retry." }, { status: error.code === "42501" ? 401 : 503, headers: response.headers })
    const result = NextResponse.json({ ...data, devices: data.devices?.map((entry: { user_agent: string | null }) => {
        const { user_agent, ...safe } = entry
        return { ...safe, ...devicePlatform(user_agent) }
    }) }, { headers: response.headers })
    result.cookies.set(PUSH_DEVICE_COOKIE, device, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: PUSH_DEVICE_COOKIE_MAX_AGE })
    return result
}
