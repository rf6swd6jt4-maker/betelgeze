"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"

async function requireAdmin() {
    const cookieStore = await cookies()
    const adminSession = cookieStore.get("admin_session")?.value

    if (adminSession !== process.env.ADMIN_SESSION_SECRET) {
        redirect("/admin/login")
    }
}

export async function updateClientModules(clientId: string, formData: FormData) {
    await requireAdmin()

    const selectedModules = formData
        .getAll("modules")
        .map(String)
        .filter((moduleKey) => moduleKey in MODULES)

    await supabaseAdmin
        .from("client_modules")
        .delete()
        .eq("client_id", clientId)

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

export async function archiveClient(clientId: string) {
    await requireAdmin()

    await supabaseAdmin
        .from("clients")
        .update({
            archived_at: new Date().toISOString(),
        })
        .eq("id", clientId)

    redirect("/admin")
}

export async function deleteClient(clientId: string) {
    await requireAdmin()

    await supabaseAdmin.from("clients").delete().eq("id", clientId)

    redirect("/admin")
}