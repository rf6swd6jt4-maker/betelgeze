"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createOnboardingClient } from "@/lib/onboarding/client-creation"
import {
    assetHref,
    normalizeRelationshipPhase,
    relationshipHubHref,
    workItemHref,
    workspaceHref,
    type RelationshipPhase,
} from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

const creatablePhases = new Set<RelationshipPhase>([
    "lead",
    "nurturing",
    "potential_client",
    "invoiced",
    "onboarding",
    "onboarding_complete",
    "fulfilment",
    "retention",
    "completed_lost",
])
const creatableAssetKinds = new Set(["file", "media", "document"])

export type WorkspaceCreateActionState = {
    ok: boolean
    href?: string
    error?: string
}

function formString(formData: FormData, key: string) {
    return String(formData.get(key) ?? "").trim()
}

function nullableFormString(formData: FormData, key: string) {
    const value = formString(formData, key)
    return value || null
}

function relationshipRevalidatePaths(slug: string, relationshipId?: string) {
    revalidatePath(workspaceHref(slug, "relationships"))
    revalidatePath(workspaceHref(slug, "onboarding"))
    revalidatePath(workspaceHref(slug, "work"))
    if (relationshipId) {
        revalidatePath(relationshipHubHref(slug, relationshipId))
    }
}

export async function createRelationship(slug: string, formData: FormData) {
    const result = await createRelationshipFromModal(slug, formData)
    if (!result.ok) redirect(workspaceHref(slug, `relationships?error=${result.error ?? "create-failed"}`))
    redirect(result.href ?? workspaceHref(slug, "relationships"))
}

export async function createRelationshipFromModal(slug: string, formData: FormData): Promise<WorkspaceCreateActionState> {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const primaryPersonName = formString(formData, "primary_person_name")
    const businessName = nullableFormString(formData, "business_name")
    const phase = normalizeRelationshipPhase(formString(formData, "lifecycle_phase"))

    if (!primaryPersonName || !creatablePhases.has(phase)) {
        return { ok: false, error: "missing-fields" }
    }

    const { data: relationship, error } = await supabaseAdmin
        .from("relationships")
        .insert({
            workspace_id: workspace.id,
            source_type: "manual",
            primary_person_name: primaryPersonName,
            primary_email: nullableFormString(formData, "primary_email"),
            primary_phone: nullableFormString(formData, "primary_phone"),
            business_name: businessName,
            website_url: nullableFormString(formData, "website_url"),
            industry_value: nullableFormString(formData, "industry_value"),
            location_value: nullableFormString(formData, "location_value"),
            source_label: nullableFormString(formData, "source_label") ?? "Manual",
            primary_contact_role: nullableFormString(formData, "primary_contact_role"),
            notes_summary: nullableFormString(formData, "notes_summary"),
            lifecycle_phase: phase,
            status: phase === "completed_lost" ? "lost" : "active",
            source_metadata: {
                created_from: "manual_relationship_form",
                created_by: user.id,
            },
        })
        .select("id")
        .single()

    if (error || !relationship) {
        return { ok: false, error: "create-failed" }
    }

    if (phase === "onboarding") {
        await createOnboardingClient({
            workspaceId: workspace.id,
            workspaceSlug: workspace.slug,
            customOnboardingDomain: workspace.custom_onboarding_domain,
            customOnboardingDomainVerified: workspace.custom_onboarding_domain_status === "verified",
            relationshipId: relationship.id,
            name: businessName ?? primaryPersonName,
            email: nullableFormString(formData, "primary_email"),
            phone: nullableFormString(formData, "primary_phone") ?? "",
            serviceKeys: [],
            createClickUpResources: false,
            createOnboardingWork: false,
            activitySource: "Relationship manual creation",
            createdBy: user.id,
        })
    }

    relationshipRevalidatePaths(slug, relationship.id)

    return { ok: true, href: relationshipHubHref(slug, relationship.id) }
}

export async function startRelationshipOnboarding(slug: string, relationshipId: string) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const { data: relationship } = await supabaseAdmin
        .from("relationships")
        .select("id, primary_person_name, primary_email, primary_phone, business_name")
        .eq("workspace_id", workspace.id)
        .eq("id", relationshipId)
        .maybeSingle()

    if (!relationship) redirect(workspaceHref(slug, "relationships?error=missing-relationship"))
    await createOnboardingClient({
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        customOnboardingDomain: workspace.custom_onboarding_domain,
        customOnboardingDomainVerified: workspace.custom_onboarding_domain_status === "verified",
        relationshipId: relationship.id,
        name: relationship.business_name ?? relationship.primary_person_name,
        email: relationship.primary_email,
        phone: relationship.primary_phone ?? "",
        serviceKeys: [],
        createClickUpResources: false,
        createOnboardingWork: false,
        activitySource: "Relationship onboarding start",
        createdBy: user.id,
    })

    relationshipRevalidatePaths(slug, relationshipId)
    redirect(relationshipHubHref(slug, relationshipId))
}

