"use server"

import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireAdmin } from "@/lib/admin/auth"
import { getUploadPathsFromResponse } from "@/lib/onboarding/response-files"
import { deleteOnboardingUploads } from "@/lib/onboarding/uploads"

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

    const { data: formResponses } = await supabaseAdmin
        .from("client_form_responses")
        .select("response")
        .eq("client_id", clientId)

    const uploadPaths =
        formResponses?.flatMap((row) =>
            getUploadPathsFromResponse(row.response)
        ) ?? []

    await deleteOnboardingUploads(uploadPaths)

    await Promise.all([
        supabaseAdmin
            .from("client_progress")
            .delete()
            .eq("client_id", clientId),
        supabaseAdmin
            .from("client_form_responses")
            .delete()
            .eq("client_id", clientId),
    ])

    await addActivity(
        clientId,
        "progress_cleared",
        "Client progress and form submissions cleared"
    )

    redirect(`/admin/client/${clientId}`)
}

export async function deleteClientNote(clientId: string, noteId: string) {
    await requireAdmin()

    await supabaseAdmin
        .from("client_notes")
        .delete()
        .eq("id", noteId)
        .eq("client_id", clientId)

    await addActivity(clientId, "note_deleted", "Note deleted")

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
