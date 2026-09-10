import "server-only"

import type { ComponentProps } from "react"
import { notFound } from "next/navigation"
import type { InlineWorkItemFields } from "@/app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields"
import { workItemStatusPresentation } from "@/components/list/work-item-presentation"
import { loadRelationshipContext } from "@/components/workspace/ClientContextPanel"
import { listWorkItemKeyResultLinks } from "@/lib/admin/okrs"
import { createUploadSignedUrl, createUploadSignedUrls } from "@/lib/onboarding/uploads"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { getAsset, getRelationship, getWorkItem, getWorkItemPlanningContext, listAssetRelationships, listAssetWorkItems, listWorkItemAssets, listWorkItemRelationships, listWorkspaceAssets, listWorkspaceWorkItems, onboardingDetailHref, type RelationshipAsset } from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { shortId } from "@/lib/ui/relative-time"
import { accessibleAssetIds, accessibleRelationshipIds, accessibleWorkItemIds, requireWorkspaceAccess, requireWorkspacePanel, workspaceAccessHasCapability } from "@/lib/workspace-access"

function assetSummary(asset: RelationshipAsset) {
    return { id: asset.id, title: asset.title, description: asset.description, asset_kind: asset.asset_kind, source_kind: asset.source_kind, content_type: asset.content_type, file_size: asset.file_size, updated_at: asset.updated_at }
}

function assetPreview(asset: RelationshipAsset) {
    if (!asset.storage_path) return Promise.resolve(asset.external_url)
    return asset.source_kind === "message"
        ? Promise.resolve(`/api/client-messages/media/${asset.storage_path.split("/").map(encodeURIComponent).join("/")}`)
        : createUploadSignedUrl(asset.storage_path)
}

async function loadAssetList(workspaceSlug: string) {
    const { workspace, user, access } = await requireWorkspacePanel(workspaceSlug, "library")
    const [allAssets, allowedIds] = await Promise.all([listWorkspaceAssets(workspace.id), accessibleAssetIds(access)])
    const assets = allAssets.filter((asset) => !allowedIds || allowedIds.has(asset.id))
    const previewEntries = await Promise.all(assets.slice(0, 24).map(async (asset) => ({ asset: assetSummary(asset), previewUrl: asset.content_type?.startsWith("image/") && asset.storage_path ? await assetPreview(asset) : null })))
    return {
        userId: user.id, workspaceId: workspace.id, workspaceSlug: workspace.slug, kind: "assets" as const, context: null,
        previewEntries, counts: { total: assets.length, images: assets.filter((asset) => asset.content_type?.startsWith("image/")).length, documents: assets.filter((asset) => asset.asset_kind === "document" || asset.content_type === "application/pdf").length, uploads: assets.filter((asset) => asset.source_kind === "upload").length },
    }
}

async function loadWorkItemList(workspaceSlug: string) {
    const { workspace, user, access } = await requireWorkspacePanel(workspaceSlug, "library")
    const [allItems, allowedIds] = await Promise.all([listWorkspaceWorkItems(workspace.id), accessibleWorkItemIds(access)])
    const items = allItems.filter((item) => !allowedIds || allowedIds.has(item.id))
    const creatorIds = [...new Set(items.flatMap((item) => item.created_by ? [item.created_by] : []))]
    const result = creatorIds.length ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", creatorIds) : { data: [], error: null }
    if (result.error) throw new Error("Could not load work-item creators")
    const creators = new Map((result.data ?? []).map((person) => [person.user_id, person]))
    return {
        userId: user.id, workspaceId: workspace.id, workspaceSlug: workspace.slug, kind: "work-items" as const, context: null,
        items: items.map((item) => {
            const creator = creators.get(item.created_by ?? "")
            return {
                id: item.id, title: item.title, description: item.description, status: item.status, lifecycle_phase: item.lifecycle_phase,
                priority: item.priority, is_key_task: item.is_key_task, due_date: item.due_date, planned_start_date: item.planned_start_date,
                actual_start_at: item.actual_start_at, created_at: item.created_at, updated_at: item.updated_at,
                creator: creator ? { username: creator.username, avatar: creator.avatar_path ? profileAvatarUrl(creator.username, creator.avatar_path) : null } : null,
            }
        }),
    }
}