export async function createRelationshipWorkItem(slug: string, relationshipId: string, formData: FormData) {
    const result = await createWorkItemFromModal(slug, formData, relationshipId)
    if (result.href) redirect(result.href)
    redirect(relationshipHubHref(slug, relationshipId))
}

export async function createWorkItemFromModal(slug: string, formData: FormData, relationshipId?: string | null): Promise<WorkspaceCreateActionState> {
    const { workspace } = await requireWorkspace(slug, "admin")
    const title = formString(formData, "title")
    if (!title) return { ok: false, error: "missing-title" }
    const lifecyclePhase = normalizeRelationshipPhase(formString(formData, "lifecycle_phase"))

    const { data: item, error } = await supabaseAdmin.from("work_items").insert({
        workspace_id: workspace.id,
        title,
        description: nullableFormString(formData, "description"),
        lifecycle_phase: lifecyclePhase,
        status: nullableFormString(formData, "status") ?? "todo",
        priority: Number(formData.get("priority") ?? 3),
        is_key_task: formData.get("is_key_task") === "on",
        native_kind: "manual_task",
        planned_start_date: nullableFormString(formData, "planned_start_date"),
        due_date: nullableFormString(formData, "due_date"),
        metadata: { created_from: relationshipId ? "relationship_page" : "global_create" },
    })
        .select("id")
        .single()

    if (error || !item) return { ok: false, error: "create-failed" }

    const submittedRelationshipId = nullableFormString(formData, "relationship_id")
    const relationshipToLink = relationshipId ?? submittedRelationshipId
    if (relationshipToLink) {
        await supabaseAdmin.from("work_item_relationships").insert({
            workspace_id: workspace.id,
            work_item_id: item.id,
            relationship_id: relationshipToLink,
        })
    }

    relationshipRevalidatePaths(slug, relationshipToLink ?? undefined)
    return { ok: true, href: workItemHref(slug, item.id) }
}

export async function createRelationshipAsset(slug: string, relationshipId: string, formData: FormData) {
    const result = await createAssetFromModal(slug, formData, relationshipId)
    if (result.href) redirect(result.href)
    redirect(relationshipHubHref(slug, relationshipId))
}

export async function createAssetFromModal(slug: string, formData: FormData, relationshipId?: string | null, workItemId?: string | null): Promise<WorkspaceCreateActionState> {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const title = formString(formData, "title")
    const assetKind = formString(formData, "asset_kind") || "file"
    if (!title) return { ok: false, error: "missing-title" }
    if (!creatableAssetKinds.has(assetKind)) return { ok: false, error: "invalid-kind" }
    const storagePath = nullableFormString(formData, "storage_path")
    if (!storagePath) return { ok: false, error: "missing-upload" }

    const { data: asset, error } = await supabaseAdmin.from("assets").insert({
        workspace_id: workspace.id,
        title,
        asset_kind: assetKind,
        source_kind: "upload",
        description: nullableFormString(formData, "description"),
        storage_path: storagePath,
        content_type: nullableFormString(formData, "content_type"),
        file_size: Number(formData.get("file_size") ?? 0) || null,
        native_kind: "manual_upload",
        metadata: {
            created_from: relationshipId || workItemId ? "context_create" : "global_create",
            original_name: nullableFormString(formData, "original_name"),
        },
        created_by: user.id,
    })
        .select("id")
        .single()

    if (error || !asset) return { ok: false, error: "create-failed" }

    const submittedRelationshipId = nullableFormString(formData, "relationship_id")
    const relationshipToLink = relationshipId ?? submittedRelationshipId
    if (relationshipToLink) {
        await supabaseAdmin.from("asset_relationships").insert({
            workspace_id: workspace.id,
            asset_id: asset.id,
            relationship_id: relationshipToLink,
        })
    }

    const submittedWorkItemId = nullableFormString(formData, "work_item_id")
    const workItemToLink = workItemId ?? submittedWorkItemId
    if (workItemToLink) {
        await supabaseAdmin.from("asset_work_items").insert({
            workspace_id: workspace.id,
            asset_id: asset.id,
            work_item_id: workItemToLink,
        })
    }

    relationshipRevalidatePaths(slug, relationshipToLink ?? undefined)
    return { ok: true, href: assetHref(slug, asset.id) }
}
