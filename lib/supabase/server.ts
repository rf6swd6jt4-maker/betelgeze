import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function createSupabaseServerClient() {
    const cookieStore = await cookies()

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookieOptions: {
                name: "betelgeze-auth",
                domain: process.env.SUPABASE_SESSION_DOMAIN ?? ".betelgeze.com",
            },
            cookies: {
                getAll: () => cookieStore.getAll(),
                setAll: (items) => {
                    try {
                        items.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    } catch {
                        // Server Components may refresh but cannot write cookies.
                    }
                },
            },
        }
    )
}
