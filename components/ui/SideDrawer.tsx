"use client"

import { createPortal } from "react-dom"
import type { ReactNode } from "react"
import { useModalDialog } from "./useModalDialog"

/** Right-side companion navigation. The backdrop is stationary and closes immediately. */
export function SideDrawer({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
    const ref = useModalDialog(true)
    const dismiss = () => { ref.current?.close(); onClose() }
    if (typeof document === "undefined") return null
    return createPortal(<dialog ref={ref} aria-label={label} onCancel={event => { event.preventDefault(); dismiss() }}
        onClick={event => { if (event.target === event.currentTarget) dismiss() }}
        className="fixed inset-0 z-[90] m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-black/60 p-0 text-white backdrop:bg-transparent open:flex open:justify-end">
        <section data-side-drawer className="betelgeze-drawer-right flex h-full w-[min(22rem,calc(100%-3rem))] min-w-0 flex-col overflow-hidden border-l border-neutral-800 bg-neutral-950 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl shadow-black/40">
            {children}
        </section>
    </dialog>, document.body)
}
