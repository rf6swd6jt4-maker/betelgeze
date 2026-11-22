"use client"

import { useState } from "react"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { Button } from "@/components/ui"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { createCampaign } from "@/app/[workspaceSlug]/campaigns/actions"

export function NewCampaignForm({ workspaceSlug }: { workspaceSlug: string }) {
    const router = useRouter()
    const [name, setName] = useState("")
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    return <form className="mt-5 flex max-w-xl flex-wrap items-start gap-3" onSubmit={async event => {
        event.preventDefault()
        if (pending) return
        setPending(true); setError(null)
        try {
            const result = await runWorkspaceMutation(() => createCampaign(workspaceSlug, name))
            if (!result.ok) { setError(result.error); setPending(false); return }
            router.push(`/${workspaceSlug}/campaigns/${String(result.data.id)}?tab=sources`)
        } catch {
            setError("Could not create the campaign. Please retry.")
            setPending(false)
        }
    }}>
        <label className="min-w-0 flex-1">
            <span className="sr-only">Campaign name</span>
            <input value={name} onChange={event => setName(event.target.value)} maxLength={120} autoFocus placeholder="Campaign name, like Roofing Clients"
                className="h-9 w-full rounded-md border border-[var(--color-border-default)] bg-transparent px-2.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-[var(--color-border-strong)]" />
        </label>
        <Button size="sm" type="submit" disabled={pending || !name.trim()}>{pending ? "Creating…" : "Create campaign"}</Button>
        {error ? <p role="alert" className="w-full text-sm text-red-300">{error}</p> : null}
    </form>
}
