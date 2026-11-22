"use client"

import { useState, useTransition } from "react"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { AssignmentSelector, Button, Status } from "@/components/ui"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { leadMarkCommand } from "@/app/[workspaceSlug]/campaigns/actions"

function useMark(workspaceSlug: string) {
    const router = useRouter()
    const [sending, setSending] = useState(false)
    const [refreshing, startRefresh] = useTransition()
    const [error, setError] = useState<string | null>(null)
    async function run(input: Parameters<typeof leadMarkCommand>[1]) {
        setSending(true); setError(null)
        try {
            const result = await runWorkspaceMutation(() => leadMarkCommand(workspaceSlug, input))
            if (!result.ok) setError(result.error)
            else startRefresh(() => router.refresh())
        } catch { setError("Could not save. Please retry.") } finally { setSending(false) }
    }
    return { run, pending: sending || refreshing, error }
}

/** A lead's setter (owners and admins), or a source's default setter for its new leads (docs/text-flows.md). */
export function SetterField({ workspaceSlug, target, id, value, people }: { workspaceSlug: string; target: "lead" | "source"; id: string; value: string | null; people: { id: string; name: string }[] }) {
    const { run, pending, error } = useMark(workspaceSlug)
    const [current, setCurrent] = useState(value ?? "")
    return <div className="min-w-0">
        <AssignmentSelector value={current} people={people} disabled={pending} ariaLabel={target === "lead" ? "Setter" : "Default setter"} placeholder="Unassigned" clearLabel="Unassigned"
            title={target === "lead" ? "Setter" : "Default setter"} description={target === "lead" ? "Their texts are signed with this name." : "New leads from this source get this setter."}
            onChange={next => { setCurrent(next); void run({ kind: target === "lead" ? "setter" : "source_setter", id, userId: next || null }) }} />
        {error ? <p role="alert" className="mt-1 text-xs text-red-300">{error}</p> : null}
    </div>
}

/** The Call mark a flow adds ("Add a call task"), cleared once someone has called. */
export function CallMark({ workspaceSlug, leadId, reason }: { workspaceSlug: string; leadId: string; reason: string | null }) {
    const { run, pending, error } = useMark(workspaceSlug)
    return <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Status label="Call due" tone="yellow" />
        <span className="min-w-0 flex-1 text-sm text-neutral-400">{reason ? `Added by ${reason}.` : "A call task for their setter."}</span>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => void run({ kind: "called", id: leadId })}>{pending ? "Saving…" : "Mark called"}</Button>
        {error ? <span role="alert" className="w-full text-xs text-red-300">{error}</span> : null}
    </div>
}

/** Confirmed on an appointment: a reply word, a flow action, or this button. */
export function ConfirmAppointment({ workspaceSlug, bookingId, confirmed }: { workspaceSlug: string; bookingId: string; confirmed: boolean }) {
    const { run, pending, error } = useMark(workspaceSlug)
    if (confirmed) return <Status label="Confirmed" tone="green" />
    return <span className="inline-flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => void run({ kind: "confirmed", id: bookingId })}>{pending ? "Saving…" : "Mark confirmed"}</Button>
        {error ? <span role="alert" className="text-xs text-red-300">{error}</span> : null}
    </span>
}
