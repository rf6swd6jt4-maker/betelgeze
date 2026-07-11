import type { AuthError, SupabaseClient, User } from "@supabase/supabase-js"

const DEFINITIVE_SESSION_ERROR_CODES = new Set([
    "bad_jwt",
    "refresh_token_already_used",
    "refresh_token_not_found",
    "session_not_found",
])

export function isDefinitiveSessionError(error: Pick<AuthError, "code" | "name" | "status"> | null) {
    if (!error) return false
    if (error.name === "AuthSessionMissingError") return true
    if (error.code && DEFINITIVE_SESSION_ERROR_CODES.has(error.code)) return true
    return error.status === 401 || error.status === 403
}

export async function getVerifiedUser(supabase: SupabaseClient): Promise<User | null> {
    const first = await supabase.auth.getUser()
    if (!first.error) return first.data.user
    if (isDefinitiveSessionError(first.error)) return null

    // A waking mobile PWA commonly encounters one transient network failure.
    // Retry once without discarding the still-valid device session.
    const retry = await supabase.auth.getUser()
    if (!retry.error) return retry.data.user
    if (isDefinitiveSessionError(retry.error)) return null

    // Let the route error boundary offer a retry. A temporary Auth/network
    // failure is not evidence that the user signed out.
    throw retry.error
}
