"use client"
import { useEffect, useRef } from "react"

/** Keep keyboard focus and scrolling inside the small conversation roster. */
export function useRosterDialog(open: boolean, onClose: () => void) {
    const dialogRef = useRef<HTMLElement>(null)
    const closeRef = useRef(onClose)
    useEffect(() => { closeRef.current = onClose }, [onClose])
    useEffect(() => {
        const dialog = dialogRef.current
        if (!open || !dialog) return
        const host = dialog.ownerDocument
        const origin = host.activeElement as HTMLElement | null
        const previousOverflow = host.body.style.overflow
        function onKey(event: KeyboardEvent) {
            if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return }
            if (event.key !== "Tab") return
            const focusable = [...dialog!.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
                .filter(element => element.getClientRects().length && !element.closest("[inert]"))
            if (!focusable.length) return
            // Safari may omit buttons from its default Tab sequence. Own each
            // step, not only the endpoints, so focus cannot fall behind the modal.
            const current = focusable.indexOf(host.activeElement as HTMLElement)
            const next = current < 0 ? event.shiftKey ? focusable.length - 1 : 0
                : (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length
            event.preventDefault()
            focusable[next].focus({ preventScroll: true })
        }
        host.body.style.overflow = "hidden"
        host.addEventListener("keydown", onKey)
        dialog.querySelector<HTMLElement>("button")?.focus({ preventScroll: true })
        return () => {
            host.body.style.overflow = previousOverflow
            host.removeEventListener("keydown", onKey)
            if (origin?.isConnected && host.visibilityState === "visible"
                && origin.getClientRects().length && !origin.closest("[inert]")) origin.focus({ preventScroll: true })
        }
    }, [open])
    return dialogRef
}
