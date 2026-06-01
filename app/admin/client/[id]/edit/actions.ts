"use server"

import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"
import { requireAdmin } from "@/lib/admin/auth"

export async function updateClient(clientId: string, formData: FormData) {
    await requireAdmin()

    const name = String(formData.get("name") ?? "").trim()
    const email = String(formData.get("email") ?? "").trim().toLowerCase()

    const selectedModules = formData
        .getAll("modules")
        .map(String)
        .filter((moduleKey) => moduleKey in MODULES)

    if (!name || !email) {
        redirect(`/admin/client/${clientId}/edit?error=missing-fields`)
    }

    await supabaseAdmin
        .from("clients")
        .update({
            name,
            email,
        })
        .eq("id", clientId)

    await supabaseAdmin.from("client_modules").delete().eq("client_id", clientId)

    if (selectedModules.length > 0) {
        await supabaseAdmin.from("client_modules").insert(
            selectedModules.map((moduleKey) => ({
                client_id: clientId,
                module_key: moduleKey,
            }))
        )
    }

    redirect(`/admin/client/${clientId}`)
}
