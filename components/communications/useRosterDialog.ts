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
            const first = focusable[0], last = focusable.at(-1)
            if (!first || !last) return
            if (event.shiftKey && host.activeElement === first) { event.preventDefault(); last.focus() }
            else if (!event.shiftKey && host.activeElement === last) { event.preventDefault(); first.focus() }
        }
        host.body.style.overflow = "hidden"
        host.addEventListener("keydown", onKey)
        dialog.querySelector<HTMLElement>("button")?.focus()
        return () => { host.body.style.overflow = previousOverflow; host.removeEventListener("keydown", onKey); origin?.focus({ preventScroll: true }) }
    }, [open])
    return dialogRef
}
