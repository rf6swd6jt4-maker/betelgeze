"use client"

import { useState } from "react"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { Button } from "@/components/ui"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { setCampaignStatus } from "@/app/[workspaceSlug]/campaigns/actions"

/** Go live, or pause. Paused campaigns keep accepting leads from forms that are still online. */
export function CampaignStatusButton({ workspaceSlug, campaignId, status }: { workspaceSlug: string; campaignId: string; status: string }) {
    const router = useRouter()
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const next = status === "live" ? "paused" : "live"
    return <span className="flex items-center gap-3">
        {error ? <span role="alert" className="text-sm text-red-300">{error}</span> : null}
        <Button size="sm" variant="secondary" disabled={pending} onClick={async () => {
            setPending(true); setError(null)
            try {
                const result = await runWorkspaceMutation(() => setCampaignStatus(workspaceSlug, campaignId, next))
                if (!result.ok) setError(result.error)
                else router.refresh()
            } catch {
                setError("Could not save. Please retry.")
            } finally {
                setPending(false)
            }
        }}>{status === "live" ? "Pause" : status === "paused" ? "Resume" : "Go live"}</Button>
    </span>
}
