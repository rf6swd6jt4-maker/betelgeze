"use server"

import { randomBytes } from "crypto"
import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { processWorkspaceOnboardingOutbox } from "@/lib/onboarding/outbox"
import { getOnboardingUrl } from "@/lib/onboarding/client-creation"
import { recordAdminActivity } from "@/lib/admin/activity"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"

type MutationRpcError = { code?: string; message?: string } | null | undefined

function isMissingOnboardingMutationRpc(error: MutationRpcError, functionName: string) {
    const message = error?.message?.toLowerCase() ?? ""
    return error?.code === "42883" || error?.code === "PGRST202" || (
        message.includes(functionName.toLowerCase()) && (
            message.includes("schema cache") || message.includes("does not exist") || message.includes("could not find")
        )
    )
}

async function requireOnboardingManager(workspaceSlug: string, relationshipId: string) {
    const access = await requireWorkspacePanel(workspaceSlug, "onboarding")
    await requireRelationshipAccess(access.access, relationshipId)
    if (access.role !== "owner" && access.role !== "admin") throw new Error("You do not have permission to manage onboarding")
    const { data: relationship } = await supabaseAdmin
        .from("relationships")
        .select("id")
        .eq("id", relationshipId)
        .eq("workspace_id", access.workspace.id)
        .maybeSingle()
    if (!relationship) throw new Error("Relationship not found")
    return access
}

