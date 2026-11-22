"use client"

import { useState } from "react"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { Button } from "@/components/ui"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { campaignCommand } from "@/app/[workspaceSlug]/campaigns/actions"

/** Creates a source in Testing and opens its settings page. */
export function AddSourceButton({ workspaceSlug, campaignId }: { workspaceSlug: string; campaignId: string }) {
    const router = useRouter()
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    return <span className="flex items-center gap-3">
        {error ? <span role="alert" className="text-sm text-red-300">{error}</span> : null}
        <Button size="sm" disabled={pending} onClick={async () => {
            setPending(true); setError(null)
            try {
                const result = await runWorkspaceMutation(() => campaignCommand(workspaceSlug, "create_source", { campaign_id: campaignId }))
                if (!result.ok) { setError(result.error); return }
                router.push(`/${workspaceSlug}/campaigns/${campaignId}/sources/${String(result.data.id)}`)
            } catch {
                setError("Could not add a source. Please retry.")
            } finally {
                setPending(false)
            }
        }}>{pending ? "Adding…" : "Add source"}</Button>
    </span>
}
