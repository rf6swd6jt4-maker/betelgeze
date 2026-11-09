export type PopupRect = {
    left: number
    right: number
    top: number
}

export type PopupViewport = {
    left: number
    top: number
    width: number
    height: number
}

export function anchoredPopupPosition({
    trigger,
    popupWidth,
    popupHeight,
    viewport,
    align,
    edge = 8,
    gap = 6,
    fallbackBelow = false,
    allowBelow = false,
}: {
    trigger: PopupRect
    popupWidth: number
    popupHeight: number
    viewport: PopupViewport
    align: "start" | "end" | "center"
    edge?: number
    gap?: number
    fallbackBelow?: boolean
    /** Flip below the trigger instead of squeezing to fit above it, when there is genuinely more room below than above. List-action popups default to always opening above and scrolling internally when space is tight; opt a trigger in only when it can sit flush against the top edge (e.g. a fixed header) with no room above it at all. */
    allowBelow?: boolean
}) {
    const maxWidth = Math.max(0, viewport.width - edge * 2)
    const width = Math.min(popupWidth, maxWidth)
    const anchorTop = fallbackBelow ? Math.max(viewport.top + edge, Math.min(trigger.top, viewport.top + viewport.height - edge)) : trigger.top
    const availableAbove = Math.max(0, anchorTop - gap - viewport.top - edge)
    const availableBelow = Math.max(0, viewport.top + viewport.height - edge - anchorTop - gap)
    const below = (fallbackBelow || allowBelow) && popupHeight > availableAbove && availableBelow > availableAbove
    const maxHeight = below ? availableBelow : availableAbove
    const height = Math.min(popupHeight, maxHeight)
    const desiredLeft = align === "end" ? trigger.right - width : align === "center" ? (trigger.left + trigger.right - width) / 2 : trigger.left
    const left = Math.max(viewport.left + edge, Math.min(desiredLeft, viewport.left + viewport.width - width - edge))
    const top = Math.max(viewport.top + edge, below ? anchorTop + gap : anchorTop - gap - height)

    return { left, top, maxHeight, maxWidth }
}
