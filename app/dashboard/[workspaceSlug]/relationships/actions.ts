"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createOnboardingClient } from "@/lib/onboarding/client-creation"
import {
    normalizeRelationshipPhase,
    relationshipHubHref,
    workspaceHref,
    type RelationshipAssetType,
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
const assetTypes = new Set<RelationshipAssetType>(["file", "link", "note", "message", "invoice", "form_submission", "lead_evidence", "document", "other"])

function formString(formData: FormData, key: string) {
    return String(formData.get(key) ?? "").trim()
}

function nullableFormString(formData: FormData, key: string) {
    const value = formString(formData, key)
    return value || null
}

function relationshipRevalidatePaths(slug: string, relationshipId?: string) {
    revalidatePath(workspaceHref(slug, "relationships"))
    revalidatePath(`/dashboard/${slug}/relationships`)
    revalidatePath(workspaceHref(slug, "onboarding"))
    revalidatePath(`/dashboard/${slug}/onboarding`)
    revalidatePath(workspaceHref(slug, "work"))
    revalidatePath(`/dashboard/${slug}/work`)
    if (relationshipId) {
        revalidatePath(relationshipHubHref(slug, relationshipId))
        revalidatePath(`/dashboard/${slug}/relationships/${relationshipId}`)
    }
}

export async function createRelationship(slug: string, formData: FormData) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const primaryPersonName = formString(formData, "primary_person_name")
    const businessName = nullableFormString(formData, "business_name")
    const phase = normalizeRelationshipPhase(formString(formData, "lifecycle_phase"))

    if (!primaryPersonName || !creatablePhases.has(phase)) {
        redirect(workspaceHref(slug, "relationships/new?error=missing-fields"))
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
        redirect(workspaceHref(slug, "relationships/new?error=create-failed"))
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

    redirect(relationshipHubHref(slug, relationship.id))
}

export async function startRelationshipOnboarding(slug: string, relationshipId: string) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const { data: relationship } = await supabaseAdmin
        .from("relationships")
        .select("id, client_id, primary_person_name, primary_email, primary_phone, business_name")
        .eq("workspace_id", workspace.id)
        .eq("id", relationshipId)
        .maybeSingle()

    if (!relationship) redirect(workspaceHref(slug, "relationships?error=missing-relationship"))
    if (relationship.client_id) redirect(relationshipHubHref(slug, relationshipId))

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
    const { workspace } = await requireWorkspace(slug, "admin")
    const title = formString(formData, "title")
    if (!title) redirect(relationshipHubHref(slug, relationshipId))
    const lifecyclePhase = normalizeRelationshipPhase(formString(formData, "lifecycle_phase"))

    await supabaseAdmin.from("relationship_work_items").insert({
        workspace_id: workspace.id,
        relationship_id: relationshipId,
        title,
        description: nullableFormString(formData, "description"),
        lifecycle_phase: lifecyclePhase,
        status: "todo",
        priority: Number(formData.get("priority") ?? 3),
        is_key_task: formData.get("is_key_task") === "on",
        native_kind: "manual_task",
        metadata: { created_from: "relationship_page" },
    })

    relationshipRevalidatePaths(slug, relationshipId)
    redirect(relationshipHubHref(slug, relationshipId))
}

export async function createRelationshipAsset(slug: string, relationshipId: string, formData: FormData) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const title = formString(formData, "title")
    const submittedAssetType = formString(formData, "asset_type") as RelationshipAssetType
    const assetType = assetTypes.has(submittedAssetType) ? submittedAssetType : "other"
    if (!title) redirect(relationshipHubHref(slug, relationshipId))

    await supabaseAdmin.from("relationship_assets").insert({
        workspace_id: workspace.id,
        relationship_id: relationshipId,
        asset_type: assetType,
        title,
        description: nullableFormString(formData, "description"),
        external_url: nullableFormString(formData, "external_url"),
        native_kind: "manual_asset",
        metadata: { created_from: "relationship_page" },
        created_by: user.id,
    })

    relationshipRevalidatePaths(slug, relationshipId)
    redirect(relationshipHubHref(slug, relationshipId))
}
