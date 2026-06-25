import type { User } from "@supabase/supabase-js"
import { supabaseAdmin } from "@/lib/supabase/admin"

const authUserPageSize = 1000

export async function findAuthUserByEmail(email: string): Promise<User | null> {
    const normalisedEmail = email.trim().toLowerCase()
    if (!normalisedEmail) return null

    let page = 1
    while (page <= 10) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage: authUserPageSize,
        })
        if (error) return null

        const user = data.users.find((item) => item.email?.toLowerCase() === normalisedEmail)
        if (user) return user
        if (!data.nextPage) return null
        page = data.nextPage
    }

    return null
}

export function isEmailConfirmed(user: User | null) {
    return Boolean(user?.email_confirmed_at ?? user?.confirmed_at)
}
