"use client"

import { useEffect, useState } from "react"
import { Status } from "@/components/ui"
import { activateOfflineAccount, readOfflineOutbox, startOfflineRecovery, subscribeOffline } from "@/public/offline-store.js"
import { useOnline } from "./useOnline"

export function WorkspaceOfflineStatus({ userId }: { userId: string }) {
    const online = useOnline()
    const [pending, setPending] = useState(0)
    const [blocked, setBlocked] = useState(false)
    const [authRequired, setAuthRequired] = useState(false)
    useEffect(() => {
        let disposed = false
        let stop: (() => void) | undefined
        const refresh = () => { void readOfflineOutbox(userId).then((items) => {
            if (disposed) return
            setPending(items.filter((item) => item.state !== "sent" && (!navigator.onLine || item.state === "blocked" || item.attempts > 1 || (item.state === "queued" && item.attempts > 0))).length)
            setBlocked(items.some((item) => item.state === "blocked"))
        }).catch(() => undefined) }
        const unsubscribe = subscribeOffline((type) => {
            if (type === "outbox" || type === "account") refresh()
            if (type === "auth") setAuthRequired(true)
            if (type === "connected") setAuthRequired(false)
        })
        void activateOfflineAccount(userId).then(() => {
            if (disposed) return
            stop = startOfflineRecovery(userId); refresh()
        }).catch(() => undefined)
        // An expired session must retain drafts for reauthentication. Explicit
        // logout clears storage in ServiceWorkerRegistrar before navigation.
        return () => { disposed = true; unsubscribe(); stop?.() }
    }, [userId])
    if (online && !pending) return null
    const label = !online ? pending ? `Offline · ${pending} waiting` : "Offline" : authRequired ? "Sign in to send" : blocked ? "Message needs attention" : `${pending} waiting to send`
    return <a href="/offline.html" data-global-loading="false" title={`${label}. Open saved chats.`} className="inline-flex min-h-9 shrink-0 items-center gap-2 text-xs">
        <Status compact label={label} tone={blocked ? "red" : "yellow"} /><span className="hidden max-w-36 truncate sm:inline">{label}</span>
    </a>
}
