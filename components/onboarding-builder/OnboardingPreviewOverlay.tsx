"use client"

import { type ComponentProps, type ReactNode, useState, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { BuilderPreview } from "./BuilderPreview"

// The POS preview surface is shared by every relationship preview entry point.
export function OnboardingPreviewOverlay({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    useEffect(() => { const dialog = dialogRef.current; if (open) dialog?.showModal(); return () => dialog?.close() }, [open])
    const parentDocument = typeof window !== "undefined" && window.parent !== window ? window.parent.document : typeof document !== "undefined" ? document : null
    if (!open || !parentDocument) return null
    return createPortal(<dialog ref={dialogRef} onCancel={event => { event.preventDefault(); onClose() }} aria-label="Onboarding preview" data-pos-onboarding-preview className="betelgeze-popup-fade m-0 h-dvh max-h-none w-full max-w-none border-0 p-0 fixed inset-0 z-[2147483646] overflow-hidden bg-neutral-100 text-white">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start p-3 sm:p-4">
            <button type="button" onClick={onClose} className="pointer-events-auto rounded-full border border-white/20 bg-neutral-700 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(0,0,0,0.24)] transition hover:bg-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/70">Exit preview</button>
        </div>
        <div className="h-full min-h-0">{children}</div>
    </dialog>, parentDocument.body)
}

export function OnboardingPreviewButton(props: ComponentProps<typeof BuilderPreview>) {
    const [open, setOpen] = useState(false)
    return <>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 shrink-0 sm:min-h-9 items-center justify-center whitespace-nowrap rounded-lg bg-white px-3 text-sm font-medium text-black">Preview</button>
        <OnboardingPreviewOverlay open={open} onClose={() => setOpen(false)}><BuilderPreview {...props} fullWindow /></OnboardingPreviewOverlay>
    </>
}
