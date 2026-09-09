"use client"

import { Status } from "@/components/ui"
import { useOnline } from "@/components/pwa/useOnline"
import { cancelOfflineMessage, flushOfflineOutbox, retryOfflineMessage, type OfflineMessage } from "@/public/offline-store.js"

export function ChatOutboxStatus({ entries, conversationId }: { entries: OfflineMessage[]; conversationId: string }) {
    const online = useOnline()
    const waiting = entries.filter((item) => item.conversationId === conversationId && (!online || item.state === "blocked" || item.attempts > 1 || (item.state === "queued" && item.attempts > 0)))
    if (!waiting.length) return null
    return <div className="shrink-0 space-y-1 px-4 py-2" aria-live="polite">
        {waiting.map((item) => <div key={item.id} className="flex min-w-0 items-center gap-2 text-xs text-neutral-400">
            <Status compact tone={item.state === "blocked" ? "red" : "yellow"} label={item.state === "blocked" ? "Message needs attention" : "Message waiting for connection"} />
            <span className="min-w-0 flex-1 truncate" title={item.error || String(item.payload.body || "Attachment")}>{item.error || (item.attempts ? "Confirming delivery when connected" : "Saved on this device · waiting to send")}</span>
            {(item.attempts === 0 && item.state === "queued") || item.state === "blocked" ? <button type="button" className="min-h-9 shrink-0 underline" onClick={() => void cancelOfflineMessage(item.id)}>Cancel</button> : null}
            {item.state === "blocked" ? <button type="button" className="min-h-9 shrink-0 underline" onClick={() => void retryOfflineMessage(item.id).then(() => flushOfflineOutbox(item.userId))}>Retry</button> : null}
        </div>)}
    </div>
}
