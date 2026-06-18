"use server"

import { redirect } from "next/navigation"
import { SERVICES } from "@/lib/onboarding/services"
import {
    getProjectTimeframeDays,
    ProjectTimeframeUnit,
} from "@/lib/onboarding/project-timeframe"
import { requireAdmin } from "@/lib/admin/auth"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"
import { createOnboardingClient } from "@/lib/onboarding/client-creation"

export async function createClient(formData: FormData) {
    await requireAdmin()

    const name = String(formData.get("name") ?? "").trim()
    const email = String(formData.get("email") ?? "").trim().toLowerCase()
    const phone = normalizeMessageAddress(String(formData.get("phone") ?? ""))
    const timeframeAmount = Number(formData.get("project_timeframe_amount"))
    const timeframeUnit = String(
        formData.get("project_timeframe_unit") ?? "days"
    ) as ProjectTimeframeUnit
    const projectTimeframeDays = getProjectTimeframeDays(
        timeframeAmount,
        timeframeUnit
    )
    const selectedServices = formData
        .getAll("services")
        .map(String)
        .filter((serviceKey) => serviceKey in SERVICES)
    const isTest = formData.get("is_test") === "on"

    if (!name || !phone) {
        redirect("/admin/new?error=missing-fields")
    }

    let createdSessionToken: string

    try {
        const client = await createOnboardingClient({
            name,
            phone,
            email,
            serviceKeys: selectedServices,
            projectTimeframeDays,
            isTest,
        })
        createdSessionToken = client.sessionToken
    } catch (error) {
        redirect(
            `/admin/new?error=${error instanceof Error ? error.message : "create-failed"}`
        )
    }

    redirect(`/admin?created=${createdSessionToken}`)
}
