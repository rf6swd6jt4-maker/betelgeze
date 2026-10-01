"use client"

import { useEffect, useRef, type ReactNode } from "react"

/** A nonmodal shell companion: chrome remains available above the drawer. */
export function SideDrawer({ label, onClose, children, modal = false }: { label: string; onClose: () => void; children: ReactNode | ((dismiss: () => void) => ReactNode); modal?: boolean }) {
    const ref = useRef<HTMLDialogElement>(null)
    const closeRef = useRef(onClose)
    const releaseRef = useRef<() => void>(() => {})
    useEffect(() => { closeRef.current = onClose }, [onClose])
    useEffect(() => {
        const dialog = ref.current
        if (!dialog) return
        const document = dialog.ownerDocument
        const previous = document.activeElement as HTMLElement | null
        const shell = dialog.closest("[data-workspace-shell-root]")
        const covered = [...(shell?.querySelectorAll<HTMLElement>("[data-workspace-tabbar], [data-workspace-tab-panels]") ?? [])]
            .map(element => ({ element, inert: element.inert }))
        let released = false
        const release = () => {
            if (released) return
            released = true
            const restoreFocus = dialog.contains(document.activeElement) || document.activeElement === document.body
            dialog.close()
            covered.forEach(({ element, inert }) => { element.inert = inert })
            if (restoreFocus && previous?.isConnected && !previous.closest("[hidden],[inert]") && previous.checkVisibility()) {
                previous.focus({ preventScroll: true })
            }
        }
        releaseRef.current = release
        // show(), not showModal(): native top-layer modality would cover and
        // disable the app header even when the drawer starts below it.
        if (!dialog.open) { if (modal) dialog.showModal(); else dialog.show() }
        covered.forEach(({ element }) => { element.inert = true })
        const escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return
            const otherModal = [...document.querySelectorAll<HTMLElement>('dialog:modal, [role="dialog"][aria-modal="true"]')]
                .some(element => element !== dialog && element.checkVisibility())
            if (otherModal) return
            event.preventDefault()
            release()
            closeRef.current()
        }
        document.addEventListener("keydown", escape)
        return () => { document.removeEventListener("keydown", escape); release() }
    }, [modal])
    const dismiss = () => { releaseRef.current(); onClose() }
    // The render callback attaches dismiss to event handlers; it must not call it during render.
    // eslint-disable-next-line react-hooks/refs -- Passing an event callback does not read the dialog ref.
    const content = typeof children === "function" ? children(dismiss) : children
    return <dialog ref={ref} data-workspace-side-drawer aria-label={label} aria-modal={modal}
        onCancel={event => { event.preventDefault(); dismiss() }}
        onClick={event => { if (event.target === event.currentTarget) dismiss() }}
        className="fixed inset-x-0 top-0 z-50 m-0 h-dvh max-h-none w-full max-w-none overflow-clip border-0 bg-black/60 p-0 text-white backdrop:bg-transparent open:flex open:justify-end">
        <section data-side-drawer className={`betelgeze-drawer-right flex h-full w-[min(22rem,calc(100%-3rem))] min-w-0 flex-col overflow-hidden border-l border-neutral-800 bg-neutral-950 pb-[env(safe-area-inset-bottom)] shadow-2xl shadow-black/40 ${modal ? "pt-[env(safe-area-inset-top)]" : ""}`}>
            {content}
        </section>
    </dialog>
}
