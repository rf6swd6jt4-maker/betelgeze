"use client"

import { createPortal } from "react-dom"

type LoadingOverlayProps = {
    label?: string
}

export function LoadingOverlay({
    label = "Loading...",
}: LoadingOverlayProps) {
    if (typeof document === "undefined") return null

    return createPortal(
        <div
            className="fixed inset-0 z-[2147483647] flex h-auto min-h-[100vh] w-[100vw] items-center justify-center bg-black/72 backdrop-blur-[2px]"
            role="status"
            aria-live="polite"
            aria-label={label}
        >
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-500/50 border-t-white" />
        </div>,
        document.body
    )
}
