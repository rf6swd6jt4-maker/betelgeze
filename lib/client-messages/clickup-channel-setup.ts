import { supabaseAdmin } from "@/lib/supabase/admin"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"
import {
    AuthorizedClickUpWorkspace,
    createClickUpChatChannel,
    createClickUpFolder,
    createClickUpLocationChatChannel,
    deleteClickUpChatChannel,
    deleteClickUpFolder,
    deleteClickUpSpace,
    getClickUpClientsSpaceId,
    getClickUpWorkspaceId,
    getAuthorizedClickUpWorkspaces,
    hasClickUpConfig,
} from "@/lib/client-messages/clickup"

function getChannelId(response: unknown): string | null {
    if (!response || typeof response !== "object") return null

    const value = response as {
        id?: string
        data?: { id?: string }
        channel?: { id?: string }
    }

    return value.id ?? value.data?.id ?? value.channel?.id ?? null
}

function getEntityId(response: unknown): string | null {
    if (!response || typeof response !== "object") return null

    const value = response as {
        id?: string | number
        data?: { id?: string | number }
        space?: { id?: string | number }
        folder?: { id?: string | number }
        list?: { id?: string | number }
    }
    const id =
        value.id ??
        value.data?.id ??
        value.space?.id ??
        value.folder?.id ??
        value.list?.id

    return id ? String(id) : null
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Unknown ClickUp error"
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

async function saveClientCommunicationChannel({
    clientId,
    externalAddress,
    clickupWorkspaceId,
    clickupSpaceId,
    clickupFolderId,
    clickupChannelId,
}: {
    clientId: string
    externalAddress: string
    clickupWorkspaceId: string
    clickupSpaceId: string
    clickupFolderId: string
    clickupChannelId: string
}) {
    const channelRecord = {
        client_id: clientId,
        provider: "meta_whatsapp",
        external_address: externalAddress,
        clickup_workspace_id: clickupWorkspaceId,
        clickup_space_id: clickupSpaceId,
        clickup_folder_id: clickupFolderId,
        clickup_channel_id: clickupChannelId,
        is_active: true,
        updated_at: new Date().toISOString(),
    }

    let { error } = await supabaseAdmin
        .from("client_communication_channels")
        .upsert(channelRecord, {
            onConflict: "client_id",
        })

    if (!error) return

    if (
        error.message.toLowerCase().includes("external_address") ||
        error.message.toLowerCase().includes("duplicate key")
    ) {
        await supabaseAdmin
            .from("client_communication_channels")
            .delete()
            .eq("provider", "meta_whatsapp")
            .eq("external_address", externalAddress)
            .neq("client_id", clientId)

        const retry = await supabaseAdmin
            .from("client_communication_channels")
            .upsert(channelRecord, {
                onConflict: "client_id",
            })

        error = retry.error
    }

    if (error?.message.toLowerCase().includes("clickup_space_id")) {
        const fallbackRecord: Omit<typeof channelRecord, "clickup_space_id"> =
            {
                client_id: channelRecord.client_id,
                provider: channelRecord.provider,
                external_address: channelRecord.external_address,
                clickup_workspace_id: channelRecord.clickup_workspace_id,
                clickup_folder_id: channelRecord.clickup_folder_id,
                clickup_channel_id: channelRecord.clickup_channel_id,
                is_active: channelRecord.is_active,
                updated_at: channelRecord.updated_at,
            }
        const retry = await supabaseAdmin
            .from("client_communication_channels")
            .upsert(fallbackRecord, {
                onConflict: "client_id",
            })

        error = retry.error
    }

    if (error?.message.toLowerCase().includes("clickup_folder_id")) {
        const fallbackRecord: Omit<typeof channelRecord, "clickup_folder_id"> =
            {
                client_id: channelRecord.client_id,
                provider: channelRecord.provider,
                external_address: channelRecord.external_address,
                clickup_workspace_id: channelRecord.clickup_workspace_id,
                clickup_space_id: channelRecord.clickup_space_id,
                clickup_channel_id: channelRecord.clickup_channel_id,
                is_active: channelRecord.is_active,
                updated_at: channelRecord.updated_at,
            }
        const retry = await supabaseAdmin
            .from("client_communication_channels")
            .upsert(fallbackRecord, {
                onConflict: "client_id",
            })

        error = retry.error
    }

    if (error) {
        throw new Error(`Could not save bridge record: ${error.message}`)
    }
}

export async function ensureClientClickUpChannel(clientId: string) {
    if (!hasClickUpConfig()) {
        await addActivity(
            clientId,
            "clickup_channel_skipped",
            "ClickUp Chat channel not created because ClickUp credentials are missing"
        )

        return {
            ok: false,
            error: "Missing CLICKUP_API_TOKEN, CLICKUP_WORKSPACE_ID, or CLICKUP_CLIENTS_SPACE_ID",
        }
    }

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id, name, phone")
        .eq("id", clientId)
        .single()

    if (!client) {
        return {
            ok: false,
            error: "Client not found",
        }
    }

    const externalAddress = normalizeMessageAddress(client.phone ?? "")

    if (!externalAddress) {
        await addActivity(
            clientId,
            "clickup_channel_skipped",
            "ClickUp Chat channel not created because the client has no WhatsApp number"
        )

        return {
            ok: false,
            error: "Client has no WhatsApp number",
        }
    }

    try {
        const clientName = client.name?.trim() || "Client"
        const clientFolderName = clientName
        const clickupClientsSpaceId = getClickUpClientsSpaceId()
        const clickupFolder = await createClickUpFolder({
            spaceId: clickupClientsSpaceId,
            name: clientFolderName,
        })
        const clickupFolderId = getEntityId(clickupFolder)

        if (!clickupFolderId) {
            throw new Error("ClickUp did not return a Folder ID")
        }

        let clickupChannelId: string | null = null
        let channelLocation = "folder"
        let folderChannelError: string | null = null

        try {
            const clickupChannel = await createClickUpLocationChatChannel({
                locationId: clickupFolderId,
                locationType: "folder",
                description: `Client communication channel for ${clientName}.`,
                topic: "Client fulfilment communication",
                visibility: "PUBLIC",
            })

            clickupChannelId = getChannelId(clickupChannel)
        } catch (error) {
            folderChannelError = getErrorMessage(error)
        }

        if (!clickupChannelId) {
            const clickupChannel = await createClickUpChatChannel({
                name: clientFolderName,
                description: `Client communication channel for ${clientName}.`,
                topic: "Client fulfilment communication",
                visibility: "PUBLIC",
            })

            clickupChannelId = getChannelId(clickupChannel)
            channelLocation = "standalone"
        }

        if (!clickupChannelId) {
            throw new Error(
                [
                    "ClickUp did not return a channel ID",
                    folderChannelError
                        ? `Folder channel error: ${folderChannelError}`
                        : null,
                ]
                    .filter(Boolean)
                    .join(". ")
            )
        }

        await saveClientCommunicationChannel({
            clientId: client.id,
            externalAddress,
            clickupWorkspaceId: getClickUpWorkspaceId(),
            clickupSpaceId: clickupClientsSpaceId,
            clickupFolderId,
            clickupChannelId,
        })

        await addActivity(
            client.id,
            "clickup_channel_created",
            `ClickUp client Folder and Chat channel created: ${clientFolderName}. Channel location: ${channelLocation}.`
        )

        return {
            ok: true,
            spaceId: clickupClientsSpaceId,
            folderId: clickupFolderId,
            channelId: clickupChannelId,
            channelLocation,
        }
    } catch (error) {
        const message = getErrorMessage(error)

        await addActivity(
            client.id,
            "clickup_channel_failed",
            `ClickUp Chat channel failed: ${message}`
        )

        return {
            ok: false,
            error: message,
        }
    }
}

export async function deleteClientClickUpResources(clientId: string) {
    if (!hasClickUpConfig()) {
        return {
            ok: false,
            error: "Missing CLICKUP_API_TOKEN, CLICKUP_WORKSPACE_ID, or CLICKUP_CLIENTS_SPACE_ID",
        }
    }

    const { data: channel } = await supabaseAdmin
        .from("client_communication_channels")
        .select("clickup_workspace_id, clickup_space_id, clickup_folder_id, clickup_channel_id")
        .eq("client_id", clientId)
        .eq("provider", "meta_whatsapp")
        .maybeSingle()

    if (!channel) {
        return {
            ok: true,
            deletedChannel: false,
            deletedFolder: false,
            deletedLegacySpace: false,
        }
    }

    try {
        const clickupClientsSpaceId = getClickUpClientsSpaceId()
        let deletedLegacySpace = false

        if (channel.clickup_folder_id) {
            await deleteClickUpFolder({
                folderId: channel.clickup_folder_id,
            })
        } else if (
            channel.clickup_space_id &&
            channel.clickup_space_id !== clickupClientsSpaceId
        ) {
            await deleteClickUpSpace({
                spaceId: channel.clickup_space_id,
            })
            deletedLegacySpace = true
        }

        if (channel.clickup_channel_id) {
            await deleteClickUpChatChannel({
                workspaceId: channel.clickup_workspace_id,
                channelId: channel.clickup_channel_id,
            })
        }

        return {
            ok: true,
            deletedChannel: Boolean(channel.clickup_channel_id),
            deletedFolder: Boolean(channel.clickup_folder_id),
            deletedLegacySpace,
        }
    } catch (error) {
        return {
            ok: false,
            error: getErrorMessage(error),
        }
    }
}

export async function checkClientClickUpConnection(clientId: string) {
    if (!process.env.CLICKUP_API_TOKEN) {
        await addActivity(
            clientId,
            "clickup_connection_failed",
            "ClickUp connection failed: CLICKUP_API_TOKEN is missing"
        )

        return
    }

    try {
        const configuredWorkspaceId = process.env.CLICKUP_WORKSPACE_ID
            ? getClickUpWorkspaceId()
            : "missing"
        const workspaces = await getAuthorizedClickUpWorkspaces()
        const workspaceSummary =
            workspaces.length > 0
                ? workspaces
                      .map(
                          (workspace: AuthorizedClickUpWorkspace) =>
                              `${workspace.name} (${workspace.id})`
                      )
                      .join(", ")
                : "No workspaces returned"
        const configuredWorkspace = workspaces.find(
            (workspace: AuthorizedClickUpWorkspace) =>
                workspace.id === configuredWorkspaceId
        )

        await addActivity(
            clientId,
            configuredWorkspace
                ? "clickup_connection_ok"
                : "clickup_connection_mismatch",
            configuredWorkspace
                ? `ClickUp connection ok. Configured workspace: ${configuredWorkspace.name} (${configuredWorkspace.id}).`
                : `ClickUp token can see: ${workspaceSummary}. Configured CLICKUP_WORKSPACE_ID: ${configuredWorkspaceId}.`
        )
    } catch (error) {
        await addActivity(
            clientId,
            "clickup_connection_failed",
            error instanceof Error
                ? `ClickUp connection failed: ${error.message}`
                : "ClickUp connection failed"
        )
    }
}
