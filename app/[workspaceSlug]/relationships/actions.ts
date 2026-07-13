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
import { advanceRelationshipWorkflow, ensureRelationshipStage, ensureSalesStage, sendRelationshipInvoice } from "@/lib/relationship-workflow"

const creatablePhases = new Set<RelationshipPhase>([
    "lead",
    "nurturing",
    "potential_client",
    "invoiced",
    "onboarding",
    "onboarding_review",
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
            whatsapp_phone: nullableFormString(formData, "whatsapp_phone"),
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
                is_test: formData.get("is_test") === "on",
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
            isTest: formData.get("is_test") === "on",
        })
    } else if (!["nurturing", "completed_lost"].includes(phase)) {
        await ensureRelationshipStage({ workspaceId: workspace.id, relationshipId: relationship.id, phase: phase as Exclude<RelationshipPhase, "nurturing" | "completed_lost">, assigneeId: user.id })
    }

    relationshipRevalidatePaths(slug, relationship.id)

    return { ok: true, href: relationshipHubHref(slug, relationship.id) }
}

function priceCents(value: string) {
    const amount = Number(value)
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0
}

export async function saveRelationshipCommercialDetails(slug: string, relationshipId: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const serviceKeys = [...new Set(formData.getAll("service_key").map(String).filter(Boolean))]
    const sellerId = nullableFormString(formData, "seller_user_id")
    const managerId = nullableFormString(formData, "fulfilment_manager_user_id")
    const whatsappPhone = nullableFormString(formData, "whatsapp_phone")
    const timeframe = Number(formData.get("project_timeframe_days") ?? 0)
    const { data: relationship, error: relationshipError } = await supabaseAdmin.from("relationships").select("lifecycle_phase").eq("workspace_id", workspace.id).eq("id", relationshipId).maybeSingle()
    if (relationshipError || !relationship) throw new Error(relationshipError?.message ?? "Relationship not found")
    const { error } = await supabaseAdmin.from("relationships").update({
        seller_user_id: sellerId,
        fulfilment_manager_user_id: managerId,
        whatsapp_phone: whatsappPhone,
        project_timeframe_days: Number.isFinite(timeframe) && timeframe > 0 ? Math.round(timeframe) : null,
        updated_at: new Date().toISOString(),
    }).eq("workspace_id", workspace.id).eq("id", relationshipId)
    if (error) throw new Error(error.message)

    await supabaseAdmin.from("relationship_services").delete().eq("workspace_id", workspace.id).eq("relationship_id", relationshipId)
    if (serviceKeys.length) {
        const { error: serviceError } = await supabaseAdmin.from("relationship_services").insert(serviceKeys.map((serviceKey) => ({
            workspace_id: workspace.id,
            relationship_id: relationshipId,
            service_key: serviceKey,
            price_cents: priceCents(formString(formData, `service_price_${serviceKey}`)),
            currency: "usd",
            assignee_user_id: nullableFormString(formData, `service_assignee_${serviceKey}`),
        })))
        if (serviceError) throw new Error(serviceError.message)
    }
    if (relationship.lifecycle_phase === "potential_client") await ensureSalesStage({ workspaceId: workspace.id, relationshipId, sellerId })
    relationshipRevalidatePaths(slug, relationshipId)
}

export async function proceedRelationshipCurrentWork(slug: string, relationshipId: string, workItemId: string) {
    const { workspace, user, role } = await requireWorkspace(slug)
    const { data: item } = await supabaseAdmin.from("work_items")
        .select("id, workflow_action")
        .eq("workspace_id", workspace.id).eq("id", workItemId).maybeSingle()
    if (!item) throw new Error("Work item not found")
    const { data: link } = await supabaseAdmin.from("work_item_relationships")
        .select("work_item_id").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("work_item_id", workItemId).maybeSingle()
    if (!link) throw new Error("Work item does not belong to this relationship")
    if (role !== "owner" && role !== "admin") {
        const { data: assignment } = await supabaseAdmin.from("work_item_assignees")
            .select("user_id").eq("workspace_id", workspace.id).eq("work_item_id", workItemId).eq("user_id", user.id).maybeSingle()
        if (!assignment) throw new Error("This work item is not assigned to you")
    }
    if (item.workflow_action === "send_invoice") {
        await sendRelationshipInvoice({ workspaceId: workspace.id, workspaceSlug: workspace.slug, relationshipId, workItemId, actorId: user.id })
    } else {
        if (item.workflow_action === "await_payment" || item.workflow_action === "await_onboarding") throw new Error("This stage advances automatically when the external step completes")
        await advanceRelationshipWorkflow({ workspaceId: workspace.id, relationshipId, workItemId, action: item.workflow_action, actorId: user.id })
    }
    relationshipRevalidatePaths(slug, relationshipId)
}

export async function startRelationshipOnboarding(slug: string, relationshipId: string) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const { data: relationship } = await supabaseAdmin
        .from("relationships")
        .select("id, primary_person_name, primary_email, primary_phone, business_name, source_metadata")
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
        isTest: relationship.source_metadata && typeof relationship.source_metadata === "object" && relationship.source_metadata.is_test === true,
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
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const title = formString(formData, "title")
    if (!title) return { ok: false, error: "missing-title" }
    const lifecyclePhase = normalizeRelationshipPhase(formString(formData, "lifecycle_phase"))
    const parentWorkItemId = nullableFormString(formData, "parent_work_item_id")
    const waitForParent = parentWorkItemId ? formData.get("wait_for_parent") !== "off" : false
    const assigneeIds = [...new Set(formData.getAll("assigned_to").map(String).filter(Boolean))]

    const { data: item, error } = await supabaseAdmin.from("work_items").insert({
        workspace_id: workspace.id,
        title,
        description: nullableFormString(formData, "description"),
        lifecycle_phase: lifecyclePhase,
        status: nullableFormString(formData, "status") ?? "todo",
        priority: Number(formData.get("priority") ?? 3),
        is_key_task: formData.get("is_key_task") === "on",
        native_kind: "manual_task",
        parent_work_item_id: parentWorkItemId,
        planned_start_date: nullableFormString(formData, "planned_start_date"),
        planned_start_time: nullableFormString(formData, "planned_start_time"),
        due_date: nullableFormString(formData, "due_date"),
        due_time: nullableFormString(formData, "due_time"),
        metadata: { created_from: relationshipId ? "relationship_page" : "global_create" },
        created_by: user.id,
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

    if (parentWorkItemId && waitForParent) {
        const { error: dependencyError } = await supabaseAdmin.from("work_item_dependencies").insert({
            workspace_id: workspace.id,
            work_item_id: item.id,
            depends_on_work_item_id: parentWorkItemId,
            source: "parent_auto",
            created_by: user.id,
        })
        if (dependencyError) {
            await supabaseAdmin.from("work_items").delete().eq("workspace_id", workspace.id).eq("id", item.id)
            return { ok: false, error: "invalid-parent" }
        }
    }

    if (assigneeIds.length) {
        const { error: assigneeError } = await supabaseAdmin.from("work_item_assignees").insert(assigneeIds.map((userId) => ({
            workspace_id: workspace.id,
            work_item_id: item.id,
            user_id: userId,
            assigned_by: user.id,
        })))
        if (assigneeError) {
            await supabaseAdmin.from("work_items").delete().eq("workspace_id", workspace.id).eq("id", item.id)
            return { ok: false, error: "invalid-assignee" }
        }
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
