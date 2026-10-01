"use client"

import { useEffect, useRef } from "react"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"

/** Shell dialogs are global; frame/native dialogs belong to their resident tab. */
export function useModalOwnerActive() {
    const navigation = useWorkspaceNavigation()
    const frameActive = useWorkspaceTabActive()
    return navigation?.active ?? (typeof window === "undefined" || window.parent === window || frameActive)
}

/** Native focus containment, with cleanup that never focuses a hidden frame. */
export function useModalDialog(open: boolean) {
    const ref = useRef<HTMLDialogElement>(null)
    useEffect(() => {
        const dialog = ref.current
        if (!open || !dialog) return
        let previous = dialog.ownerDocument.activeElement as HTMLElement | null
        while (previous?.tagName === "IFRAME") {
            try {
                const nested = (previous as HTMLIFrameElement).contentDocument?.activeElement as HTMLElement | null
                if (!nested) break
                previous = nested
            } catch { break }
        }
        dialog.showModal()
        return () => {
            dialog.close()
            // A tab switch can hide the source frame before this cleanup runs.
            const frame = previous?.ownerDocument.defaultView?.frameElement
            if (previous?.isConnected && !previous.closest("[hidden],[inert]") && previous.checkVisibility()
                && (!frame || (!frame.closest("[hidden],[inert]") && frame.checkVisibility()))) {
                previous.focus({ preventScroll: true })
            }
        }
    }, [open])
    return ref
}
