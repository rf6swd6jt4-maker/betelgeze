"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireAdmin, requireWorkspaceMember } from "@/lib/admin/auth"
import { getUploadPathsFromResponse } from "@/lib/onboarding/response-files"
import { deleteOnboardingUploads } from "@/lib/onboarding/uploads"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"
import { checkMetaWhatsAppAccess } from "@/lib/client-messages/meta-whatsapp"

async function requireScopedClient(clientId: string) {
    const { workspace } = await requireAdmin()
    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("id", clientId)
        .eq("workspace_id", workspace.id)
        .maybeSingle()
    if (!client) redirect("/admin")
    return workspace
}

async function requireScopedMemberClient(clientId: string) {
    const { workspace, role, user } = await requireWorkspaceMember()
    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("id", clientId)
        .eq("workspace_id", workspace.id)
        .maybeSingle()
    if (!client) redirect("/admin")
    return { workspace, role, user }
}

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
    const { user } = await requireScopedMemberClient(clientId)

    const note = String(formData.get("note") ?? "").trim()

    if (!note) {
        redirect(`/admin/client/${clientId}`)
    }

    await supabaseAdmin.from("client_notes").insert({
        client_id: clientId,
        note,
        author_id: user?.id ?? null,
    })

    await addActivity(clientId, "note_added", "Note added")

    revalidatePath("/admin")
    revalidatePath(`/admin/client/${clientId}`)
    redirect(`/admin/client/${clientId}`)
}

export async function clearClientProgress(clientId: string) {
    await requireScopedClient(clientId)

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

    revalidatePath("/admin")
    redirect(`/admin/client/${clientId}`)
}

export async function deleteClientNote(clientId: string, noteId: string) {
    const { role, user } = await requireScopedMemberClient(clientId)
    const { data: note } = await supabaseAdmin
        .from("client_notes")
        .select("author_id")
        .eq("id", noteId)
        .eq("client_id", clientId)
        .maybeSingle()
    if (!note || (role === "member" && note.author_id !== user.id)) {
        throw new Error("You can only delete notes you created.")
    }

    await supabaseAdmin
        .from("client_notes")
        .delete()
        .eq("id", noteId)
        .eq("client_id", clientId)

    await addActivity(clientId, "note_deleted", "Note deleted")

    revalidatePath("/admin")
    revalidatePath(`/admin/client/${clientId}`)
    redirect(`/admin/client/${clientId}`)
}

export async function updateClientCommunication(
    clientId: string,
    formData: FormData
) {
    await requireScopedClient(clientId)

    const externalAddress = normalizeMessageAddress(
        String(formData.get("external_address") ?? "")
    )
    const isActive = formData.get("is_active") === "on"

    if (!externalAddress) {
        redirect(`/admin/client/${clientId}?bridgeError=missing-fields`)
    }

    await supabaseAdmin.from("client_communication_channels").upsert(
        {
            client_id: clientId,
            provider: "meta_whatsapp",
            external_address: externalAddress,
            clickup_workspace_id: null,
            clickup_space_id: null,
            clickup_folder_id: null,
            clickup_channel_id: null,
            is_active: isActive,
            updated_at: new Date().toISOString(),
        },
        {
            onConflict: "client_id",
        }
    )

    await addActivity(
        clientId,
        "communication_updated",
        "Client communication bridge updated"
    )

    redirect(`/admin/client/${clientId}`)
}

export async function checkMetaWhatsAppConnection(clientId: string) {
    await requireScopedClient(clientId)

    try {
        const result = await checkMetaWhatsAppAccess()
        const displayNumber =
            typeof result?.display_phone_number === "string"
                ? result.display_phone_number
                : "configured phone number"
        const verifiedName =
            typeof result?.verified_name === "string"
                ? ` (${result.verified_name})`
                : ""

        await addActivity(
            clientId,
            "meta_whatsapp_connection_ok",
            `Meta WhatsApp connection ok for ${displayNumber}${verifiedName}.`
        )
    } catch (error) {
        await addActivity(
            clientId,
            "meta_whatsapp_connection_failed",
            error instanceof Error
                ? `Meta WhatsApp connection failed: ${error.message}`
                : "Meta WhatsApp connection failed"
        )
    }

    redirect(`/admin/client/${clientId}`)
}

export async function clearClientBridgeMessages(clientId: string) {
    await requireScopedClient(clientId)

    try {
        await supabaseAdmin
            .from("client_messages")
            .delete()
            .eq("client_id", clientId)

        await addActivity(
            clientId,
            "client_messages_cleared",
            "Message log cleared. WhatsApp client chats cannot be cleared remotely."
        )
    } catch (error) {
        await addActivity(
            clientId,
            "client_messages_clear_failed",
            error instanceof Error
                ? `Message clear failed: ${error.message}`
                : "Message clear failed"
        )

        redirect(`/admin/client/${clientId}?clearError=message-clear`)
    }

    redirect(`/admin/client/${clientId}`)
}

export async function archiveClient(clientId: string) {
    const workspace = await requireScopedClient(clientId)

    await supabaseAdmin
        .from("clients")
        .update({
            archived_at: new Date().toISOString(),
        })
        .eq("id", clientId)
        .eq("workspace_id", workspace.id)

    await addActivity(clientId, "client_archived", "Client archived")

    redirect("/admin")
}

export async function deleteClient(clientId: string) {
    await requireScopedClient(clientId)

    await supabaseAdmin.from("clients").delete().eq("id", clientId)

    redirect("/admin")
}
