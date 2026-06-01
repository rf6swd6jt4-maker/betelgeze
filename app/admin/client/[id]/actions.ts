"use server"

import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireAdmin } from "@/lib/admin/auth"

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

export async function addClientNote(clientId: string, formData: FormData) {
    await requireAdmin()

    const note = String(formData.get("note") ?? "").trim()

    if (!note) {
        redirect(`/admin/client/${clientId}`)
    }

    await supabaseAdmin.from("client_notes").insert({
        client_id: clientId,
        note,
    })

    await addActivity(clientId, "note_added", "Note added")

    redirect(`/admin/client/${clientId}`)
}

export async function clearClientProgress(clientId: string) {
    await requireAdmin()

    await supabaseAdmin
        .from("client_progress")
        .delete()
        .eq("client_id", clientId)

    await addActivity(clientId, "progress_cleared", "Client progress cleared")

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

    await addActivity(clientId, "client_archived", "Client archived")

    redirect("/admin")
}

export async function deleteClient(clientId: string) {
    await requireAdmin()

    await supabaseAdmin.from("clients").delete().eq("id", clientId)

    redirect("/admin")
}
