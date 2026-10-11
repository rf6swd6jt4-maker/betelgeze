/** Match the same latest-preview body text as the existing chat list. The
 * candidate bodies stay inside the server; only matching IDs leave the route. */
export function matchingConversationPreviewIds(candidates: Array<{ conversationId: string; body: string }>, query: string) {
    const normalized = query.trim().toLowerCase()
    return normalized ? candidates.filter(candidate => candidate.body.toLowerCase().includes(normalized)).map(candidate => candidate.conversationId) : []
}
