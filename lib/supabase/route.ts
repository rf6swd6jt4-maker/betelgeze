import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"
import { applySessionResponseHeaders, persistentSessionOptions, sessionCookieDomain, sessionCookieOptions } from "@/lib/supabase/session-cookies"

const SESSION_DOMAIN = sessionCookieDomain()

export function createSupabaseRouteClient(request: NextRequest, response: NextResponse) {
    return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        cookieOptions: sessionCookieOptions(SESSION_DOMAIN),
        cookies: {
            getAll: () => request.cookies.getAll(),
            setAll: (items, headers) => {
                items.forEach(({ name, value, options }) => response.cookies.set(name, value, persistentSessionOptions(options, SESSION_DOMAIN)))
                applySessionResponseHeaders(response, headers)
            },
        },
    })
}
