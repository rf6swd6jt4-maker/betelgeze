"use server"

import { redirect } from "next/navigation"
import { randomBytes } from "crypto"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { SERVICES, getModuleKeysForServices } from "@/lib/onboarding/services"
import { requireAdmin } from "@/lib/admin/auth"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"
import { ensureClientClickUpChannel } from "@/lib/client-messages/clickup-channel-setup"

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

export async function createClient(formData: FormData) {
    await requireAdmin()

    const name = String(formData.get("name") ?? "").trim()
    const email = String(formData.get("email") ?? "").trim().toLowerCase()
    const phone = normalizeMessageAddress(String(formData.get("phone") ?? ""))
    const projectTimeframe = String(formData.get("project_timeframe") ?? "")
        .trim()
    const selectedServices = formData
        .getAll("services")
        .map(String)
        .filter((serviceKey) => serviceKey in SERVICES)
    const moduleKeys = getModuleKeysForServices(selectedServices)
    const isTest = formData.get("is_test") === "on"

    if (!name || !phone) {
        redirect("/admin/new?error=missing-fields")
    }

    const sessionToken = randomBytes(32).toString("hex")

    const { data: client, error: clientError } = await supabaseAdmin
        .from("clients")
        .insert({
            name,
            email: email || null,
            phone,
            session_token: sessionToken,
            is_test: isTest,
            project_timeframe: projectTimeframe || null,
        })
        .select("id, session_token")
        .single()

    if (clientError || !client) {
        redirect("/admin/new?error=create-failed")
    }

    const moduleRows = moduleKeys.map((moduleKey) => ({
        client_id: client.id,
        module_key: moduleKey,
    }))

    const { error: modulesError } = await supabaseAdmin
        .from("client_modules")
        .insert(moduleRows)

    if (modulesError) {
        redirect("/admin/new?error=modules-failed")
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
            redirect("/admin/new?error=services-failed")
        }
    }

    await ensureClientClickUpChannel(client.id)

    const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
    const onboardingUrl = `${baseUrl}/session/${client.session_token}`

    await addActivity(
        client.id,
        "onboarding_link_created",
        `Onboarding link created: ${onboardingUrl}`
    )

    redirect(`/admin?created=${client.session_token}`)
}
