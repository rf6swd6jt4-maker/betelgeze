"use server"

import { revalidatePath } from "next/cache"
import { createRelationshipOnboardingSession } from "@/lib/onboarding/canonical"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

async function requireOnboardingManager(workspaceSlug: string, relationshipId: string) {
    const access = await requireWorkspace(workspaceSlug)
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
    const { workspace } = await requireOnboardingManager(workspaceSlug, relationshipId)
    const { data: session } = await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("relationship_id", relationshipId)
        .in("status", ["active", "completed"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    if (!session) return

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

export async function restartOnboarding(workspaceSlug: string, relationshipId: string) {
    const { workspace, user } = await requireOnboardingManager(workspaceSlug, relationshipId)
    const [{ data: modules }, { data: services }, { data: currentSession }] = await Promise.all([
        supabaseAdmin.from("relationship_onboarding_modules").select("module_key").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId),
        supabaseAdmin.from("relationship_services").select("service_key").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId),
        supabaseAdmin.from("relationship_onboarding_sessions").select("id, status").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).in("status", ["active", "completed"]).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ])

    if (currentSession?.status === "completed") {
        const { error } = await supabaseAdmin
            .from("relationship_onboarding_sessions")
            .update({ status: "archived", archived_at: new Date().toISOString() })
            .eq("id", currentSession.id)
            .eq("workspace_id", workspace.id)
        if (error) throw new Error("Could not archive the completed onboarding session")
    }

    await createRelationshipOnboardingSession({
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        relationshipId,
        moduleKeys: (modules ?? []).map((module) => module.module_key),
        serviceKeys: (services ?? []).map((service) => service.service_key),
        createdBy: user.id,
    })
}
