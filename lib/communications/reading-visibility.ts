export const CHAT_READING_VISIBILITY_EVENT = "betelgeze:chat-reading-visibility"

/** Verify the rendered latest row, not merely a remembered scroll boolean.
 * Tall messages count when their trailing edge is visible at the latest position.
 */
export function latestMessageIsVisible(pane: HTMLElement | null, messageId: string) {
    if (!pane || pane.closest("[inert], [hidden], [aria-hidden=true]") || pane.dataset.positioned !== "true" || pane.clientHeight <= 0) return false
    const row = pane.querySelector<HTMLElement>(`[data-message-interaction="${CSS.escape(messageId)}"]`)
    if (!row || row.closest("[inert], [hidden], [aria-hidden=true]")) return false
    const bounds = pane.getBoundingClientRect()
    const message = row.getBoundingClientRect()
    const viewport = pane.ownerDocument.defaultView?.visualViewport
    const top = Math.max(bounds.top, viewport?.offsetTop ?? 0)
    const bottom = Math.min(bounds.bottom, viewport ? viewport.offsetTop + viewport.height : Infinity)
    if (!(message.height > 0 && message.bottom > top && message.bottom <= bottom + 1
        && message.top < bottom && pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 24)) return false
    // A media viewer or another modal can cover a geometrically visible row.
    const hit = pane.ownerDocument.elementFromPoint((message.left + message.right) / 2, Math.min(message.bottom - 2, bottom - 2))
    if (!hit || (hit !== row && !row.contains(hit))) return false
    // The workspace shell can also cover an otherwise visible iframe.
    try {
        const frame = pane.ownerDocument.defaultView?.frameElement
        if (frame) {
            const frameBounds = frame.getBoundingClientRect()
            if (frame.ownerDocument.elementFromPoint(frameBounds.left + (message.left + message.right) / 2,
                frameBounds.top + Math.min(message.bottom - 2, bottom - 2)) !== frame) return false
        }
    } catch { return false }
    return true
}
