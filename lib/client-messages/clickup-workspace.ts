export function parseClickUpWorkspaceId(value: string) {
    const match = value.match(/\d{4,}/)

    if (!match) {
        throw new Error(
            "CLICKUP_WORKSPACE_ID must be the numeric Workspace ID from ClickUp"
        )
    }

    return match[0]
}
