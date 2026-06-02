import { getRequiredEnv } from "@/lib/env"

type CreateClickUpMessageInput = {
    workspaceId?: string | null
    channelId: string
    content: string
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
