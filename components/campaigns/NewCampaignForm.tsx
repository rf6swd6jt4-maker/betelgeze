"use client"

import { useState } from "react"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { Button } from "@/components/ui"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { createCampaign } from "@/app/[workspaceSlug]/campaigns/actions"

/** The campaign's name, then Create. It opens on Sources, where its first landing page is added. */
export function NewCampaignForm({ workspaceSlug }: { workspaceSlug: string }) {
    const router = useRouter()
    const [name, setName] = useState("")
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    return <form className="mt-6 max-w-xl" onSubmit={async event => {
        event.preventDefault()
        if (pending || !name.trim()) return
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
        <label htmlFor="campaign-name" className="text-sm text-neutral-400">Name</label>
        <input id="campaign-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} autoFocus placeholder="Roofing Clients"
            className="mt-1.5 h-11 w-full rounded-md border border-[var(--color-border-default)] bg-transparent px-3 text-base text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-[var(--color-border-strong)] sm:h-8 sm:text-sm" />
        <p className="mt-1.5 text-xs text-neutral-500">Who the campaign is for, so its leads are easy to tell apart.</p>
        {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
        <div className="mt-5 flex items-center gap-2">
            <Button type="submit" disabled={pending || !name.trim()}>{pending ? "Creating…" : "Create campaign"}</Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => router.back()}>Cancel</Button>
        </div>
    </form>
}
