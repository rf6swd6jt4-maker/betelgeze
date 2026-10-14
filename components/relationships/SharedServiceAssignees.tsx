"use client"
import { useEffect, useRef, useState } from "react"
import { Assignee, SelectorDrawer, SelectorOption, SelectorTrigger } from "@/components/ui"
import { isServiceRosterRequest, type ServiceRoster, type ServiceRosterRequest } from "@/lib/shared-service-queue"

/** On-demand editor: no roster request or member payload on relationship entry. */
type Props = { endpoint: string; instanceId: string; userId: string; allowChanges?: boolean }
export function SharedServiceAssignees(props: Props) {
    return <SharedServiceAssigneesEditor key={`${props.endpoint}:${props.instanceId}:${props.userId}`} {...props} />
}
function SharedServiceAssigneesEditor({ endpoint, instanceId, userId, allowChanges = true }: Props) {
    const [opened, setOpened] = useState(false)
    const [roster, setRoster] = useState<ServiceRoster | null>(null)
    const [members, setMembers] = useState<string[]>([])
    const [query, setQuery] = useState("")
    const [anchor, setAnchor] = useState<HTMLElement | null>(null)
    const [pending, setPending] = useState(false)
    const [recovery, setRecovery] = useState<ServiceRosterRequest | null>(null)
    const [error, setError] = useState("")
    const [recoveryProblem, setRecoveryProblem] = useState("")
    const [saved, setSaved] = useState(false)
    const [retry, setRetry] = useState(0)
    const mounted = useRef(true)
    const key = `service-members:${userId}:${instanceId}`
    const url = endpoint.replace(/\/services$/, "/service-members")
    useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
    useEffect(() => {
        if (!opened) return
        const controller = new AbortController()
        queueMicrotask(() => {
        if (controller.signal.aborted) return
        try {
            const value = sessionStorage.getItem(key)
            if (value) {
                const parsed: unknown = JSON.parse(value)
                if (!isServiceRosterRequest(parsed) || parsed.instanceId !== instanceId) throw new Error("Saved assignment request is invalid. Contact an administrator.")
                setRecovery(parsed)
            }
        } catch (e) { setRecoveryProblem(e instanceof Error ? e.message : "Could not read saved assignment request") }
        })
        void fetch(`${url}?instance=${instanceId}`, { headers: { "x-workspace-user": userId }, cache: "no-store", redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) }).then(async response => {
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || "Could not load assignees")
            if (!controller.signal.aborted) { setRoster(data); setMembers(data.memberIds) }
        }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
        return () => controller.abort()
    }, [opened, url, instanceId, userId, key, retry])
    async function save() {
        if (!roster || pending || recoveryProblem || (!allowChanges && !recovery)) return
        const input = recovery ?? { instanceId, version: roster.version, members, requestId: crypto.randomUUID() }
        try { sessionStorage.setItem(key, JSON.stringify(input)) } catch { setError("Device recovery is unavailable. Nothing was sent; enable storage and retry."); return }
        setRecovery(input); setPending(true); setError(""); setSaved(false); setAnchor(null)
        try {
            const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-user": userId }, body: JSON.stringify(input), redirect: "error", signal: AbortSignal.timeout(30000) })
            const data = await response.json()
            if (!response.ok) {
                if ((response.status === 409 && data.code !== "account_changed") || response.status === 400) { sessionStorage.removeItem(key); if (mounted.current) setRecovery(null); if (mounted.current) setRoster(null) }
                throw new Error(data.error || "Assignments were not confirmed. Retry the same request.")
            }
            sessionStorage.removeItem(key)
            if (mounted.current) { setRoster(data); setMembers(data.memberIds); setRecovery(null); setSaved(true) }
        } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Assignments were not confirmed. Retry the same request.") }
        finally { if (mounted.current) setPending(false) }
    }
    if (!opened) return <button type="button" className="min-h-11 text-sm underline" onClick={() => setOpened(true)}>{allowChanges ? "Manage assignees" : "Review saved assignment changes"}</button>
    const selected = roster?.people.filter(person => person.id === roster.primaryId || members.includes(person.id)) ?? []
    return <div className="mt-4 space-y-3">
        <p className="text-sm text-neutral-400">Assigned people share this service’s queue and the existing internal client group, including its history. Either person can complete work.</p>
        {roster ? <>
            <SelectorTrigger aria-label="Service assignees" open={Boolean(anchor)} disabled={pending || Boolean(recovery) || Boolean(recoveryProblem) || !allowChanges} onClick={event => setAnchor(anchor ? null : event.currentTarget)} appearance="input" className="h-auto min-h-11 py-2">
                <span className="flex min-w-0 flex-wrap gap-1">{selected.map(person => <Assignee key={person.id} name={person.name} />)}</span>
            </SelectorTrigger>
            {anchor ? <SelectorDrawer anchor={anchor} onDismiss={() => setAnchor(null)} ariaLabel="Choose service assignees" title="Service assignees" description="The primary assignee stays assigned. Use Transfer assignee to change them." search={roster.people.length >= 7 ? query : undefined} onSearch={roster.people.length >= 7 ? setQuery : undefined}>
                {roster.people.filter(person => person.name.toLowerCase().includes(query.toLowerCase())).map(person => <SelectorOption key={person.id} selected={person.id === roster.primaryId || members.includes(person.id)} disabled={person.id === roster.primaryId} onClick={() => { setSaved(false); setMembers(current => current.includes(person.id) ? current.filter(id => id !== person.id) : [...current, person.id]) }}><Assignee name={person.name} /></SelectorOption>)}
            </SelectorDrawer> : null}
            {!allowChanges && !recovery ? <p className="text-sm text-neutral-400">This service is closed. Only a previously saved request can be recovered.</p> : null}
            <p className="text-xs text-neutral-400">Removing a person pauses their active shared work. Separate group access is retained.</p>
            <button type="button" disabled={pending || members.length > 19 || Boolean(recoveryProblem) || (!allowChanges && !recovery)} onClick={() => void save()} className="min-h-11 rounded-lg bg-white px-4 text-sm text-black disabled:opacity-50">{pending ? "Saving…" : recovery ? "Retry same assignment change" : "Save assignees"}</button>
        </> : <p className="text-sm text-neutral-400">Loading assignees…</p>}
        {saved ? <p role="status" className="text-sm text-neutral-300">Assignees saved. They can open Work Queue and the internal client group.</p> : null}
        {recoveryProblem ? <p role="alert" className="text-sm text-red-300">{recoveryProblem} No new assignment change can be sent until recovery is available.</p> : null}
        {error ? <p role="alert" className="text-sm text-red-300">{error} {!recovery && !pending ? <button type="button" className="min-h-11 underline" onClick={() => { setError(""); setRetry(n => n + 1) }}>Reload assignees</button> : null}</p> : null}
    </div>
}
