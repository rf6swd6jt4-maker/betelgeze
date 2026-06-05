import { supabaseAdmin } from "@/lib/supabase/admin"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"
import {
    AuthorizedClickUpWorkspace,
    createClickUpFolderlessList,
    createClickUpLocationChatChannel,
    createClickUpSpace,
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
        const dashboardSpaceName = `${clientName} - Dashboard`
        const chatListName = `${clientName} - Chat`
        const spaceColor = getClientSpaceColor(client.id)
        const clickupSpace = await createClickUpSpace({
            name: dashboardSpaceName,
            color: spaceColor,
        })
        const clickupSpaceId = getEntityId(clickupSpace)

        if (!clickupSpaceId) {
            throw new Error("ClickUp did not return a Space ID")
        }

        const clickupChatList = await createClickUpFolderlessList({
            spaceId: clickupSpaceId,
            name: chatListName,
            content: `WhatsApp communication hub for ${clientName}.`,
            status: spaceColor,
        })
        const clickupChatListId = getEntityId(clickupChatList)

        if (!clickupChatListId) {
            throw new Error("ClickUp did not return a Chat List ID")
        }

        const clickupChannel = await createClickUpLocationChatChannel({
            locationId: clickupChatListId,
            locationType: "list",
            description: `Client communication channel for ${clientName}.`,
            topic: "Client fulfilment communication",
            visibility: "PUBLIC",
        })

        const clickupChannelId = getChannelId(clickupChannel)

        if (!clickupChannelId) {
            throw new Error("ClickUp did not return a channel ID")
        }

        await supabaseAdmin.from("client_communication_channels").upsert(
            {
                client_id: client.id,
                provider: "meta_whatsapp",
                external_address: externalAddress,
                clickup_workspace_id: getClickUpWorkspaceId(),
                clickup_channel_id: clickupChannelId,
                is_active: true,
                updated_at: new Date().toISOString(),
            },
            {
                onConflict: "client_id",
            }
        )

        await addActivity(
            client.id,
            "clickup_channel_created",
            `ClickUp Space and Chat channel created: ${dashboardSpaceName} / ${chatListName}`
        )

        return {
            ok: true,
            spaceId: clickupSpaceId,
            listId: clickupChatListId,
            channelId: clickupChannelId,
        }
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unknown ClickUp error"

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
