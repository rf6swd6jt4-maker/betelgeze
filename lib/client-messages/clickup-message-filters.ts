type ShouldIgnoreClickUpMessageInput = {
    body: string
    authorId: string | null
    authorName: string | null
}

const BRIDGE_USER_NAME =
    process.env.CLICKUP_BRIDGE_USER_NAME?.trim().toLowerCase() || "scaylup"

export function shouldIgnoreClickUpMessage({
    body,
    authorId,
    authorName,
}: ShouldIgnoreClickUpMessageInput) {
    const normalizedAuthorName = authorName?.trim().toLowerCase()
    const bridgeUserId = process.env.CLICKUP_BRIDGE_USER_ID?.trim()
    const normalizedBody = body.trim().toLowerCase()

    return (
        Boolean(bridgeUserId && authorId === bridgeUserId) ||
        normalizedAuthorName === BRIDGE_USER_NAME ||
        normalizedAuthorName === `${BRIDGE_USER_NAME} bot` ||
        isClientProxyMessage(normalizedBody) ||
        normalizedBody.startsWith("**update**") ||
        normalizedBody.startsWith("**error**") ||
        normalizedBody.startsWith("**client") ||
        normalizedBody.includes("[bridge-skip]") ||
        normalizedBody.includes("<!-- bridge-skip -->")
    )
}

function isClientProxyMessage(normalizedBody: string) {
    return (
        /^\*\*[^*]+\*\*\s+via\s+whatsapp\b/iu.test(normalizedBody) ||
        /^\*\*[^*]+\*\*\s*\n/u.test(normalizedBody) ||
        normalizedBody.includes("_from whatsapp:") ||
        normalizedBody.includes("from whatsapp:") ||
        normalizedBody.includes(" via whatsapp")
    )
}
