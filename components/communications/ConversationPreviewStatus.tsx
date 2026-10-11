"use client"

export function ConversationPreviewStatus({ failed = false }: { failed?: boolean }) {
    return <span className="inline-flex min-w-0 items-center gap-1.5" role="status">
        {!failed ? <span aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin rounded-full border border-current border-r-transparent motion-reduce:animate-none" /> : null}
        <span className="truncate">{failed ? "Messages unavailable · select to retry" : "Loading messages"}</span>
    </span>
}
