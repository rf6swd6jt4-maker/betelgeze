import { randomBytes } from "crypto"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { SERVICES, getModuleKeysForServices } from "@/lib/onboarding/services"
import { ensureClientClickUpChannel } from "@/lib/client-messages/clickup-channel-setup"

type CreateOnboardingClientInput = {
    name: string
    email?: string | null
    phone: string
    serviceKeys: string[]
    projectTimeframeDays?: number | null
    isTest?: boolean
    createClickUpResources?: boolean
    activitySource?: string
}

export type CreateOnboardingClientResult = {
    id: string
    sessionToken: string
    onboardingUrl: string
}

async function addActivity(
    clientId: string,
    activityType: string,
    activityText: string
) {
    await supabaseAdmin.from("client_activity").insert({
        client_id: clientId,
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

export function getOnboardingUrl(sessionToken: string) {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"

    return `${baseUrl}/session/${sessionToken}`
}

export async function createOnboardingClient({
    name,
    email,
    phone,
    serviceKeys,
    projectTimeframeDays,
    isTest = false,
    createClickUpResources = true,
    activitySource,
}: CreateOnboardingClientInput): Promise<CreateOnboardingClientResult> {
    const selectedServices = serviceKeys.filter(
        (serviceKey) => serviceKey in SERVICES
    )
    const moduleKeys = getModuleKeysForServices(selectedServices)
    const sessionToken = randomBytes(32).toString("hex")

    const { data: client, error: clientError } = await supabaseAdmin
        .from("clients")
        .insert({
            name,
            email: email || null,
            phone,
            session_token: sessionToken,
            is_test: isTest,
            project_timeframe_days: projectTimeframeDays ?? null,
        })
        .select("id, session_token")
        .single()

    if (clientError || !client) {
        throw new Error(getCreateClientErrorCode(clientError))
    }

    const { error: modulesError } = await supabaseAdmin
        .from("client_modules")
        .insert(
            moduleKeys.map((moduleKey) => ({
                client_id: client.id,
                module_key: moduleKey,
            }))
        )

    if (modulesError) {
        throw new Error("modules-failed")
    }

    if (selectedServices.length > 0) {
        const { error: servicesError } = await supabaseAdmin
            .from("client_services")
            .insert(
                selectedServices.map((serviceKey) => ({
                    client_id: client.id,
                    service_key: serviceKey,
                }))
            )

        if (servicesError) {
            throw new Error(getCreateClientErrorCode(servicesError))
        }
    }

    if (createClickUpResources) {
        await ensureClientClickUpChannel(client.id)
    }

    const onboardingUrl = getOnboardingUrl(client.session_token)

    await addActivity(
        client.id,
        "onboarding_link_created",
        activitySource
            ? `Onboarding link created from ${activitySource}: ${onboardingUrl}`
            : `Onboarding link created: ${onboardingUrl}`
    )

    return {
        id: client.id,
        sessionToken: client.session_token,
        onboardingUrl,
    }
}