async function loadAssetDetail(workspaceSlug: string, id: string) {
    const { workspace, user, role, access } = await requireWorkspaceAccess(workspaceSlug)
    if (!workspaceAccessHasCapability(access, "fulfilment.manage") && !workspaceAccessHasCapability(access, "onboarding.manage")) notFound()
    const relationshipScope = accessibleRelationshipIds(access)
    const workItemScope = accessibleWorkItemIds(access)
    const assetScope = Promise.all([relationshipScope, workItemScope]).then(([relationships, workItems]) => accessibleAssetIds(access, relationships, workItems))
    const [asset, relationships, workItems, allowedRelationships, allowedWorkItems, allowedAssets] = await Promise.all([
        getAsset(workspace.id, id), listAssetRelationships(workspace.id, id), listAssetWorkItems(workspace.id, id), relationshipScope, workItemScope, assetScope,
    ])
    if (!asset || (allowedAssets && !allowedAssets.has(id))) notFound()
    const scopedRelationships = relationships.filter((link) => !allowedRelationships || allowedRelationships.has(link.relationship_id)).map((link) => ({ relationship_id: link.relationship_id, relationship: link.relationship ? { business_name: link.relationship.business_name, primary_person_name: link.relationship.primary_person_name } : null }))
    const scopedWorkItems = workItems.filter((link) => !allowedWorkItems || allowedWorkItems.has(link.work_item_id)).map((link) => ({ work_item_id: link.work_item_id, work_item: link.work_item ? { title: link.work_item.title } : null }))
    const contextRelationshipId = scopedRelationships[0]?.relationship_id
    const [relationship, previewUrl] = await Promise.all([contextRelationshipId ? getRelationship(workspace.id, contextRelationshipId) : null, assetPreview(asset)])
    const context = await loadRelationshipContext({ workspaceSlug, relationship, access, metrics: [{ label: "Reference", value: shortId(asset.id) }, { label: "Links", value: scopedRelationships.length + scopedWorkItems.length }] })
    const response = asset.asset_kind === "form_submission" ? asset.metadata.response : null
    const formEntries = response && typeof response === "object" && !Array.isArray(response)
        ? Object.entries(response).map(([key, value]) => ({ key, fileCount: Array.isArray(value) ? value.length : null, value: Array.isArray(value) ? "" : String(value || "No answer provided") })) : []
    const onboardingId = typeof asset.metadata.relationship_id === "string" ? asset.metadata.relationship_id : contextRelationshipId
    const step = typeof asset.metadata.step_key === "string" ? asset.metadata.step_key : ""
    const stepAnchor = step.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "step"
    const onboardingBackHref = onboardingId && (!allowedRelationships || allowedRelationships.has(onboardingId)) && ["onboarding_form_submission", "onboarding_upload"].includes(asset.native_kind ?? "")
        ? `${onboardingDetailHref(workspace.slug, onboardingId)}${step ? `#step-${stepAnchor}` : ""}` : null
    return {
        userId: user.id, workspaceId: workspace.id, workspaceSlug: workspace.slug, kind: "asset-detail" as const,
        context, role, asset: assetSummary(asset), scopedRelationships, scopedWorkItems, previewUrl, formEntries, onboardingBackHref,
        downloadHref: asset.native_kind === "client_portal_resource" && asset.storage_path ? `/api/workspaces/${workspace.slug}/assets/${asset.id}/download` : null,
    }
}

