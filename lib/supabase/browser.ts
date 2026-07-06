"use client"

import { createBrowserClient } from "@supabase/ssr"
import { browserSessionCookieDomain, sessionCookieOptions } from "@/lib/supabase/session-cookies"

export function createSupabaseBrowserClient() {
    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookieOptions: sessionCookieOptions(browserSessionCookieDomain()),
            auth: {
                // Auth callback routes exchange one-time codes explicitly so a
                // page never races getUser() before the exchange completes.
                detectSessionInUrl: false,
            },
        }
    )
}
