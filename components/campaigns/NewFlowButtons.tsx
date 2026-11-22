"use client"

import { useState } from "react"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { Button } from "@/components/ui"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { createFlowAction } from "@/app/[workspaceSlug]/campaigns/flow-actions"

/** New flow, and on an empty tab the four starter flows from the plan (all switched off). */
export function NewFlowButtons({ workspaceSlug, campaignId, base, starters }: { workspaceSlug: string; campaignId: string; base: string; starters: boolean }) {
    const router = useRouter()
    const [pending, setPending] = useState<"blank" | "starters" | null>(null)
    const [error, setError] = useState<string | null>(null)
    async function create(kind: "blank" | "starters") {
        setPending(kind); setError(null)
        try {
            const result = await runWorkspaceMutation(() => createFlowAction(workspaceSlug, campaignId, kind))
            if (!result.ok) { setError(result.error); return }
            if (kind === "blank" && result.id) router.push(`${base}/flows/${result.id}`)
            else router.refresh()
        } catch { setError("Could not create the flow. Please retry.") } finally { setPending(null) }
    }
    return <div className="flex flex-wrap items-center gap-2">
        {starters ? <Button size="sm" disabled={pending !== null} onClick={() => void create("starters")}>{pending === "starters" ? "Adding…" : "Add the four starter flows"}</Button> : null}
        <Button size="sm" variant={starters ? "secondary" : "primary"} disabled={pending !== null} onClick={() => void create("blank")}>{pending === "blank" ? "Creating…" : "New flow"}</Button>
        {error ? <span role="alert" className="text-xs text-red-300">{error}</span> : null}
    </div>
}
