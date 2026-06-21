import { randomBytes } from "crypto"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { SERVICES, getModuleKeysForServices } from "@/lib/onboarding/services"
import { ensureClientClickUpChannel } from "@/lib/client-messages/clickup-channel-setup"

type CreateOnboardingClientInput = {
    workspaceId: string
    workspaceSlug: string
    name: string
    email?: string | null
    phone: string
    serviceKeys: string[]
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

export function getOnboardingUrl(workspaceSlug: string, sessionToken: string) {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"

    return `${baseUrl}/onboarding/${workspaceSlug}/${sessionToken}`
}

export async function createOnboardingClient({
    workspaceId,
    workspaceSlug,
    name,
    email,
    phone,
    serviceKeys,
    projectTimeframeDays,
    isTest = false,
    createClickUpResources = true,
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

    const { data: client, error: clientError } = await supabaseAdmin
        .from("clients")
        .insert({
            workspace_id: workspaceId,
            name,
            email: email || null,
            phone,
            session_token: sessionToken,
            is_test: isTest,
            project_timeframe_days: projectTimeframeDays ?? null,
            created_by: createdBy ?? null,
        })
        .select("id, session_token")
        .single()

    if (clientError || !client) {
        throw new Error(getCreateClientErrorCode(clientError))
    }

    if (moduleKeys.length > 0) {
        const { error: modulesError } = await supabaseAdmin
            .from("client_modules")
            .insert(
                moduleKeys.map((moduleKey) => ({
                    client_id: client.id,
                    workspace_id: workspaceId,
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
                    service_key: serviceKey,
                }))
            )

        if (servicesError) {
            throw new Error(getCreateClientErrorCode(servicesError))
        }
    }

    if (createClickUpResources) {
        await ensureClientClickUpChannel(client.id, { createOnboardingWork })
    }

    const onboardingUrl = createOnboardingModules
        ? getOnboardingUrl(workspaceSlug, client.session_token)
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
        sessionToken: client.session_token,
        onboardingUrl,
    }
}
