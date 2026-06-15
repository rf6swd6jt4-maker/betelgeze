type LoadingOverlayProps = {
    label?: string
}

export function LoadingOverlay({
    label = "Loading...",
}: LoadingOverlayProps) {
    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/45 backdrop-blur-sm"
            role="status"
            aria-live="polite"
            aria-label={label}
        >
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-white/60 bg-white/80 shadow-xl">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-[#1E3A5F]" />
            </div>
        </div>
    )
}
