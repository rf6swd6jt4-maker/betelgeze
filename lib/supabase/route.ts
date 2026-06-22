import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

const SESSION_MAX_AGE = 60 * 60 * 24 * 7
const SESSION_DOMAIN = process.env.SUPABASE_SESSION_DOMAIN ?? ".betelgeze.com"
const SESSION_COOKIE_NAME = "betelgeze-auth"

export function createSupabaseRouteClient(request: NextRequest, response: NextResponse) {
    return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        cookieOptions: { name: SESSION_COOKIE_NAME, domain: SESSION_DOMAIN },
        cookies: {
            getAll: () => request.cookies.getAll(),
            setAll: (items) => items.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, domain: SESSION_DOMAIN, maxAge: options.maxAge ?? SESSION_MAX_AGE })),
        },
    })
}
