"use server"

import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"
import { SERVICES, getDefaultServiceKeysForModules } from "@/lib/onboarding/services"
import { requireAdmin } from "@/lib/admin/auth"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"

export async function updateClient(clientId: string, formData: FormData) {
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
        redirect(`/admin/client/${clientId}/edit?error=missing-fields`)
    }

    await supabaseAdmin
        .from("clients")
        .update({
            name,
            email: email || null,
            phone,
            is_test: isTest,
        })
        .eq("id", clientId)

    await supabaseAdmin
        .from("client_communication_channels")
        .update({
            external_address: phone,
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId)
        .eq("provider", "meta_whatsapp")

    await supabaseAdmin.from("client_modules").delete().eq("client_id", clientId)

    if (selectedModules.length > 0) {
        await supabaseAdmin.from("client_modules").insert(
            selectedModules.map((moduleKey) => ({
                client_id: clientId,
                module_key: moduleKey,
            }))
        )
    }

    await supabaseAdmin.from("client_services").delete().eq("client_id", clientId)

    if (serviceKeys.length > 0) {
        await supabaseAdmin.from("client_services").insert(
            serviceKeys.map((serviceKey) => ({
                client_id: clientId,
                service_key: serviceKey,
                due_date:
                    String(
                        formData.get(`service_due_date:${serviceKey}`) ?? ""
                    ).trim() || null,
            }))
        )
    }

    redirect(`/admin/client/${clientId}`)
}
