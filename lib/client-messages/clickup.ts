import { getRequiredEnv } from "@/lib/env"
import { parseClickUpWorkspaceId } from "@/lib/client-messages/clickup-workspace"

type CreateClickUpMessageInput = {
    workspaceId?: string | null
    channelId: string
    content: string
}

type RetrieveClickUpChannelMessagesInput = {
    workspaceId?: string | null
    channelId: string
    limit?: number
}

type DeleteClickUpChannelInput = {
    workspaceId?: string | null
    channelId: string
}

type DeleteClickUpSpaceInput = {
    spaceId: string
}

type CreateClickUpChannelInput = {
    workspaceId?: string | null
    name: string
    description?: string
    topic?: string
    visibility?: "PUBLIC" | "PRIVATE"
}

type CreateClickUpLocationChannelInput = {
    workspaceId?: string | null
    locationId: string
    locationType: "space" | "folder" | "list"
    description?: string
    topic?: string
    visibility?: "PUBLIC" | "PRIVATE"
}

type CreateClickUpSpaceInput = {
    workspaceId?: string | null
    name: string
    color: string
}

type ClickUpAuthorizedWorkspace = {
    id?: string | number
    name?: string
}

export type AuthorizedClickUpWorkspace = {
    id: string
    name: string
}

export function hasClickUpConfig() {
    return Boolean(
        process.env.CLICKUP_API_TOKEN && process.env.CLICKUP_WORKSPACE_ID
    )
}

export async function getAuthorizedClickUpWorkspaces(): Promise<
    AuthorizedClickUpWorkspace[]
> {
    const response = await fetch("https://api.clickup.com/api/v2/team", {
        headers: {
            Authorization: getRequiredEnv("CLICKUP_API_TOKEN"),
            accept: "application/json",
        },
    })

    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            getClickUpErrorMessage({
                action: "ClickUp workspace lookup",
                status: response.status,
                body: responseBody,
            })
        )
    }

    const parsed = responseBody ? JSON.parse(responseBody) : null
    const teams = Array.isArray(parsed?.teams) ? parsed.teams : []

    return teams.map((team: ClickUpAuthorizedWorkspace) => ({
        id: String(team.id ?? ""),
        name: team.name ?? "Unnamed workspace",
    }))
}

export function getClickUpWorkspaceId(value?: string | null) {
    const rawValue = value || getRequiredEnv("CLICKUP_WORKSPACE_ID")
    return parseClickUpWorkspaceId(rawValue)
}

const DEFAULT_SPACE_FEATURES = {
    due_dates: {
        enabled: true,
        start_date: false,
        remap_due_dates: true,
        remap_closed_due_date: false,
    },
    time_tracking: {
        enabled: false,
    },
    tags: {
        enabled: true,
    },
    time_estimates: {
        enabled: false,
    },
    checklists: {
        enabled: true,
    },
    custom_fields: {
        enabled: true,
    },
    remap_dependencies: {
        enabled: true,
    },
    dependency_warning: {
        enabled: true,
    },
}

function getClickUpErrorMessage({
    action,
    status,
    body,
}: {
    action: string
    status: number
    body: string
}) {
    if (status === 404) {
        return `${action} failed with 404. Check that CLICKUP_WORKSPACE_ID is the numeric Workspace ID/team ID for the same workspace as the API token, and that ClickUp Chat API access is enabled for that workspace. Response: ${body}`
    }

    return `${action} failed with ${status}: ${body}`
}

