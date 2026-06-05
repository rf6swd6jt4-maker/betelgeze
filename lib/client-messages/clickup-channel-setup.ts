import { supabaseAdmin } from "@/lib/supabase/admin"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"
import {
    AuthorizedClickUpWorkspace,
    createClickUpChatChannel,
    createClickUpLocationChatChannel,
    createClickUpSpace,
    deleteClickUpChatChannel,
    deleteClickUpSpace,
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
        list?: { id?: string | number }
    }
    const id = value.id ?? value.data?.id ?? value.space?.id ?? value.list?.id

    return id ? String(id) : null
}

const SPACE_COLORS = [
    "#1abc9c",
    "#2ecd6f",
    "#3498db",
    "#9b59b6",
    "#f1c40f",
    "#e67e22",
    "#e74c3c",
    "#ff6b81",
    "#7f8c8d",
]

function getClientSpaceColor(seed: string) {
    const colorIndex =
        [...seed].reduce(
            (total, character) => total + character.charCodeAt(0),
            0
        ) % SPACE_COLORS.length

    return SPACE_COLORS[colorIndex]
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
    clickupChannelId,
}: {
    clientId: string
    externalAddress: string
    clickupWorkspaceId: string
    clickupSpaceId: string
    clickupChannelId: string
}) {
    const channelRecord = {
        client_id: clientId,
        provider: "meta_whatsapp",
        external_address: externalAddress,
        clickup_workspace_id: clickupWorkspaceId,
        clickup_space_id: clickupSpaceId,
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
            error: "Missing CLICKUP_API_TOKEN or CLICKUP_WORKSPACE_ID",
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
        const clientSpaceName = clientName
        const spaceColor = getClientSpaceColor(client.id)
        const clickupSpace = await createClickUpSpace({
            name: clientSpaceName,
            color: spaceColor,
        })
        const clickupSpaceId = getEntityId(clickupSpace)

        if (!clickupSpaceId) {
            throw new Error("ClickUp did not return a Space ID")
        }

        let clickupChannelId: string | null = null
        let channelLocation = "space"
        let spaceChannelError: string | null = null

        try {
            const clickupChannel = await createClickUpLocationChatChannel({
                locationId: clickupSpaceId,
                locationType: "space",
                description: `Client communication channel for ${clientName}.`,
                topic: "Client fulfilment communication",
                visibility: "PUBLIC",
            })

            clickupChannelId = getChannelId(clickupChannel)
        } catch (error) {
            spaceChannelError = getErrorMessage(error)
        }

        if (!clickupChannelId) {
            const clickupChannel = await createClickUpChatChannel({
                name: clientSpaceName,
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
                    spaceChannelError
                        ? `Space channel error: ${spaceChannelError}`
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
            clickupSpaceId,
            clickupChannelId,
        })

        await addActivity(
            client.id,
            "clickup_channel_created",
            `ClickUp Space and Chat channel created: ${clientSpaceName}. Channel location: ${channelLocation}.`
        )

        return {
            ok: true,
            spaceId: clickupSpaceId,
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
            error: "Missing CLICKUP_API_TOKEN or CLICKUP_WORKSPACE_ID",
        }
    }

    const { data: channel } = await supabaseAdmin
        .from("client_communication_channels")
        .select("clickup_workspace_id, clickup_space_id, clickup_channel_id")
        .eq("client_id", clientId)
        .eq("provider", "meta_whatsapp")
        .maybeSingle()

    if (!channel) {
        return {
            ok: true,
            deletedChannel: false,
            deletedSpace: false,
        }
    }

    try {
        if (channel.clickup_space_id) {
            await deleteClickUpSpace({
                spaceId: channel.clickup_space_id,
            })
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
            deletedSpace: Boolean(channel.clickup_space_id),
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
