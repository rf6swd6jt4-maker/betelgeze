import "server-only"

import { getClientPortalUrl } from "@/lib/client-portal/domain"
import { getOnboardingUrl } from "@/lib/onboarding/client-creation"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function loadRelationshipLinks(workspace: { id: string; slug: string }, relationshipId: string) {
    const [relationship, sales, soldInstances, postOnboardingInstances, sessions, portal, domains] = await Promise.all([
        supabaseAdmin.from("relationships").select("lifecycle_phase,status").eq("workspace_id", workspace.id).eq("id", relationshipId).maybeSingle(),
        supabaseAdmin.from("client_sales").select("id").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).in("status", ["paid", "test_paid"]).limit(1),
        supabaseAdmin.from("relationship_service_instances").select("id").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("disposition", "active").in("stage", ["onboarding", "setup", "maintenance", "completed"]).limit(1),
        supabaseAdmin.from("relationship_service_instances").select("id").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("disposition", "active").in("stage", ["setup", "maintenance", "completed"]).limit(1),
        supabaseAdmin.from("relationship_onboarding_sessions").select("id,session_token,status,is_test,created_at,completed_at,token_revoked_at").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).order("created_at", { ascending: false }).limit(20),
        supabaseAdmin.from("client_portal_sessions").select("id,session_token,status,token_revoked_at,created_at,last_accessed_at").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).maybeSingle(),
        supabaseAdmin.from("workspaces").select("custom_onboarding_domain,custom_onboarding_domain_status,custom_client_portal_domain,custom_client_portal_domain_status").eq("id", workspace.id).maybeSingle(),
    ])
    if (relationship.error || sales.error || soldInstances.error || postOnboardingInstances.error || sessions.error || portal.error || domains.error || !relationship.data || !domains.data) throw new Error("Relationship links could not load")
    const sold = Boolean(sales.data?.length || soldInstances.data?.length)
    const afterOnboarding = Boolean(postOnboardingInstances.data?.length)
        || (["fulfilment", "retention"].includes(relationship.data.lifecycle_phase) && sold)
    const validSessions = (sessions.data ?? []).filter((row) => ["active", "completed"].includes(row.status) && !row.token_revoked_at)
    const validPortal = portal.data?.status === "active" && !portal.data.token_revoked_at ? portal.data : null
    return {
        sold,
        onboardingAvailable: sold && validSessions.length > 0,
        onboardingSessions: validSessions.map((row) => ({ id: row.id, status: row.status, isTest: row.is_test, createdAt: row.created_at, url: getOnboardingUrl(workspace.slug, row.session_token, domains.data!.custom_onboarding_domain, domains.data!.custom_onboarding_domain_status === "verified") })),
        canGeneratePortal: afterOnboarding && relationship.data.status !== "archived",
        portal: validPortal ? { id: validPortal.id, url: getClientPortalUrl({ sessionToken: validPortal.session_token, customDomain: domains.data.custom_client_portal_domain, customDomainVerified: domains.data.custom_client_portal_domain_status === "verified" }), createdAt: validPortal.created_at, lastAccessedAt: validPortal.last_accessed_at } : null,
    }
}
