"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { workItemHref } from "@/lib/relationships"

const allowedStatuses = new Set(["todo", "doing", "waiting", "blocked", "done", "canceled"])

function optionalValue(formData: FormData, key: string) {
    const value = String(formData.get(key) ?? "").trim()
    return value || null
}

export async function updateWorkItemPlanning(slug: string, workItemId: string, formData: FormData) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const status = String(formData.get("status") ?? "todo")
    if (!allowedStatuses.has(status)) throw new Error("Invalid work item status")

    const { data: existing } = await supabaseAdmin.from("work_items")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("id", workItemId)
        .maybeSingle()
    if (!existing) throw new Error("Work item not found")

    const parentWorkItemId = optionalValue(formData, "parent_work_item_id")
    const waitForParent = parentWorkItemId ? formData.get("wait_for_parent") === "on" : false
    const dependencyIds = [...new Set(formData.getAll("dependency_ids").map(String).filter((id) => id && id !== workItemId && id !== parentWorkItemId))]
    const assigneeIds = [...new Set(formData.getAll("assignee_ids").map(String).filter(Boolean))]

    const [{ data: workspaceItems }, { data: workspaceEdges }, { data: workspaceMembers }] = await Promise.all([
        supabaseAdmin.from("work_items").select("id, parent_work_item_id, status").eq("workspace_id", workspace.id),
        supabaseAdmin.from("work_item_dependencies").select("work_item_id, depends_on_work_item_id").eq("workspace_id", workspace.id),
        supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspace.id),
    ])
    const workspaceItemIds = new Set((workspaceItems ?? []).map((row) => row.id))
    const workspaceMemberIds = new Set((workspaceMembers ?? []).map((row) => row.user_id))
    if (parentWorkItemId && !workspaceItemIds.has(parentWorkItemId)) throw new Error("Parent must belong to this workspace")
    if (dependencyIds.some((id) => !workspaceItemIds.has(id))) throw new Error("Dependencies must belong to this workspace")
    if (assigneeIds.some((id) => !workspaceMemberIds.has(id))) throw new Error("Assignees must belong to this workspace")
    const statusByItemId = new Map((workspaceItems ?? []).map((row) => [row.id, row.status]))
    const selectedPrerequisites = [...dependencyIds, ...(parentWorkItemId && waitForParent ? [parentWorkItemId] : [])]
    if (status === "doing" && selectedPrerequisites.some((id) => statusByItemId.get(id) !== "done")) {
        throw new Error("This work item is waiting for unfinished dependencies")
    }
    const childrenByParent = new Map<string, string[]>()
    for (const row of workspaceItems ?? []) {
        if (!row.parent_work_item_id) continue
        childrenByParent.set(row.parent_work_item_id, [...(childrenByParent.get(row.parent_work_item_id) ?? []), row.id])
    }
    const descendants = new Set<string>()
    const childQueue = [...(childrenByParent.get(workItemId) ?? [])]
    while (childQueue.length) {
        const id = childQueue.pop()!
        if (descendants.has(id)) continue
        descendants.add(id)
        childQueue.push(...(childrenByParent.get(id) ?? []))
    }
    if (parentWorkItemId && descendants.has(parentWorkItemId)) throw new Error("A child cannot become its ancestor's parent")

    const prerequisitesByItem = new Map<string, string[]>()
    for (const edge of workspaceEdges ?? []) {
        if (edge.work_item_id === workItemId) continue
        prerequisitesByItem.set(edge.work_item_id, [...(prerequisitesByItem.get(edge.work_item_id) ?? []), edge.depends_on_work_item_id])
    }
    for (const candidateId of selectedPrerequisites) {
        const visited = new Set<string>()
        const queue = [candidateId]
        while (queue.length) {
            const id = queue.pop()!
            if (id === workItemId) throw new Error("Work item dependencies cannot contain a cycle")
            if (visited.has(id)) continue
            visited.add(id)
            queue.push(...(prerequisitesByItem.get(id) ?? []))
        }
    }

    const { error: updateError } = await supabaseAdmin.from("work_items").update({
        status,
        parent_work_item_id: parentWorkItemId,
        planned_start_date: optionalValue(formData, "planned_start_date"),
        due_date: optionalValue(formData, "due_date"),
    }).eq("workspace_id", workspace.id).eq("id", workItemId)
    if (updateError) throw new Error(updateError.message)

    const { error: clearDependenciesError } = await supabaseAdmin.from("work_item_dependencies")
        .delete().eq("workspace_id", workspace.id).eq("work_item_id", workItemId)
    if (clearDependenciesError) throw new Error(clearDependenciesError.message)

    const dependencies = [
        ...dependencyIds.map((dependsOnId) => ({
            workspace_id: workspace.id,
            work_item_id: workItemId,
            depends_on_work_item_id: dependsOnId,
            source: "manual",
            created_by: user.id,
        })),
        ...(parentWorkItemId && waitForParent ? [{
            workspace_id: workspace.id,
            work_item_id: workItemId,
            depends_on_work_item_id: parentWorkItemId,
            source: "parent_auto",
            created_by: user.id,
        }] : []),
    ]
    if (dependencies.length) {
        const { error } = await supabaseAdmin.from("work_item_dependencies").insert(dependencies)
        if (error) throw new Error(error.message)
    }

    const { error: clearAssigneesError } = await supabaseAdmin.from("work_item_assignees")
        .delete().eq("workspace_id", workspace.id).eq("work_item_id", workItemId)
    if (clearAssigneesError) throw new Error(clearAssigneesError.message)
    if (assigneeIds.length) {
        const { error } = await supabaseAdmin.from("work_item_assignees").insert(assigneeIds.map((assigneeId) => ({
            workspace_id: workspace.id,
            work_item_id: workItemId,
            user_id: assigneeId,
            assigned_by: user.id,
        })))
        if (error) throw new Error(error.message)
    }

    revalidatePath(workItemHref(slug, workItemId))
    revalidatePath(`/${slug}/work`)
}
