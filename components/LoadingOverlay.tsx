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
            <div
                className="h-8 w-8 rotate-45 bg-white shadow-[0_0_24px_rgba(255,255,255,0.22)] motion-reduce:animate-none"
                style={{ animation: "betelgeze-loader 3.6s cubic-bezier(0.22, 1, 0.36, 1) infinite" }}
            />
        </div>,
        document.body
    )
}
