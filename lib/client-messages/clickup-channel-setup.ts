import { supabaseAdmin } from "@/lib/supabase/admin"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"
import {
    createClickUpChatChannel,
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
        const clickupChannel = await createClickUpChatChannel({
            name: `Client - ${clientName}`,
            description: `Client communication channel for ${clientName}.`,
            topic: "Client fulfilment communication",
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
            "ClickUp Chat channel created"
        )

        return {
            ok: true,
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
                      .map((workspace) => `${workspace.name} (${workspace.id})`)
                      .join(", ")
                : "No workspaces returned"
        const configuredWorkspace = workspaces.find(
            (workspace) => workspace.id === configuredWorkspaceId
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
