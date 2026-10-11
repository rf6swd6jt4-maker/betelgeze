"use client"

import { useCallback, useEffect, useState } from "react"

/** Search is explicit work: only latest bodies, one authorized page at a time. */
export function useConversationPreviewSearch({ enabled, active, query, workspaceSlug, kind, deviceId, scope }: {
    enabled: boolean; active: boolean; query: string; workspaceSlug: string; scope: string; kind: "client" | "native"; deviceId: string | null
}) {
    const [attempt, setAttempt] = useState(0)
    const [state, setState] = useState<{ scope: string; query: string; ids: Set<string>; pending: boolean; error: boolean }>({ scope, query: "", ids: new Set(), pending: false, error: false })
    useEffect(() => {
        if (!enabled || !active || !query) return
        const controller = new AbortController()
        const timer = window.setTimeout(() => {
            setState({ scope, query, ids: new Set(), pending: true, error: false })
            void (async () => {
                const ids = new Set<string>()
                const cursors = new Set<string>()
                let after: string | null = null
                do {
                    const params = new URLSearchParams({ kind, search: query, readProtocol: "device-v1", ...(after ? { after } : {}) })
                    const response = await fetch(`/api/workspaces/${workspaceSlug}/communications/search?${params}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) })
                    const result = await response.json() as { readProtocol?: string; deviceId?: string; conversationIds?: string[]; nextCursor?: string | null }
                    if (!response.ok || result.readProtocol !== "device-v1" || (deviceId && result.deviceId !== deviceId) || !Array.isArray(result.conversationIds) || result.conversationIds.length > 20 || (result.nextCursor !== null && typeof result.nextCursor !== "string")) throw new Error("Search unavailable")
                    controller.signal.throwIfAborted()
                    for (const id of result.conversationIds) ids.add(id)
                    after = result.nextCursor ?? null
                    if (after && cursors.has(after)) throw new Error("Search pagination did not advance")
                    if (after) cursors.add(after)
                    setState({ scope, query, ids: new Set(ids), pending: Boolean(after), error: false })
                } while (after)
            })().catch(() => { if (!controller.signal.aborted) setState(previous => ({ ...previous, scope, query, pending: false, error: true })) })
        }, 180)
        return () => { window.clearTimeout(timer); controller.abort() }
    }, [active, attempt, deviceId, enabled, kind, query, scope, workspaceSlug])
    const refresh = useCallback(() => setAttempt(current => current + 1), [])
    const matches = enabled && Boolean(query) && state.scope === scope && state.query === query
    return {
        ids: matches ? state.ids : null,
        pending: enabled && Boolean(query) && (!matches || state.pending),
        error: matches && state.error,
        retry: refresh, refresh,
    }
}
