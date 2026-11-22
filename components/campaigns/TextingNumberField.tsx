"use client"

import { useState, useTransition } from "react"
import Link from "@/components/workspace/WorkspaceLink"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { Button, CenteredDialog, Selector } from "@/components/ui"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { setTextingNumberAction, textingLeadsAction } from "@/app/[workspaceSlug]/settings/signalhouse/actions"

export type TextingNumberOption = { id: string; name: string; canSend: boolean }

/**
 * The number a campaign (or one of its sources) texts from. Leads keep the number that first texted them; when some
 * already text with the current one, changing it asks whether they stay on it (recommended) or move too.
 */
export function TextingNumberField({ workspaceSlug, kind, targetId, value, options, inheritLabel, label }: {
    workspaceSlug: string; kind: "campaign" | "source"; targetId: string; value: string | null; options: TextingNumberOption[]
    /** A source's "use the campaign's number" choice. */
    inheritLabel?: string; label: string
}) {
    const router = useRouter()
    const [sending, setSending] = useState(false)
    const [refreshing, startRefresh] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const [ask, setAsk] = useState<{ to: string | null; count: number } | null>(null)
    const pending = sending || refreshing
    const INHERIT = "__campaign"

    async function save(to: string | null, move: boolean) {
        setSending(true); setError(null)
        try {
            const result = await runWorkspaceMutation(() => setTextingNumberAction(workspaceSlug, kind, targetId, to, move))
            if (!result.ok) setError(result.error)
            else { setAsk(null); startRefresh(() => router.refresh()) }
        } catch { setError("Could not save. Please retry.") } finally { setSending(false) }
    }
    async function choose(next: string) {
        const to = next === INHERIT ? null : next
        if (to === value) return
        setSending(true); setError(null)
        try {
            const counted = await textingLeadsAction(workspaceSlug, kind, targetId)
            setSending(false)
            if (!counted.ok) { setError(counted.error); return }
            const count = Number(counted.count ?? 0)
            if (count > 0) setAsk({ to, count })
            else await save(to, false)
        } catch { setSending(false); setError("Could not save. Please retry.") }
    }

    if (!options.length) return <p className="text-sm text-neutral-400">No numbers yet. <Link href={`/${workspaceSlug}/settings/signalhouse`} className="text-white underline-offset-2 hover:underline">Connect SignalHouse and add a number</Link> to text {kind === "campaign" ? "this campaign's" : "this source's"} leads.</p>
    const choices = [
        ...(inheritLabel ? [{ value: INHERIT, label: inheritLabel }] : []),
        ...options.map(option => ({ value: option.id, label: option.canSend ? option.name : `${option.name} · registration not active`, disabled: !option.canSend })),
    ]
    const toName = ask ? (ask.to ? options.find(option => option.id === ask.to)?.name : inheritLabel) ?? "the new number" : ""
    return <div className="flex min-w-0 flex-col gap-1.5">
        <div className="w-full max-w-sm"><Selector appearance="input" ariaLabel={label} disabled={pending} value={value ?? (inheritLabel ? INHERIT : "")} placeholder="Pick a number" options={choices} onChange={next => void choose(next)} /></div>
        {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : null}
        {ask ? <CenteredDialog title={`Text from ${toName}?`} busy={pending} onClose={() => setAsk(null)} footer={<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button size="sm" disabled={pending} onClick={() => void save(ask.to, false)}>Keep their conversations</Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => void save(ask.to, true)}>Move them too</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setAsk(null)}>Cancel</Button>
        </div>}>
            <p className="text-sm text-neutral-300">New leads get texts from {toName}. {ask.count === 1 ? "1 lead is" : `${ask.count} leads are`} already texting with the current number.</p>
            <p className="mt-3 text-sm text-neutral-400"><span className="text-neutral-200">Keep their conversations</span> (recommended): they stay on the number they know, so their replies stay in one thread. <span className="text-neutral-200">Move them too</span>: their next text comes from {toName}, a number they have not seen.</p>
        </CenteredDialog> : null}
    </div>
}