export async function archiveOnboarding(workspaceSlug: string, relationshipId: string) {
    const { workspace, user } = await requireOnboardingManager(workspaceSlug, relationshipId)
    const { data: session } = await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .select("id, source_sale_id")
        .eq("workspace_id", workspace.id)
        .eq("relationship_id", relationshipId)
        .in("status", ["active", "completed"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    if (!session) return

    const { error: rpcError } = await supabaseAdmin.rpc("archive_relationship_onboarding_session", {
        p_workspace_id: workspace.id,
        p_relationship_id: relationshipId,
        p_session_id: session.id,
        p_actor_user_id: user.id,
        p_correlation_id: session.source_sale_id ?? session.id,
        p_idempotency_key: `onboarding.session.archived:${session.id}`,
    })
    if (!rpcError) {
        revalidatePath(`/${workspace.slug}/onboarding`)
        revalidatePath(`/${workspace.slug}/onboarding/${relationshipId}`)
        return
    }
    if (!isMissingOnboardingMutationRpc(rpcError, "archive_relationship_onboarding_session")) {
        throw new Error(rpcError.message || "Could not archive onboarding")
    }

    const now = new Date().toISOString()
    const { error } = await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .update({ status: "archived", archived_at: now })
        .eq("id", session.id)
        .eq("workspace_id", workspace.id)
    if (error) throw new Error("Could not archive onboarding")

    const { error: workItemsError } = await supabaseAdmin
        .from("work_items")
        .update({ status: "canceled", updated_at: now })
        .eq("workspace_id", workspace.id)
        .eq("native_kind", "onboarding_step")
        .like("native_key", `${session.id}:%`)
        .neq("status", "done")
    if (workItemsError) throw new Error("Onboarding was archived, but unfinished work could not be canceled")

    revalidatePath(`/${workspace.slug}/onboarding`)
    revalidatePath(`/${workspace.slug}/onboarding/${relationshipId}`)
}

export async function restartOnboarding(workspaceSlug: string, relationshipId: string, sessionId: string | null) {
    const { workspace, user } = await requireOnboardingManager(workspaceSlug, relationshipId)
    if (!sessionId) throw new Error("There is no onboarding session to restart")

    // The rendered session ID is the retry key. A stale/double click must never
    // restart a newly created run, and a failed clone must leave the old run intact.
    const { error } = await supabaseAdmin.rpc("restart_relationship_onboarding_session", {
        p_workspace_id: workspace.id,
        p_relationship_id: relationshipId,
        p_session_id: sessionId,
        p_actor_user_id: user.id,
    })
    if (error) {
        if (isMissingOnboardingMutationRpc(error, "restart_relationship_onboarding_session")) {
            throw new Error("Restart is temporarily unavailable. The current onboarding has not been changed.")
        }
        throw new Error(error.message || "Could not restart onboarding")
    }
    revalidatePath(`/${workspace.slug}/onboarding`)
    revalidatePath(`/${workspace.slug}/onboarding/${relationshipId}`)
    revalidatePath(`/${workspace.slug}/relationships/${relationshipId}`)
}

export async function revokeOnboardingToken(workspaceSlug: string, relationshipId: string, sessionId: string, tokenVersion: number) {
    const { workspace, user } = await requireOnboardingManager(workspaceSlug, relationshipId)
    const { data, error } = await supabaseAdmin.rpc("revoke_relationship_onboarding_session_token", {
        p_workspace_id: workspace.id,
        p_relationship_id: relationshipId,
        p_session_id: sessionId,
        p_actor_user_id: user.id,
        p_expected_token_version: tokenVersion,
        p_correlation_id: sessionId,
        p_idempotency_key: `onboarding.token.revoked:${sessionId}:${tokenVersion}`,
    })
    if (error) throw new Error(error.message || "Could not revoke the onboarding link")
    const notificationQueued = Boolean(data?.notification_queued)
    if (notificationQueued) {
        // The notification is durable before the response; provider delivery
        // must not keep the link controls waiting. The outbox owns retries.
        after(async () => {
            await processWorkspaceOnboardingOutbox(workspace.id, 25)
        })
    }
    revalidatePath(`/${workspace.slug}/onboarding/${relationshipId}`)
    revalidatePath(`/${workspace.slug}/communications`)
    return { ok: true as const, revoked: true as const, notificationQueued }
}

export async function rotateOnboardingToken(workspaceSlug: string, relationshipId: string) {
    const { workspace, user } = await requireOnboardingManager(workspaceSlug, relationshipId)
    const { data: session } = await supabaseAdmin.from("relationship_onboarding_sessions")
        .select("id, token_version, source_sale_id")
        .eq("workspace_id", workspace.id).eq("relationship_id", relationshipId)
        .in("status", ["active", "completed"]).order("updated_at", { ascending: false }).limit(1).maybeSingle()
    if (!session) throw new Error("Onboarding session not found")
    const token = randomBytes(32).toString("hex")
    const tokenVersion = (Number(session.token_version) || 1) + 1
    const correlationId = session.source_sale_id ?? session.id
    const idempotencyKey = `onboarding.token.rotated:${session.id}:${tokenVersion}`
    const { error: rpcError } = await supabaseAdmin.rpc("rotate_relationship_onboarding_session_token", {
        p_workspace_id: workspace.id,
        p_relationship_id: relationshipId,
        p_session_id: session.id,
        p_actor_user_id: user.id,
        p_expected_token_version: tokenVersion - 1,
        p_new_token: token,
        p_correlation_id: correlationId,
        p_idempotency_key: idempotencyKey,
    })
    if (!rpcError) {
        revalidatePath(`/${workspace.slug}/onboarding/${relationshipId}`)
        return {
            ok: true as const,
            path: getOnboardingUrl(
                workspace.slug,
                token,
                workspace.custom_onboarding_domain,
                workspace.custom_onboarding_domain_status === "verified"
            ),
        }
    }
    if (!isMissingOnboardingMutationRpc(rpcError, "rotate_relationship_onboarding_session_token")) {
        throw new Error(rpcError.message || "Could not rotate the onboarding link. Reload and try again")
    }
    const { data: updated, error } = await supabaseAdmin.from("relationship_onboarding_sessions")
        .update({ session_token: token, token_version: tokenVersion, token_revoked_at: null, updated_at: new Date().toISOString() })
        .eq("workspace_id", workspace.id).eq("id", session.id).eq("token_version", session.token_version ?? 1)
        .select("id").maybeSingle()
    if (error || !updated) throw new Error("Could not rotate the onboarding link. Reload and try again")
    await recordAdminActivity({
        workspaceId: workspace.id,
        category: "onboarding",
        eventKey: "onboarding.token.rotated",
        summary: "Onboarding link rotated",
        entityType: "onboarding_session",
        entityId: session.id,
        actorUserId: user.id,
        correlationId,
        idempotencyKey,
        sourceHref: `/${workspace.slug}/onboarding/${relationshipId}`,
        metadata: { relationship_id: relationshipId, token_version: tokenVersion },
    })
    revalidatePath(`/${workspace.slug}/onboarding/${relationshipId}`)
    return {
        ok: true as const,
        path: getOnboardingUrl(
            workspace.slug,
            token,
            workspace.custom_onboarding_domain,
            workspace.custom_onboarding_domain_status === "verified"
        ),
    }
}
