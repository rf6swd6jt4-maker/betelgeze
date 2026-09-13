"use client"
import { useEffect, useRef, useState } from "react"
import { CenteredDialog } from "@/components/ui"
import { RelationshipServicePos } from "./RelationshipServicePos"
import { useRelationshipBackground } from "./RelationshipBackgroundEditor"
import type { ServicePosPage } from "@/lib/service-pos"

export function RelationshipPosDialog({ workspaceSlug, relationshipId, userId, selectedId, onClose }: {
    workspaceSlug: string; relationshipId: string; userId: string; selectedId?: string; onClose: () => void
}) {
    const background = useRelationshipBackground()
    const flush = useRef(background.flush)
    const [data, setData] = useState<ServicePosPage | null>(null)
    const [error, setError] = useState("")
    const [retry, setRetry] = useState(0)
    const [busy, setBusy] = useState(false)
    useEffect(() => {
        const controller = new AbortController()
        void (async () => {
            await flush.current()
            const response = await fetch(`/api/workspaces/${workspaceSlug}/relationships/${relationshipId}/pos`, { cache: "no-store", redirect: "error", headers: { "x-workspace-user": userId }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
            const value = await response.json()
            if (!response.ok) throw new Error(value.error)
            if (value.userId !== userId || value.relationshipId !== relationshipId || !value.relationship) throw new Error("Your account or relationship changed. Reopen the POS.")
            if (!controller.signal.aborted) { setData(value); setError("") }
        })().catch(error => { if (!controller.signal.aborted) setError(error.message) })
        return () => controller.abort()
    }, [workspaceSlug, relationshipId, userId, retry])
    return <CenteredDialog title={`Sell services${data?.relationship ? ` · ${data.relationship.company ?? data.relationship.name}` : ""}`} wide busy={busy} onClose={onClose}>
        {error ? <p role="alert" className="text-sm text-red-300">{error} <button className="min-h-11 underline" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : !data?.relationship ? <p role="status" className="py-8 text-center text-sm text-neutral-400">Loading sale details…</p> : <RelationshipServicePos workspaceSlug={workspaceSlug} relationshipId={relationshipId} userId={userId} initial={data} relationship={data.relationship} initialSelectionId={selectedId} onBusyChange={setBusy} />}
    </CenteredDialog>
}
