"use client"

import { createPortal } from "react-dom"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { WORKSPACE_TAB_VISIBILITY_EVENT } from "@/lib/workspace-tabs"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { anchoredPopupPosition } from "./anchored-popup-position"

type PopupPosition = {
    left: number
    top: number
    maxHeight: number
    maxWidth: number
}

function popupHost(anchor: HTMLElement) {
    const sourceDocument = anchor.ownerDocument
    const sourceWindow = sourceDocument.defaultView ?? window
    if (sourceWindow.parent === sourceWindow) return { document: sourceDocument, window: sourceWindow, frameRect: null }

    try {
        const parentDocument = sourceWindow.parent.document
        const frameRect = sourceWindow.frameElement?.getBoundingClientRect() ?? null
        return { document: parentDocument, window: sourceWindow.parent, frameRect }
    } catch {
        return { document: sourceDocument, window: sourceWindow, frameRect: null }
    }
}

function anchorRectInHost(anchor: HTMLElement, frameRect: DOMRect | null) {
    const rect = anchor.getBoundingClientRect()
    if (!frameRect) return rect
    return new DOMRect(frameRect.left + rect.left, frameRect.top + rect.top, rect.width, rect.height)
}

export function AnchoredPopup({
    anchor,
    children,
    align = "start",
    className = "",
    role,
    onDismiss,
    workItemPopup = false,
    anchorPoint,
}: {
    anchor: HTMLElement | null
    children: ReactNode
    align?: "start" | "end" | "center"
    /** Point relative to the anchor's top-left corner, in CSS pixels. */
    anchorPoint?: { x: number; y: number }
    className?: string
    role?: string
    onDismiss?: () => void
    workItemPopup?: boolean
}) {
    const navigation = useWorkspaceNavigation()
    const active = navigation?.active !== false
    const popupRef = useRef<HTMLDivElement>(null)
    const [position, setPosition] = useState<PopupPosition | null>(null)
    const host = useMemo(() => anchor ? popupHost(anchor) : null, [anchor])

    const updatePosition = useCallback(() => {
        const popup = popupRef.current
        if (!active || !anchor || !popup) return
        const currentHost = popupHost(anchor)
        const rect = anchorRectInHost(anchor, currentHost.frameRect)
        const triggerRect = anchorPoint ? { left: rect.left + anchorPoint.x, right: rect.left + anchorPoint.x, top: rect.top + anchorPoint.y } : rect
        const visualViewport = currentHost.window.visualViewport
        const viewportLeft = visualViewport?.offsetLeft ?? 0
        const viewportTop = visualViewport?.offsetTop ?? 0
        const viewportWidth = visualViewport?.width ?? currentHost.window.innerWidth
        const viewportHeight = visualViewport?.height ?? currentHost.window.innerHeight
        setPosition(anchoredPopupPosition({
            trigger: triggerRect,
            popupWidth: popup.scrollWidth || popup.offsetWidth,
            popupHeight: popup.scrollHeight || popup.offsetHeight,
            viewport: { left: viewportLeft, top: viewportTop, width: viewportWidth, height: viewportHeight },
            align,
            fallbackBelow: Boolean(anchorPoint),
        }))
    }, [active, align, anchor, anchorPoint])

    useLayoutEffect(() => {
        updatePosition()
        const popup = popupRef.current
        if (!active || !anchor || !popup) return
        const resizeObserver = new ResizeObserver(updatePosition)
        resizeObserver.observe(anchor)
        resizeObserver.observe(popup)
        return () => resizeObserver.disconnect()
    }, [active, anchor, updatePosition])

    useEffect(() => {
        if (!active || !anchor || !host) return
        const sourceDocument = anchor.ownerDocument
        const documents = sourceDocument === host.document ? [sourceDocument] : [sourceDocument, host.document]
        const sourceWindow = sourceDocument.defaultView
        const visualViewport = host.window.visualViewport
        const dismiss = (event: Event) => {
            const target = event.target as Node
            if (popupRef.current?.contains(target) || (!anchorPoint && anchor.contains(target))) return
            onDismiss?.()
        }
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onDismiss?.()
        }
        const dismissWhenOwnerBecomesInactive = () => {
            if (sourceDocument.body.dataset.workspaceTabActive === "false") onDismiss?.()
        }
        const dismissForOwnerNavigation = () => onDismiss?.()

        for (const document of documents) {
            document.addEventListener(anchorPoint ? "pointerdown" : "mousedown", dismiss)
            document.addEventListener("keydown", escape)
        }
        sourceWindow?.addEventListener("scroll", updatePosition, true)
        sourceWindow?.addEventListener("resize", updatePosition)
        sourceWindow?.addEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, dismissWhenOwnerBecomesInactive)
        sourceWindow?.addEventListener("betelgeze:workspace-navigation-start", dismissForOwnerNavigation)
        sourceWindow?.addEventListener("pagehide", dismissForOwnerNavigation)
        if (host.window !== sourceWindow) {
            host.window.addEventListener("scroll", updatePosition, true)
            host.window.addEventListener("resize", updatePosition)
        }
        visualViewport?.addEventListener("resize", updatePosition)
        visualViewport?.addEventListener("scroll", updatePosition)
        return () => {
            for (const document of documents) {
                document.removeEventListener(anchorPoint ? "pointerdown" : "mousedown", dismiss)
                document.removeEventListener("keydown", escape)
            }
            sourceWindow?.removeEventListener("scroll", updatePosition, true)
            sourceWindow?.removeEventListener("resize", updatePosition)
            sourceWindow?.removeEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, dismissWhenOwnerBecomesInactive)
            sourceWindow?.removeEventListener("betelgeze:workspace-navigation-start", dismissForOwnerNavigation)
            sourceWindow?.removeEventListener("pagehide", dismissForOwnerNavigation)
            if (host.window !== sourceWindow) {
                host.window.removeEventListener("scroll", updatePosition, true)
                host.window.removeEventListener("resize", updatePosition)
            }
            visualViewport?.removeEventListener("resize", updatePosition)
            visualViewport?.removeEventListener("scroll", updatePosition)
        }
    }, [active, anchor, anchorPoint, host, onDismiss, updatePosition])

    if (!active || !anchor || !host) return null
    return createPortal(<div
        ref={popupRef}
        role={role}
        data-anchored-popup
        data-work-item-popup={workItemPopup ? "" : undefined}
        style={position ? {
            left: position.left,
            top: position.top,
            maxHeight: position.maxHeight,
            maxWidth: position.maxWidth,
        } : { visibility: "hidden" }}
        className={`${position ? "betelgeze-popup-enter" : ""} fixed z-[2147483646] overflow-y-auto overscroll-contain ${className}`}
    >{children}</div>, host.document.body)
}
