import { createBrowserClient } from "@supabase/ssr"
import { getRequiredEnv } from "@/lib/env"
import { browserSessionCookieDomain, sessionCookieOptions } from "@/lib/supabase/session-cookies"

export function createClient() {
    return createBrowserClient(
        getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
        getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
        {
            cookieOptions: sessionCookieOptions(browserSessionCookieDomain()),
            auth: { autoRefreshToken: false },
        }
    )
}
