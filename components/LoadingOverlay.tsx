type LoadingOverlayProps = {
    label?: string
}

export function LoadingOverlay({
    label = "Loading...",
}: LoadingOverlayProps) {
    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 backdrop-blur-[2px]"
            role="status"
            aria-live="polite"
            aria-label={label}
        >
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/30 border-t-white" />
        </div>
    )
}
