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
            data-loading-overlay
            className="fixed inset-0 z-[2147483647] grid place-items-center overflow-hidden bg-black/72 backdrop-blur-[2px]"
            style={{ width: "100vw", height: "100dvh", minHeight: "100svh", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
            role="status"
            aria-live="polite"
            aria-label={label}
        >
            <div
                className="h-8 w-8 bg-white shadow-[0_0_24px_rgba(255,255,255,0.22)] motion-reduce:animate-none"
                style={{ animation: "betelgeze-loader 3.6s cubic-bezier(0.22, 1, 0.36, 1) infinite" }}
            />
        </div>,
        document.body
    )
}
