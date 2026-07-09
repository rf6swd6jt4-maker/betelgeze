"use server"

import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { SERVICES, getModuleKeysForServices } from "@/lib/onboarding/services"
import {
    getProjectTimeframeDays,
    ProjectTimeframeUnit,
} from "@/lib/onboarding/project-timeframe"
import { requireAdmin } from "@/lib/admin/auth"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"

export async function updateClient(clientId: string, formData: FormData) {
    const { workspace } = await requireAdmin()

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
    const moduleKeys = getModuleKeysForServices(selectedServices)
    const isTest = formData.get("is_test") === "on"

    if (!name || !phone) {
        redirect(`/admin/client/${clientId}/edit?error=missing-fields`)
    }

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("relationship_id")
        .eq("id", clientId)
        .eq("workspace_id", workspace.id)
        .maybeSingle()

    await supabaseAdmin
        .from("clients")
        .update({
            name,
            email: email || null,
            phone,
            is_test: isTest,
            project_timeframe_days: projectTimeframeDays,
        })
        .eq("id", clientId)
        .eq("workspace_id", workspace.id)

    await supabaseAdmin
        .from("client_communication_channels")
        .update({
            external_address: phone,
            updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId)
        .eq("provider", "meta_whatsapp")

    if (client?.relationship_id) {
        await supabaseAdmin
            .from("relationships")
            .update({
                primary_person_name: name,
                primary_email: email || null,
                primary_phone: phone,
                updated_at: new Date().toISOString(),
            })
            .eq("id", client.relationship_id)
            .eq("workspace_id", workspace.id)
    }

    await supabaseAdmin.from("client_modules").delete().eq("client_id", clientId)

    await supabaseAdmin.from("client_modules").insert(
        moduleKeys.map((moduleKey) => ({
            client_id: clientId,
            workspace_id: workspace.id,
            relationship_id: client?.relationship_id ?? null,
            module_key: moduleKey,
        }))
    )

    await supabaseAdmin.from("client_services").delete().eq("client_id", clientId)

    if (selectedServices.length > 0) {
        await supabaseAdmin.from("client_services").insert(
            selectedServices.map((serviceKey) => ({
                client_id: clientId,
                workspace_id: workspace.id,
                relationship_id: client?.relationship_id ?? null,
                service_key: serviceKey,
            }))
        )
    }

    redirect(`/admin/client/${clientId}`)
}
