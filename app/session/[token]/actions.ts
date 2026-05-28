"use server"

import { supabaseAdmin } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"

export async function completeStep(token: string, stepKey: string) {
    const { data: client, error: clientError } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("session_token", token)
        .single()

    if (clientError || !client) {
        throw new Error("Invalid onboarding session")
    }

    const { error } = await supabaseAdmin.from("client_progress").upsert(
        {
            client_id: client.id,
            step_key: stepKey,
            completed_at: new Date().toISOString(),
        },
        {
            onConflict: "client_id,step_key",
        }
    )

    if (error) {
        throw new Error("Could not save progress")
    }

    revalidatePath(`/session/${token}`)
}