import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { persistentSessionOptions, sessionCookieDomain, sessionCookieOptions } from "@/lib/supabase/session-cookies"

export async function createSupabaseServerClient() {
    const cookieStore = await cookies()
    const sessionDomain = sessionCookieDomain()

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookieOptions: sessionCookieOptions(sessionDomain),
            cookies: {
                getAll: () => cookieStore.getAll(),
                setAll: (items) => {
                    try {
                        items.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, persistentSessionOptions(options, sessionDomain))
                        )
                    } catch {
                        // Server Components may refresh but cannot write cookies.
                    }
                },
            },
        }
    )
}
