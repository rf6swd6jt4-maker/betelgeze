"use client"

import { createClient } from "@supabase/supabase-js"

// Recovery links are deliberately implicit rather than PKCE. A recipient can
// open an email link in a different browser from the one that requested it.
export function createSupabaseRecoveryClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            auth: {
                flowType: "implicit",
                detectSessionInUrl: true,
            },
        }
    )
}
