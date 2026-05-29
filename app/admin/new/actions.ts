"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { randomBytes } from "crypto"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"

export async function createClient(formData: FormData) {
    const cookieStore = await cookies()
    const adminSession = cookieStore.get("admin_session")?.value

    if (adminSession !== process.env.ADMIN_SESSION_SECRET) {
        redirect("/admin/login")
    }

    const name = String(formData.get("name") ?? "").trim()
    const email = String(formData.get("email") ?? "").trim().toLowerCase()
    const selectedModules = formData
        .getAll("modules")
        .map(String)
        .filter((moduleKey) => moduleKey in MODULES)

    if (!name || !email) {
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
            email,
            session_token: sessionToken,
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

    redirect(`/admin?created=${client.session_token}`)
}