import { createRelationshipOnboardingSession } from "@/lib/onboarding/canonical"
import { getOnboardingUrl as getPublicOnboardingUrl } from "@/lib/onboarding/custom-domain"
import { supabaseAdmin } from "@/lib/supabase/admin"

type CreateOnboardingClientInput = {
    workspaceId: string
    workspaceSlug: string
    customOnboardingDomain?: string | null
    customOnboardingDomainVerified?: boolean
    name: string
    email?: string | null
    phone: string
    serviceKeys: string[]
    relationshipId?: string | null
    projectTimeframeDays?: number | null
    isTest?: boolean
    createClickUpResources?: boolean
    createOnboardingModules?: boolean
    createOnboardingWork?: boolean
    activitySource?: string
    createdBy?: string | null
}

export type CreateOnboardingClientResult = {
    id: string
    relationshipId: string | null
    sessionToken: string
    onboardingUrl: string | null
}

export function getCreateClientErrorCode(error: { message?: string } | null) {
    const message = error?.message?.toLowerCase() ?? ""
    if (message.includes("relationship_onboarding_sessions")) return "schema-missing"
    if (message.includes("phone")) return "phone-schema-missing"
    return "create-failed"
}

export function getOnboardingUrl(
    workspaceSlug: string,
    sessionToken: string,
    customOnboardingDomain?: string | null,
    customOnboardingDomainVerified?: boolean
) {
    return getPublicOnboardingUrl({
        workspaceSlug,
        sessionToken,
        customDomain: customOnboardingDomain,
        customDomainVerified: customOnboardingDomainVerified,
    })
}

async function ensureRelationship({
    workspaceId,
    relationshipId,
    name,
    email,
    phone,
    createdBy,
}: Pick<CreateOnboardingClientInput, "workspaceId" | "relationshipId" | "name" | "email" | "phone" | "createdBy">) {
    if (relationshipId) return relationshipId

    const { data: relationship, error } = await supabaseAdmin
        .from("relationships")
        .insert({
            workspace_id: workspaceId,
            source_type: "manual",
            primary_person_name: name,
            primary_email: email || null,
            primary_phone: phone || null,
            business_name: name,
            lifecycle_phase: "onboarding",
            status: "active",
            source_label: "Onboarding",
            source_metadata: {
                created_from: "onboarding_session_creation",
                created_by: createdBy ?? null,
            },
        })
        .select("id")
        .single()

    if (error || !relationship) throw new Error("relationship-create-failed")
    return relationship.id as string
}

export async function createOnboardingClient({
    workspaceId,
    workspaceSlug,
    customOnboardingDomain,
    customOnboardingDomainVerified,
    name,
    email,
    phone,
    serviceKeys,
    relationshipId,
    projectTimeframeDays,
    isTest = false,
    createOnboardingModules = true,
    activitySource,
    createdBy,
}: CreateOnboardingClientInput): Promise<CreateOnboardingClientResult> {
    const linkedRelationshipId = await ensureRelationship({
        workspaceId,
        relationshipId,
        name,
        email,
        phone,
        createdBy,
    })

    const session = await createRelationshipOnboardingSession({
        workspaceId,
        workspaceSlug,
        relationshipId: linkedRelationshipId,
        serviceKeys,
        moduleKeys: createOnboardingModules ? undefined : [],
        projectTimeframeDays,
        isTest,
        createdBy,
    })

    const onboardingUrl = createOnboardingModules
        ? getOnboardingUrl(workspaceSlug, session.sessionToken, customOnboardingDomain, customOnboardingDomainVerified)
        : null

    void activitySource

    return {
        id: session.id,
        relationshipId: linkedRelationshipId,
        sessionToken: session.sessionToken,
        onboardingUrl,
    }
}