async function loadWorkItemDetail(workspaceSlug: string, id: string) {
    const { workspace, user, role, access } = await requireWorkspaceAccess(workspaceSlug)
    if (!workspaceAccessHasCapability(access, "fulfilment.manage") && !workspaceAccessHasCapability(access, "onboarding.manage")) notFound()
    const [item, allowedRelationshipIds, allowedWorkItemIds] = await Promise.all([getWorkItem(workspace.id, id), accessibleRelationshipIds(access), accessibleWorkItemIds(access)])
    if (!item || (allowedWorkItemIds && !allowedWorkItemIds.has(id)) || (item.visibility === "admins_only" && role === "staff")) notFound()
    const status = workItemStatusPresentation(item.status)
    const isAdminItem = item.area === "admin"
    const [relationships, assets, planning, keyResultLinks] = await Promise.all([
        isAdminItem ? [] : listWorkItemRelationships(workspace.id, item.id), isAdminItem ? [] : listWorkItemAssets(workspace.id, item.id),
        getWorkItemPlanningContext(workspace.id, item, { includeAvailableWorkItems: false }), role !== "staff" ? listWorkItemKeyResultLinks(workspace.id, item.id) : [],
    ])
    const dependencies = planning.dependencies.filter((dependency) => !allowedWorkItemIds || allowedWorkItemIds.has(dependency.work_item_id))
    const parent = planning.parent && (!allowedWorkItemIds || allowedWorkItemIds.has(planning.parent.id)) ? planning.parent : null
    const scopedRelationships = relationships.filter((relationship) => !allowedRelationshipIds || allowedRelationshipIds.has(relationship.relationship_id))
    const contextRelationshipId = scopedRelationships[0]?.relationship_id
    const [relationship, avatarUrls] = await Promise.all([
        contextRelationshipId ? getRelationship(workspace.id, contextRelationshipId) : null,
        createUploadSignedUrls([...planning.members, ...(planning.creator ? [planning.creator] : [])].flatMap((person) => person.avatar_path ? [person.avatar_path] : [])),
    ])
    const personProps = (person: typeof planning.members[number]) => ({ user_id: person.user_id, username: person.username, avatar_url: person.avatar_path ? avatarUrls.get(person.avatar_path) ?? null : null })
    const fields = {
        workspaceSlug: workspace.slug, workItemId: item.id, status: item.status, statusLabel: status.label, statusTone: status.tone, updatedAt: item.updated_at,
        plannedStartDate: item.planned_start_date, plannedStartTime: item.planned_start_time ?? null, dueDate: item.due_date, dueTime: item.due_time ?? null,
        actualStartAt: item.actual_start_at, actualStartHasTime: Boolean(item.actual_start_has_time), actualCompletedAt: item.actual_completed_at, actualCompletedHasTime: Boolean(item.actual_completed_has_time), description: item.description,
        assignees: planning.assignees.map(personProps), executionOwnerId: item.execution_owner_id ?? null, creator: planning.creator ? personProps(planning.creator) : null, members: planning.members.map(personProps),
        parent: parent ? { id: parent.id, title: parent.title, status: parent.status } : null, parentId: item.parent_work_item_id ?? null,
        waitsForParent: dependencies.some((dependency) => dependency.source === "parent_auto" && dependency.work_item_id === item.parent_work_item_id),
        dependencies: dependencies.flatMap((dependency) => dependency.work_item ? [{ id: dependency.work_item.id, title: dependency.work_item.title, status: dependency.work_item.status }] : []),
        manualDependencyIds: dependencies.filter((dependency) => dependency.source === "manual").map((dependency) => dependency.work_item_id), workOptions: [],
        relationships: scopedRelationships.map((link) => ({ id: link.relationship_id, label: link.relationship?.business_name ?? link.relationship?.primary_person_name ?? "Relationship" })),
        relationshipOptions: [], relationshipsLocked: isAdminItem || item.native_kind === "onboarding_step", priorityOverride: item.priority_override ?? null,
        keyResults: keyResultLinks.map((result) => ({ id: result.id, name: result.name, objective: result.objective, unit: result.unit, currency_code: result.currency_code, expected_movement: result.expected_movement, impact_hypothesis: result.impact_hypothesis, code: `KR-${shortId(result.id)}` })),
        keyResultOptions: [], editorOptionsHref: `/api/workspaces/${encodeURIComponent(workspace.slug)}/work-items/${encodeURIComponent(item.id)}/editor-options`, linksLocked: item.native_kind === "onboarding_step",
    } satisfies ComponentProps<typeof InlineWorkItemFields>
    const context = await loadRelationshipContext({ workspaceSlug, relationship, access, metrics: [{ label: "Status", value: status.label }, { label: "Assets", value: assets.length }] })
    return {
        userId: user.id, workspaceId: workspace.id, workspaceSlug: workspace.slug, kind: "work-item-detail" as const,
        context, role, item: { id: item.id, title: item.title, updated_at: item.updated_at }, isAdminItem, fields,
        assets: assets.map((asset) => ({ id: asset.id, title: asset.title, updated_at: asset.updated_at })),
    }
}

export async function loadNativeLibrary(workspaceSlug: string, route: "assets" | "work-items", id?: string) {
    if (route === "assets") return id ? loadAssetDetail(workspaceSlug, id) : loadAssetList(workspaceSlug)
    return id ? loadWorkItemDetail(workspaceSlug, id) : loadWorkItemList(workspaceSlug)
}

export type NativeLibrarySnapshot = Awaited<ReturnType<typeof loadNativeLibrary>>
