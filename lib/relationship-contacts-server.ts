import "server-only"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getClientPortalUrl } from "@/lib/client-portal/domain"
import type { RelationshipContacts } from "./relationship-contacts"

/** Call only after the request's relationship access check. */
export async function readRelationshipContacts(workspaceId: string, relationshipId: string, userId: string): Promise<RelationshipContacts> {
    const [choices, portal, workspace, full] = await Promise.all([
        supabaseAdmin.rpc("relationship_messaging_choices", { p_workspace_id: workspaceId, p_relationship_id: relationshipId }),
        supabaseAdmin.from("client_portal_sessions").select("created_at,status,token_revoked_at,session_token").eq("workspace_id", workspaceId).eq("relationship_id", relationshipId).maybeSingle(),
        supabaseAdmin.from("workspaces").select("custom_client_portal_domain,custom_client_portal_domain_status").eq("id", workspaceId).single(),
        supabaseAdmin.rpc("workspace_user_fully_covers_relationship", { p_workspace_id: workspaceId, p_relationship_id: relationshipId, p_user_id: userId }),
    ])
    if (choices.error || portal.error || workspace.error || full.error) throw new Error("Contact connections could not be checked.")
    const active = portal.data?.status === "active" && !portal.data.token_revoked_at
    return { choices: choices.data, portal: portal.data ? { createdAt: portal.data.created_at, active, url: active && full.data === true ? getClientPortalUrl({ sessionToken: portal.data.session_token, customDomain: workspace.data.custom_client_portal_domain, customDomainVerified: workspace.data.custom_client_portal_domain_status === "verified" }) : null } : null }
}
