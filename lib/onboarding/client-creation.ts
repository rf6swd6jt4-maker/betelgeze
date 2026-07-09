import { randomBytes } from "crypto"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { SERVICES, getModuleKeysForServices } from "@/lib/onboarding/services"
import { getOnboardingUrl as getPublicOnboardingUrl } from "@/lib/onboarding/custom-domain"

type CreateOnboardingClientInput = {
    workspaceId: string
    workspaceSlug: string
    customOnboardingDomain?: string | null,
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

async function addActivity(
    clientId: string,
    workspaceId: string,
    activityType: string,
    activityText: string
) {
    await supabaseAdmin.from("client_activity").insert({
        client_id: clientId,
        workspace_id: workspaceId,
        activity_type: activityType,
        activity_text: activityText,
    })
}

export function getCreateClientErrorCode(error: { message?: string } | null) {
    const message = error?.message?.toLowerCase() ?? ""

    if (
        message.includes("project_timeframe_days") ||
        message.includes("is_test") ||
        message.includes("client_services")
    ) {
        return "schema-missing"
    }

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
    createOnboardingWork = true,
    activitySource,
    createdBy,
}: CreateOnboardingClientInput): Promise<CreateOnboardingClientResult> {
    const selectedServices = serviceKeys.filter(
        (serviceKey) => serviceKey in SERVICES
    )
    const moduleKeys = createOnboardingModules
        ? getModuleKeysForServices(selectedServices)
        : []
    const sessionToken = randomBytes(32).toString("hex")
    const clientPayload: Record<string, unknown> = {
        workspace_id: workspaceId,
        relationship_id: relationshipId ?? null,
        name,
        email: email || null,
        phone,
        session_token: sessionToken,
        is_test: isTest,
        project_timeframe_days: projectTimeframeDays ?? null,
        created_by: createdBy ?? null,
    }

    const { data: client, error: clientError } = await supabaseAdmin
        .from("clients")
        .insert(clientPayload)
        .select("id, session_token")
        .single()

    if (clientError || !client) {
        throw new Error(getCreateClientErrorCode(clientError))
    }

    let linkedRelationshipId = relationshipId ?? null

    if (linkedRelationshipId) {
        await supabaseAdmin
            .from("relationships")
            .update({
                client_id: client.id,
                primary_person_name: name,
                primary_email: email || null,
                primary_phone: phone || null,
                business_name: name,
                lifecycle_phase: "onboarding",
                started_onboarding_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq("id", linkedRelationshipId)
            .eq("workspace_id", workspaceId)
    } else {
        const { data: relationship } = await supabaseAdmin
            .from("relationships")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("client_id", client.id)
            .maybeSingle()
        linkedRelationshipId = relationship?.id ?? null
    }

    if (moduleKeys.length > 0) {
        const { error: modulesError } = await supabaseAdmin
            .from("client_modules")
            .insert(
                moduleKeys.map((moduleKey) => ({
                    client_id: client.id,
                    workspace_id: workspaceId,
                    relationship_id: linkedRelationshipId,
                    module_key: moduleKey,
                }))
            )

        if (modulesError) {
            throw new Error("modules-failed")
        }
    }

    if (selectedServices.length > 0) {
        const { error: servicesError } = await supabaseAdmin
            .from("client_services")
            .insert(
                selectedServices.map((serviceKey) => ({
                    client_id: client.id,
                    workspace_id: workspaceId,
                    relationship_id: linkedRelationshipId,
                    service_key: serviceKey,
                }))
            )

        if (servicesError) {
            throw new Error(getCreateClientErrorCode(servicesError))
        }
    }

    if (linkedRelationshipId && createOnboardingWork && selectedServices.length > 0) {
        const workItems = selectedServices.flatMap((serviceKey, serviceIndex) => {
            const service = SERVICES[serviceKey]
            if (!service) return []
            return service.sopSteps.map((step, stepIndex) => ({
                workspace_id: workspaceId,
                relationship_id: linkedRelationshipId,
                title: step.title,
                description: step.description ?? service.description,
                lifecycle_phase: "fulfilment",
                status: "todo",
                priority: 3,
                is_key_task: stepIndex === 0,
                native_kind: "service_sop_step",
                native_id: null,
                native_href: null,
                sort_order: serviceIndex * 100 + stepIndex,
                metadata: {
                    service_key: serviceKey,
                    service_title: service.title,
                    step_key: step.key,
                    auto_created: true,
                },
            }))
        })

        if (workItems.length > 0) {
            await supabaseAdmin.from("relationship_work_items").insert(workItems)
        }
    }

    const onboardingUrl = createOnboardingModules
        ? getOnboardingUrl(workspaceSlug, client.session_token, customOnboardingDomain, customOnboardingDomainVerified)
        : null

    if (onboardingUrl) {
        await addActivity(
            client.id,
            workspaceId,
            "onboarding_link_created",
            activitySource
                ? `Onboarding link created from ${activitySource}: ${onboardingUrl}`
                : `Onboarding link created: ${onboardingUrl}`
        )
    }

    return {
        id: client.id,
        relationshipId: linkedRelationshipId,
        sessionToken: client.session_token,
        onboardingUrl,
    }
}
