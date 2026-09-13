import { supabaseAdmin } from "@/lib/supabase/admin"

export type OnboardingSessionAccess = {
    moduleIds: string[]
    fullSessionIds: string[]
    sessionIds: string[]
    serviceNamesBySession: Record<string, string[]>
}
export type OnboardingPanelSession = {
    id: string
    relationship_id: string
    status: string
    session_token: string | null
    is_test: boolean
    created_by: string | null
    created_at: string
    updated_at: string
    completed_at: string | null
    service_scope: string
    source_sale_id: string | null
}
export async function loadOnboardingSessionPage(workspaceId: string, userId: string, page: number, relationshipId?: string) {
    const { data, error } = await supabaseAdmin.rpc("read_onboarding_panel_sessions", {
        p_workspace_id: workspaceId,
        p_user_id: userId,
        p_offset: page * 50,
        p_relationship_id: relationshipId ?? null,
    })
    if (error) throw new Error("Could not load onboarding sessions.")
    return data as { sessions: OnboardingPanelSession[]; access: OnboardingSessionAccess; hasMore: boolean }
}
export function onboardingPageNumber(value?: string) {
    const page = Number(value ?? 0)
    return Number.isSafeInteger(page) && page >= 0 ? Math.min(page, 2000) : 0
}
