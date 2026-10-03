"use client"

import { useEffect, useMemo, useState } from "react"
import type { RecordReferenceResult } from "@/lib/communications/references"
import { referenceContextKey, type ReferenceContext } from "@/lib/communications/reference-suggestions"
import { readReferenceResults } from "@/lib/communications/reference-results"

type SearchResult = { requestKey: object; results: RecordReferenceResult[]; status: "ready" | "error" }
const EMPTY_RESULTS: RecordReferenceResult[] = []

// This hook is owned by the mounted picker. Closing it cancels its request;
// Comms bootstrap, hidden tabs and ordinary typing never perform this read.
export function useComposerReferenceSearch(context: ReferenceContext | undefined, query: string) {
    const scope = referenceContextKey(context)
    const normalizedQuery = query.trim()
    const key = `${scope}:${normalizedQuery}`
    // Revisiting A after B gets a new identity; this state is not a result cache.
    const requestKey = useMemo(() => ({ key }), [key])
    const [result, setResult] = useState<SearchResult | null>(null)
    const { workspaceSlug, conversationId, userId, workspaceId } = context ?? {}
    useEffect(() => {
        if (!workspaceSlug || !conversationId || !userId || !workspaceId) return
        const controller = new AbortController()
        let disposed = false
        let deadline: ReturnType<typeof setTimeout> | undefined
        const debounce = setTimeout(() => {
            deadline = setTimeout(() => {
                controller.abort()
                if (!disposed) setResult({ requestKey, results: EMPTY_RESULTS, status: "error" })
            }, 8_000)
            const parameters = new URLSearchParams({ conversationId, q: normalizedQuery })
            void fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/communications/native/references?${parameters}`, { signal: controller.signal, cache: "no-store" })
                .then(async response => {
                    if (!response.ok) throw new Error("Reference search failed")
                    const results = readReferenceResults(await response.json(), { workspaceSlug, conversationId, userId, workspaceId }, 4)
                    if (!disposed && !controller.signal.aborted) setResult({ requestKey, results, status: "ready" })
                })
                .catch(() => { if (!disposed && !controller.signal.aborted) setResult({ requestKey, results: EMPTY_RESULTS, status: "error" }) })
                .finally(() => clearTimeout(deadline))
        }, 150)
        return () => { disposed = true; clearTimeout(debounce); clearTimeout(deadline); controller.abort() }
    }, [workspaceSlug, conversationId, userId, workspaceId, requestKey, normalizedQuery])
    return result?.requestKey === requestKey ? result : { results: EMPTY_RESULTS, status: context ? "loading" as const : "ready" as const }
}
