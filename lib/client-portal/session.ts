import { headers } from "next/headers"
import { clientBrandLogoUrl, loadWorkspaceClientBrandAssets } from "@/lib/client-branding/assets"
import { getClientPortalUrl } from "@/lib/client-portal/domain"
import { loadPublishedOnboardingTheme } from "@/lib/onboarding/configuration"
import { resolveOnboardingTheme } from "@/lib/onboarding/theme"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function resolveClientPortalAccessByToken(token: string) {
    if (!/^[a-f0-9]{64}$/i.test(token)) return null

    const requestHeaders = await headers()
    const workspaceSlug = requestHeaders.get("x-betelgeze-workspace-slug")
    const { data: session, error: sessionError } = await supabaseAdmin
        .from("client_portal_sessions")
        .select("id, workspace_id, relationship_id, onboarding_session_id, status, token_revoked_at, created_at")
        .eq("session_token", token.toLowerCase())
        .maybeSingle()
    if (sessionError || !session || session.status !== "active" || session.token_revoked_at) return null

    const workspaceQuery = supabaseAdmin
        .from("workspaces")
        .select("id, name, slug, status, custom_client_portal_domain, custom_client_portal_domain_status")
        .eq("id", session.workspace_id)
        .eq("status", "active")
    const [{ data: workspace }, { data: relationship, error: relationshipError }] = await Promise.all([
        workspaceSlug ? workspaceQuery.eq("slug", workspaceSlug).maybeSingle() : workspaceQuery.maybeSingle(),
        supabaseAdmin
            .from("relationships")
            .select("id, client_id, primary_person_name, business_name")
            .eq("workspace_id", session.workspace_id)
            .eq("id", session.relationship_id)
            .neq("status", "archived")
            .maybeSingle(),
    ])
    if (!workspace || relationshipError || !relationship) return null

    return { session, workspace, relationship }
}

export async function loadClientPortalSessionByToken(token: string) {
    const resolved = await resolveClientPortalAccessByToken(token)
    if (!resolved) return null
    const [theme] = await Promise.all([
        loadPublishedOnboardingTheme(resolved.session.workspace_id),
        supabaseAdmin
            .from("client_portal_sessions")
            .update({ last_accessed_at: new Date().toISOString() })
            .eq("workspace_id", resolved.session.workspace_id)
            .eq("id", resolved.session.id),
    ])

    return { ...resolved, theme }
}

export async function loadClientPortalStartupAppearance(token: string) {
    if (!/^[a-f0-9]{64}$/i.test(token)) return null
    const { data: session, error } = await supabaseAdmin
        .from("client_portal_sessions")
        .select("workspace_id, status, token_revoked_at")
        .eq("session_token", token.toLowerCase())
        .maybeSingle()
    if (error || !session || session.status !== "active" || session.token_revoked_at) return null

    const [theme, assets] = await Promise.all([
        loadPublishedOnboardingTheme(session.workspace_id),
        loadWorkspaceClientBrandAssets(session.workspace_id),
    ])
    if (assets.workspaceStatus !== "active") return null
    return {
        backgroundColor: resolveOnboardingTheme(theme).pageBackground,
        logoSrc: clientBrandLogoUrl("client-portal", token, assets.logoPath),
    }
}

export async function getClientPortalUrlForOnboardingSession(input: {
    workspaceId: string
    relationshipId: string
}) {
    const [{ data: portalSession }, { data: workspace }] = await Promise.all([
        supabaseAdmin
            .from("client_portal_sessions")
            .select("session_token, status, token_revoked_at")
            .eq("workspace_id", input.workspaceId)
            .eq("relationship_id", input.relationshipId)
            .maybeSingle(),
        supabaseAdmin
            .from("workspaces")
            .select("custom_client_portal_domain, custom_client_portal_domain_status")
            .eq("id", input.workspaceId)
            .maybeSingle(),
    ])
    if (!portalSession || portalSession.status !== "active" || portalSession.token_revoked_at || !workspace) return null
    return getClientPortalUrl({
        sessionToken: portalSession.session_token,
        customDomain: workspace.custom_client_portal_domain,
        customDomainVerified: workspace.custom_client_portal_domain_status === "verified",
    })
}