export async function createClickUpSpace({
    workspaceId,
    name,
    color,
}: CreateClickUpSpaceInput) {
    const resolvedWorkspaceId = getClickUpWorkspaceId(workspaceId)

    const response = await fetch(
        `https://api.clickup.com/api/v2/team/${resolvedWorkspaceId}/space`,
        {
            method: "POST",
            headers: {
                Authorization: getRequiredEnv("CLICKUP_API_TOKEN"),
                "Content-Type": "application/json",
                accept: "application/json",
            },
            body: JSON.stringify({
                name,
                color,
                multiple_assignees: true,
                features: DEFAULT_SPACE_FEATURES,
            }),
        }
    )

    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            getClickUpErrorMessage({
                action: "ClickUp Space",
                status: response.status,
                body: responseBody,
            })
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

export async function deleteClickUpSpace({
    spaceId,
}: DeleteClickUpSpaceInput) {
    const response = await fetch(
        `https://api.clickup.com/api/v2/space/${spaceId}`,
        {
            method: "DELETE",
            headers: {
                Authorization: getRequiredEnv("CLICKUP_API_TOKEN"),
                accept: "application/json",
            },
        }
    )
    const responseBody = await response.text()

    if (!response.ok && response.status !== 404) {
        throw new Error(
            getClickUpErrorMessage({
                action: "ClickUp Space deletion",
                status: response.status,
                body: responseBody,
            })
        )
    }
}

export async function createClickUpChatChannel({
    workspaceId,
    name,
    description,
    topic,
    visibility = "PUBLIC",
}: CreateClickUpChannelInput) {
    const resolvedWorkspaceId = getClickUpWorkspaceId(workspaceId)

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
            getClickUpErrorMessage({
                action: "ClickUp channel",
                status: response.status,
                body: responseBody,
            })
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

export async function deleteClickUpChatChannel({
    workspaceId,
    channelId,
}: DeleteClickUpChannelInput) {
    const resolvedWorkspaceId = getClickUpWorkspaceId(workspaceId)

    const response = await fetch(
        `https://api.clickup.com/api/v3/workspaces/${resolvedWorkspaceId}/chat/channels/${channelId}`,
        {
            method: "DELETE",
            headers: {
                Authorization: getRequiredEnv("CLICKUP_API_TOKEN"),
                accept: "application/json",
            },
        }
    )
    const responseBody = await response.text()

    if (!response.ok && response.status !== 404) {
        throw new Error(
            getClickUpErrorMessage({
                action: "ClickUp Chat channel deletion",
                status: response.status,
                body: responseBody,
            })
        )
    }
}

export async function createClickUpLocationChatChannel({
    workspaceId,
    locationId,
    locationType,
    description,
    topic,
    visibility = "PUBLIC",
}: CreateClickUpLocationChannelInput) {
    const resolvedWorkspaceId = getClickUpWorkspaceId(workspaceId)

    const response = await fetch(
        `https://api.clickup.com/api/v3/workspaces/${resolvedWorkspaceId}/chat/channels/location`,
        {
            method: "POST",
            headers: {
                Authorization: getRequiredEnv("CLICKUP_API_TOKEN"),
                "Content-Type": "application/json",
                accept: "application/json",
            },
            body: JSON.stringify({
                description,
                topic,
                visibility,
                location: {
                    id: locationId,
                    type: locationType,
                },
            }),
        }
    )

    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            getClickUpErrorMessage({
                action: "ClickUp location Chat channel",
                status: response.status,
                body: responseBody,
            })
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

export async function createClickUpChatMessage({
    workspaceId,
    channelId,
    content,
}: CreateClickUpMessageInput) {
    const resolvedWorkspaceId = getClickUpWorkspaceId(workspaceId)

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
            getClickUpErrorMessage({
                action: "ClickUp message",
                status: response.status,
                body: responseBody,
            })
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

export async function retrieveClickUpChannelMessages({
    workspaceId,
    channelId,
    limit = 20,
}: RetrieveClickUpChannelMessagesInput) {
    const resolvedWorkspaceId = getClickUpWorkspaceId(workspaceId)
    const params = new URLSearchParams({
        limit: String(limit),
        content_format: "text/md",
    })

    const response = await fetch(
        `https://api.clickup.com/api/v3/workspaces/${resolvedWorkspaceId}/chat/channels/${channelId}/messages?${params.toString()}`,
        {
            headers: {
                Authorization: getRequiredEnv("CLICKUP_API_TOKEN"),
                accept: "application/json",
            },
        }
    )

    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            getClickUpErrorMessage({
                action: "ClickUp message retrieval",
                status: response.status,
                body: responseBody,
            })
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}
