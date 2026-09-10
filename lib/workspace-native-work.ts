import "server-only"

import { notFound } from "next/navigation"
import { loadRelationshipContext } from "@/components/workspace/ClientContextPanel"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { getRelationship, listRelationshipTimelineItems, listWorkQueueItems, nativeItemHref, workItemHref } from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { accessibleRelationshipIds, accessibleWorkItemIds, requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"

export async function loadNativeWork(workspaceSlug: string, relationshipId?: string) {
    const { workspace, user, role, access } = await requireWorkspacePanel(workspaceSlug, "fulfilment")
    const identity = { userId: user.id, workspaceId: workspace.id, workspaceSlug: workspace.slug }
    if (relationshipId) {
        await requireRelationshipAccess(access, relationshipId)
        const relationship = await getRelationship(workspace.id, relationshipId)
        if (!relationship) notFound()
        const [allItems, allowedIds] = await Promise.all([listRelationshipTimelineItems(workspace.slug, relationship), accessibleWorkItemIds(access, new Set([relationship.id]))])
        const openItems = allItems.filter((item) => (!allowedIds || allowedIds.has(item.id) || Boolean(item.synthesized && item.lifecycle_phase === "fulfilment")) && !["done", "canceled"].includes(item.status))
        const context = await loadRelationshipContext({ workspaceSlug, relationship, access, metrics: [{ label: "Open work", value: openItems.length }] })
        return {
            ...identity, kind: "work-detail" as const, role, context, openCount: openItems.length,
            relationship: { id: relationship.id, primary_person_name: relationship.primary_person_name, business_name: relationship.business_name, lifecycle_phase: relationship.lifecycle_phase, updated_at: relationship.updated_at, isTest: relationship.source_metadata.is_test === true },
            openItems: openItems.slice(0, 6).map((item) => ({ id: item.id, title: item.title, status: item.status, lifecycle_phase: item.lifecycle_phase, href: item.synthesized ? item.native_href ?? workItemHref(workspace.slug, item.id) : workItemHref(workspace.slug, item.id) })),
        }
    }
    const allowedRelationships = await accessibleRelationshipIds(access)
    const [allItems, allowedWorkItems] = await Promise.all([listWorkQueueItems(workspace.slug, workspace.id), accessibleWorkItemIds(access, allowedRelationships)])
    const items = allItems.filter((item) => (!allowedWorkItems || allowedWorkItems.has(item.id) || Boolean(item.synthesized && item.relationship_id && allowedRelationships?.has(item.relationship_id))) && (item.lifecycle_phase === "fulfilment" || item.relationship?.lifecycle_phase === "fulfilment"))
    const creatorIds = [...new Set(items.flatMap((item) => item.created_by ? [item.created_by] : []))]
    const profiles = creatorIds.length ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", creatorIds) : { data: [], error: null }
    if (profiles.error) throw new Error("Could not load work creators")
    const creators = new Map((profiles.data ?? []).map((creator) => [creator.user_id, creator]))
    return {
        ...identity, kind: "work" as const, context: null,
        items: items.map((item) => {
            const creator = creators.get(item.created_by ?? "")
            return {
                id: item.id, title: item.title, description: item.description, status: item.status, is_key_task: item.is_key_task,
                due_date: item.due_date, planned_start_date: item.planned_start_date, actual_start_at: item.actual_start_at, created_at: item.created_at, updated_at: item.updated_at,
                relationship_id: item.relationship_id, relationship: item.relationship ? { primary_person_name: item.relationship.primary_person_name, business_name: item.relationship.business_name } : null,
                href: nativeItemHref(workspace.slug, item), creator: creator ? { username: creator.username, avatar: creator.avatar_path ? profileAvatarUrl(creator.username, creator.avatar_path) : null } : null,
            }
        }),
    }
}

export type NativeWorkSnapshot = Awaited<ReturnType<typeof loadNativeWork>>
