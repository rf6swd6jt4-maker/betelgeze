"use client"

import { useEffect, useRef } from "react"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"
import { bindPortalOwnerLifetime } from "./portal-owner-lifetime"

/** Shell dialogs are global; frame/native dialogs belong to their resident tab. */
export function useModalOwnerActive() {
    const navigation = useWorkspaceNavigation()
    const frameActive = useWorkspaceTabActive()
    return navigation?.active ?? (typeof window === "undefined" || window.parent === window || frameActive)
}

/** Native focus containment, with cleanup that never focuses a hidden frame. */
export function useModalDialog(open: boolean) {
    const ref = useRef<HTMLDialogElement>(null)
    const currentOpen = useRef(open)
    const lifetime = useRef<{ dialog: HTMLDialogElement; owner: ReturnType<typeof bindPortalOwnerLifetime> } | null>(null)
    // The portal can remain mounted while its tab is inactive, or mount later
    // (the onboarding preview). Its ownership spans both open and closed states.
    useEffect(() => {
        currentOpen.current = open
        const dialog = ref.current
        if (lifetime.current?.dialog === dialog) return
        lifetime.current?.owner.dispose()
        lifetime.current = dialog ? { dialog, owner: bindPortalOwnerLifetime(dialog, {
            suspend: () => dialog.close(),
            resume: () => { if (currentOpen.current && !dialog.open) dialog.showModal() },
        }) } : null
    })
    useEffect(() => () => {
        lifetime.current?.owner.dispose()
        lifetime.current = null
    }, [])
    useEffect(() => {
        const dialog = ref.current
        const owner = lifetime.current?.owner
        if (!open || !dialog || owner?.hasDeparted()) return
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
            if (!owner?.hasDeparted() && previous?.isConnected && !previous.closest("[hidden],[inert]") && previous.checkVisibility()
                && (!frame || (!frame.closest("[hidden],[inert]") && frame.checkVisibility()))) {
                previous.focus({ preventScroll: true })
            }
        }
    }, [open])
    return ref
}
