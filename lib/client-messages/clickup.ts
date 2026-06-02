import { getRequiredEnv } from "@/lib/env"

type CreateClickUpMessageInput = {
    workspaceId?: string | null
    channelId: string
    content: string
}

type CreateClickUpChannelInput = {
    workspaceId?: string | null
    name: string
    description?: string
    topic?: string
    visibility?: "PUBLIC" | "PRIVATE"
}

export function hasClickUpConfig() {
    return Boolean(process.env.CLICKUP_API_TOKEN && process.env.CLICKUP_WORKSPACE_ID)
}

export async function createClickUpChatChannel({
    workspaceId,
    name,
    description,
    topic,
    visibility = "PRIVATE",
}: CreateClickUpChannelInput) {
    const resolvedWorkspaceId =
        workspaceId || getRequiredEnv("CLICKUP_WORKSPACE_ID")

    const response = await fetch(
        `https://api.clickup.com/api/v3/workspaces/${resolvedWorkspaceId}/chat/channels`,
        {
            method: "POST",
            headers: {
                Authorization: getRequiredEnv("CLICKUP_API_TOKEN"),
                "Content-Type": "application/json",
                accept: "application/json",
            },
            body: JSON.stringify({
                name,
                description,
                topic,
                visibility,
            }),
        }
    )

    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            `ClickUp channel failed with ${response.status}: ${responseBody}`
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

export async function createClickUpChatMessage({
    workspaceId,
    channelId,
    content,
}: CreateClickUpMessageInput) {
    const resolvedWorkspaceId =
        workspaceId || getRequiredEnv("CLICKUP_WORKSPACE_ID")

    const response = await fetch(
        `https://api.clickup.com/api/v3/workspaces/${resolvedWorkspaceId}/chat/channels/${channelId}/messages`,
        {
            method: "POST",
            headers: {
                Authorization: getRequiredEnv("CLICKUP_API_TOKEN"),
                "Content-Type": "application/json",
                accept: "application/json",
            },
            body: JSON.stringify({
                type: "message",
                content,
                content_format: "text/md",
            }),
        }
    )

    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            `ClickUp message failed with ${response.status}: ${responseBody}`
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}
