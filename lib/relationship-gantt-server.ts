import "server-only"

import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getRelationship } from "@/lib/relationships"
import { getRelationshipGanttPlan } from "@/lib/relationship-gantt"

export class RelationshipGanttNotFoundError extends Error {}

// Shared by the existing mutation actions and the quiet read endpoint.
export async function requireGantt(slug: string, relationshipId: string) {
    const context = await requireWorkspace(slug, "admin")
    const { data: relationship, error } = await supabaseAdmin.from("relationships")
        .select("id, lifecycle_phase")
        .eq("workspace_id", context.workspace.id).eq("id", relationshipId).maybeSingle()
    if (error) throw new Error("Could not verify relationship access")
    if (!relationship) throw new RelationshipGanttNotFoundError("Relationship not found")
    return { ...context, relationship }
}

export async function loadAuthorizedGanttPlan(context: Awaited<ReturnType<typeof requireGantt>>, relationshipId: string) {
    const relationship = await getRelationship(context.workspace.id, relationshipId)
    if (!relationship) return null
    return getRelationshipGanttPlan(context.workspace.slug, relationship)
}
