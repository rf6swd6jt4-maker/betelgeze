"use client"

import { useEffect, useId, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"

/** Native top-layer focus containment, shared across cards and stepped workflows. */
export function CenteredDialog({ title, children, onClose, busy = false, wide = false, footer }: {
    title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean; footer?: ReactNode
}) {
    const active = useWorkspaceNavigation()?.active ?? true
    const ref = useRef<HTMLDialogElement>(null)
    const heading = useId()
    useEffect(() => {
        const dialog = ref.current
        const previous = dialog?.ownerDocument.activeElement as HTMLElement | null
        if (active) dialog?.showModal()
        return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
    }, [active])
    const target = typeof document === "undefined" ? null : window.parent !== window ? window.parent.document.body : document.body
    if (!target) return null
    return createPortal(<dialog ref={ref} aria-labelledby={heading} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} onClick={event => { if (!busy && event.target === event.currentTarget) onClose() }} className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-black/70 p-3 text-white backdrop:bg-transparent open:flex open:items-center open:justify-center sm:p-6">
        <section className={`betelgeze-popup-enter flex max-h-[calc(100dvh-1.5rem)] w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl sm:max-h-[calc(100dvh-3rem)] ${wide ? "max-w-3xl" : "max-w-lg"}`}>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3 sm:px-5"><h2 id={heading} className="min-w-0 text-lg font-semibold">{title}</h2><button data-icon-button type="button" disabled={busy} onClick={onClose} aria-label="Close popup" className="flex h-9 w-9 shrink-0 items-center justify-center text-xl text-neutral-400 hover:text-white disabled:opacity-40">×</button></div>
            <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">{children}</div>
            {footer ? <div className="shrink-0 border-t border-neutral-800 p-4 sm:px-5">{footer}</div> : null}
        </section>
    </dialog>, target)
}
