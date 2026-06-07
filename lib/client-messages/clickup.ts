import { getRequiredEnv } from "@/lib/env"
import { parseClickUpWorkspaceId } from "@/lib/client-messages/clickup-workspace"

type CreateClickUpMessageInput = {
    workspaceId?: string | null
    channelId: string
    content: string
}

type CreateClickUpReplyInput = {
    workspaceId?: string | null
    messageId: string
    content: string
}

type RetrieveClickUpChannelMessagesInput = {
    workspaceId?: string | null
    channelId: string
    limit?: number
    cursor?: string | null
}

type RetrieveClickUpMessageRepliesInput = {
    workspaceId?: string | null
    messageId: string
    limit?: number
    cursor?: string | null
}

type DeleteClickUpChannelInput = {
    workspaceId?: string | null
    channelId: string
}

type DeleteClickUpMessageInput = {
    workspaceId?: string | null
    messageId: string
}

type DeleteClickUpSpaceInput = {
    spaceId: string
}

type DeleteClickUpFolderInput = {
    folderId: string
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

type CreateClickUpFolderInput = {
    spaceId: string
    name: string
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
        process.env.CLICKUP_API_TOKEN &&
            process.env.CLICKUP_WORKSPACE_ID &&
            process.env.CLICKUP_CLIENTS_SPACE_ID
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

export function getClickUpClientsSpaceId(value?: string | null) {
    return (value || getRequiredEnv("CLICKUP_CLIENTS_SPACE_ID")).trim()
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

function getClickUpResponseMessages(response: unknown) {
    const payload = response as {
        data?: unknown
        messages?: unknown
    } | null
    const candidates = [response, payload?.data, payload?.messages]

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate.filter(
                (item): item is Record<string, unknown> =>
                    Boolean(item) &&
                    typeof item === "object" &&
                    !Array.isArray(item)
            )
        }
    }

    return []
}

function getClickUpResponseCursor(response: unknown) {
    if (!response || typeof response !== "object" || Array.isArray(response)) {
        return null
    }

    const payload = response as {
        cursor?: unknown
        next_cursor?: unknown
        nextCursor?: unknown
        pagination?: {
            cursor?: unknown
            next_cursor?: unknown
            nextCursor?: unknown
        }
    }
    const cursor =
        payload.next_cursor ??
        payload.nextCursor ??
        payload.cursor ??
        payload.pagination?.next_cursor ??
        payload.pagination?.nextCursor ??
        payload.pagination?.cursor

    return typeof cursor === "string" && cursor.trim() ? cursor.trim() : null
}

function getClickUpMessageId(message: Record<string, unknown>) {
    const id = message.id ?? message.message_id

    if (typeof id === "string" && id.trim()) {
        return id.trim()
    }

    if (typeof id === "number") {
        return String(id)
    }

    const nestedMessage = message.message

    if (
        nestedMessage &&
        typeof nestedMessage === "object" &&
        !Array.isArray(nestedMessage)
    ) {
        return getClickUpMessageId(nestedMessage as Record<string, unknown>)
    }

    return null
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

export async function createClickUpFolder({
    spaceId,
    name,
}: CreateClickUpFolderInput) {
    const response = await fetch(
        `https://api.clickup.com/api/v2/space/${spaceId}/folder`,
        {
            method: "POST",
            headers: {
                Authorization: getRequiredEnv("CLICKUP_API_TOKEN"),
                "Content-Type": "application/json",
                accept: "application/json",
            },
            body: JSON.stringify({
                name,
            }),
        }
    )

    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            getClickUpErrorMessage({
                action: "ClickUp Folder",
                status: response.status,
                body: responseBody,
            })
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

export async function deleteClickUpFolder({
    folderId,
}: DeleteClickUpFolderInput) {
    const response = await fetch(
        `https://api.clickup.com/api/v2/folder/${folderId}`,
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
                action: "ClickUp Folder deletion",
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

export async function createClickUpChatReply({
    workspaceId,
    messageId,
    content,
}: CreateClickUpReplyInput) {
    const resolvedWorkspaceId = getClickUpWorkspaceId(workspaceId)

    const response = await fetch(
        `https://api.clickup.com/api/v3/workspaces/${resolvedWorkspaceId}/chat/messages/${messageId}/replies`,
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
                action: "ClickUp reply",
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
    cursor,
}: RetrieveClickUpChannelMessagesInput) {
    const resolvedWorkspaceId = getClickUpWorkspaceId(workspaceId)
    const params = new URLSearchParams({
        limit: String(limit),
        content_format: "text/md",
    })
    if (cursor) params.set("cursor", cursor)

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

export async function retrieveClickUpMessageReplies({
    workspaceId,
    messageId,
    limit = 20,
    cursor,
}: RetrieveClickUpMessageRepliesInput) {
    const resolvedWorkspaceId = getClickUpWorkspaceId(workspaceId)
    const params = new URLSearchParams({
        limit: String(limit),
        content_format: "text/md",
    })
    if (cursor) params.set("cursor", cursor)

    const response = await fetch(
        `https://api.clickup.com/api/v3/workspaces/${resolvedWorkspaceId}/chat/messages/${messageId}/replies?${params.toString()}`,
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
                action: "ClickUp reply retrieval",
                status: response.status,
                body: responseBody,
            })
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

export async function deleteClickUpChatMessage({
    workspaceId,
    messageId,
}: DeleteClickUpMessageInput) {
    const resolvedWorkspaceId = getClickUpWorkspaceId(workspaceId)

    const response = await fetch(
        `https://api.clickup.com/api/v3/workspaces/${resolvedWorkspaceId}/chat/messages/${messageId}`,
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
                action: "ClickUp message deletion",
                status: response.status,
                body: responseBody,
            })
        )
    }
}

export async function clearClickUpChatChannelMessages({
    workspaceId,
    channelId,
}: DeleteClickUpChannelInput) {
    let deleted = 0
    let cursor: string | null = null
    const seenCursors = new Set<string>()

    do {
        const response = await retrieveClickUpChannelMessages({
            workspaceId,
            channelId,
            limit: 100,
            cursor,
        })
        const messages = getClickUpResponseMessages(response)

        for (const message of messages) {
            const messageId = getClickUpMessageId(message)

            if (!messageId) continue

            let replyCursor: string | null = null
            const seenReplyCursors = new Set<string>()

            do {
                const replyResponse = await retrieveClickUpMessageReplies({
                    workspaceId,
                    messageId,
                    limit: 100,
                    cursor: replyCursor,
                })
                const replies = getClickUpResponseMessages(replyResponse)

                for (const reply of replies) {
                    const replyId = getClickUpMessageId(reply)

                    if (!replyId) continue

                    await deleteClickUpChatMessage({
                        workspaceId,
                        messageId: replyId,
                    })
                    deleted += 1
                }

                replyCursor = getClickUpResponseCursor(replyResponse)

                if (replyCursor && seenReplyCursors.has(replyCursor)) {
                    replyCursor = null
                } else if (replyCursor) {
                    seenReplyCursors.add(replyCursor)
                }
            } while (replyCursor)

            await deleteClickUpChatMessage({
                workspaceId,
                messageId,
            })
            deleted += 1
        }

        cursor = getClickUpResponseCursor(response)

        if (cursor && seenCursors.has(cursor)) {
            cursor = null
        } else if (cursor) {
            seenCursors.add(cursor)
        }
    } while (cursor)

    return { deleted }
}
