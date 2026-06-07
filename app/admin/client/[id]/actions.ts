"use server"

import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireAdmin } from "@/lib/admin/auth"
import { getUploadPathsFromResponse } from "@/lib/onboarding/response-files"
import { deleteOnboardingUploads } from "@/lib/onboarding/uploads"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"
import {
    checkClientClickUpConnection,
    deleteClientClickUpResources,
    ensureClientClickUpChannel,
} from "@/lib/client-messages/clickup-channel-setup"
import { clearClickUpChatChannelMessages } from "@/lib/client-messages/clickup"
import { checkMetaWhatsAppAccess } from "@/lib/client-messages/meta-whatsapp"

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

export async function updateClientCommunication(
    clientId: string,
    formData: FormData
) {
    await requireAdmin()

    const externalAddress = normalizeMessageAddress(
        String(formData.get("external_address") ?? "")
    )
    const clickupWorkspaceId = String(
        formData.get("clickup_workspace_id") ?? ""
    ).trim()
    const clickupChannelId = String(formData.get("clickup_channel_id") ?? "")
        .trim()
    const isActive = formData.get("is_active") === "on"

    if (!externalAddress || !clickupChannelId) {
        redirect(`/admin/client/${clientId}?bridgeError=missing-fields`)
    }

    const { data: existingChannel } = await supabaseAdmin
        .from("client_communication_channels")
        .select("clickup_space_id, clickup_folder_id")
        .eq("client_id", clientId)
        .eq("provider", "meta_whatsapp")
        .maybeSingle()

    await supabaseAdmin.from("client_communication_channels").upsert(
        {
            client_id: clientId,
            provider: "meta_whatsapp",
            external_address: externalAddress,
            clickup_workspace_id: clickupWorkspaceId || null,
            clickup_space_id: existingChannel?.clickup_space_id ?? null,
            clickup_folder_id: existingChannel?.clickup_folder_id ?? null,
            clickup_channel_id: clickupChannelId,
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

export async function createClientClickUpChannel(clientId: string) {
    await requireAdmin()

    await ensureClientClickUpChannel(clientId)

    redirect(`/admin/client/${clientId}`)
}

export async function checkClickUpConnection(clientId: string) {
    await requireAdmin()

    await checkClientClickUpConnection(clientId)

    redirect(`/admin/client/${clientId}`)
}

export async function checkMetaWhatsAppConnection(clientId: string) {
    await requireAdmin()

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
    await requireAdmin()

    const { data: channel } = await supabaseAdmin
        .from("client_communication_channels")
        .select("id, clickup_workspace_id, clickup_channel_id")
        .eq("client_id", clientId)
        .eq("provider", "meta_whatsapp")
        .maybeSingle()

    try {
        let deletedClickUpMessages = 0

        if (channel?.clickup_channel_id) {
            const result = await clearClickUpChatChannelMessages({
                workspaceId: channel.clickup_workspace_id,
                channelId: channel.clickup_channel_id,
            })
            deletedClickUpMessages = result.deleted
        }

        await supabaseAdmin
            .from("client_messages")
            .delete()
            .eq("client_id", clientId)

        await addActivity(
            clientId,
            "client_messages_cleared",
            `Bridge message log cleared. Deleted ${deletedClickUpMessages} ClickUp Chat messages. WhatsApp client chats cannot be cleared remotely.`
        )
    } catch (error) {
        await addActivity(
            clientId,
            "client_messages_clear_failed",
            error instanceof Error
                ? `Message clear failed: ${error.message}`
                : "Message clear failed"
        )

        redirect(`/admin/client/${clientId}?clearError=clickup-clear`)
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

    await addActivity(clientId, "client_archived", "Client archived")

    redirect("/admin")
}

export async function deleteClient(clientId: string) {
    await requireAdmin()

    const clickUpCleanup = await deleteClientClickUpResources(clientId)

    if (!clickUpCleanup.ok) {
        await addActivity(
            clientId,
            "client_delete_blocked",
            `Client delete blocked: ClickUp cleanup failed: ${clickUpCleanup.error}`
        )

        redirect(`/admin/client/${clientId}?deleteError=clickup-cleanup`)
    }

    await supabaseAdmin.from("clients").delete().eq("id", clientId)

    redirect("/admin")
}
