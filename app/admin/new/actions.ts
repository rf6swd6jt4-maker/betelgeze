"use server"

import { redirect } from "next/navigation"
import { randomBytes } from "crypto"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"
import { SERVICES, getDefaultServiceKeysForModules } from "@/lib/onboarding/services"
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
    const selectedModules = formData
        .getAll("modules")
        .map(String)
        .filter((moduleKey) => moduleKey in MODULES)
    const selectedServices = formData
        .getAll("services")
        .map(String)
        .filter((serviceKey) => serviceKey in SERVICES)
    const serviceKeys =
        selectedServices.length > 0
            ? selectedServices
            : getDefaultServiceKeysForModules(selectedModules)
    const isTest = formData.get("is_test") === "on"

    if (!name || !phone) {
        redirect("/admin/new?error=missing-fields")
    }

    if (selectedModules.length === 0) {
        redirect("/admin/new?error=no-modules")
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
        })
        .select("id, session_token")
        .single()

    if (clientError || !client) {
        redirect("/admin/new?error=create-failed")
    }

    const moduleRows = selectedModules.map((moduleKey) => ({
        client_id: client.id,
        module_key: moduleKey,
    }))

    const { error: modulesError } = await supabaseAdmin
        .from("client_modules")
        .insert(moduleRows)

    if (modulesError) {
        redirect("/admin/new?error=modules-failed")
    }

    if (serviceKeys.length > 0) {
        const { error: servicesError } = await supabaseAdmin
            .from("client_services")
            .insert(
                serviceKeys.map((serviceKey) => ({
                    client_id: client.id,
                    service_key: serviceKey,
                    due_date:
                        String(
                            formData.get(`service_due_date:${serviceKey}`) ??
                                ""
                        ).trim() || null,
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
