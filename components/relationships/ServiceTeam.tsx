"use client"
import { useEffect, useRef, useState } from "react"
import { Assignee, RoundPill, SelectorDrawer, SelectorOption, SelectorTrigger } from "@/components/ui"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow } from "@/components/list/List"
import { isServiceRosterRequest, type ServiceRoster, type ServiceRosterRequest } from "@/lib/shared-service-queue"

type ClientChatRoster = { managerId: string | null; memberIds: string[]; optionalIds: string[]; eligibleIds: string[]; viewOnlyIds: string[] }
type ClientChatAccess = { canManage: boolean; roster: ClientChatRoster | null }

/** One list per service: who shares its work queue and internal Team chat,
 * and (for the relationship's manager) who is also in the client-facing chat.
 * Replaces the former separate "Primary assignee" field and "Manage assignees" link. */
type Props = { endpoint: string; workspaceSlug: string; relationshipId: string; instanceId: string; userId: string; ownerId: string | null; ownerName: string; allowChanges?: boolean }
export function ServiceTeam(props: Props) {
    return <ServiceTeamEditor key={`${props.endpoint}:${props.instanceId}:${props.userId}`} {...props} />
}
function ServiceTeamEditor({ endpoint, workspaceSlug, relationshipId, instanceId, userId, ownerId, ownerName, allowChanges = true }: Props) {
    const [roster, setRoster] = useState<ServiceRoster | null>(null)
    const [members, setMembers] = useState<string[]>([])
    const [query, setQuery] = useState("")
    const [anchor, setAnchor] = useState<HTMLElement | null>(null)
    const [pending, setPending] = useState(false)
    const [recovery, setRecovery] = useState<ServiceRosterRequest | null>(null)
    const [error, setError] = useState("")
    const [recoveryProblem, setRecoveryProblem] = useState("")
    const [retry, setRetry] = useState(0)
    const [chat, setChat] = useState<ClientChatAccess | null>(null)
    const [chatError, setChatError] = useState("")
    const [chatPendingId, setChatPendingId] = useState<string | null>(null)
    const mounted = useRef(true)
    const key = `service-members:${userId}:${instanceId}`
    const url = endpoint.replace(/\/services$/, "/service-members")
    useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
    useEffect(() => {
        const controller = new AbortController()
        queueMicrotask(() => {
            if (controller.signal.aborted) return
            try {
                const value = sessionStorage.getItem(key)
                if (value) {
                    const parsed: unknown = JSON.parse(value)
                    if (!isServiceRosterRequest(parsed) || parsed.instanceId !== instanceId) throw new Error("Saved service team request is invalid. Contact an administrator.")
                    setRecovery(parsed)
                }
            } catch (e) { setRecoveryProblem(e instanceof Error ? e.message : "Could not read saved service team request") }
        })
        void fetch(`${url}?instance=${instanceId}`, { headers: { "x-workspace-user": userId }, cache: "no-store", redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) }).then(async response => {
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || "Could not load the service team")
            if (!controller.signal.aborted) { setRoster(data); setMembers(data.memberIds) }
        }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
        return () => controller.abort()
    }, [url, instanceId, userId, key, retry])
    useEffect(() => {
        const controller = new AbortController()
        void fetch(`${endpoint}?kind=client_chat`, { headers: { "x-workspace-user": userId }, cache: "no-store", redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) }).then(async response => {
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || "Could not load client chat access")
            if (!controller.signal.aborted) setChat(data)
        }).catch(e => { if (!controller.signal.aborted) setChatError(e.message) })
        return () => controller.abort()
    }, [endpoint, userId, retry])
    async function save(nextMembers: string[]) {
        if (!roster || pending || recoveryProblem || (!allowChanges && !recovery)) return
        const input = recovery ?? { instanceId, version: roster.version, members: nextMembers, requestId: crypto.randomUUID() }
        try { sessionStorage.setItem(key, JSON.stringify(input)) } catch { setError("Device recovery is unavailable. Nothing was sent; enable storage and retry."); return }
        setRecovery(input); setPending(true); setError(""); setAnchor(null)
        try {
            const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-user": userId }, body: JSON.stringify(input), redirect: "error", signal: AbortSignal.timeout(30000) })
            const data = await response.json()
            if (!response.ok) {
                if ((response.status === 409 && data.code !== "account_changed") || response.status === 400) { sessionStorage.removeItem(key); if (mounted.current) setRecovery(null); if (mounted.current) setRoster(null) }
                throw new Error(data.error || "The service team was not confirmed. Retry the same request.")
            }
            sessionStorage.removeItem(key)
            if (mounted.current) { setRoster(data); setMembers(data.memberIds); setRecovery(null) }
        } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "The service team was not confirmed. Retry the same request.") }
        finally { if (mounted.current) setPending(false) }
    }
    async function toggleClientChat(personId: string, included: boolean) {
        if (!chat?.canManage || chatPendingId) return
        const current = chat.roster
        const optionalIds = current?.optionalIds ?? []
        const viewOnlyIds = current?.viewOnlyIds ?? []
        const viewIds = included ? [...new Set([...optionalIds, personId])] : optionalIds.filter(id => id !== personId)
        setChatPendingId(personId); setChatError("")
        try {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/communications/participants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relationshipId, viewIds, viewOnlyIds: viewOnlyIds.filter(id => viewIds.includes(id)) }), redirect: "error", signal: AbortSignal.timeout(30000) })
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || "Could not update client chat access.")
            setChat(previous => previous?.roster ? { ...previous, roster: { ...previous.roster, optionalIds: viewIds } } : previous)
        } catch (e) { setChatError(e instanceof Error ? e.message : "Could not update client chat access.") }
        finally { setChatPendingId(null) }
    }
    const inClientChat = (personId: string) => Boolean(chat?.roster?.memberIds.includes(personId))
    const clientChatFixed = (personId: string) => Boolean(chat?.roster && !chat.roster.optionalIds.includes(personId) && chat.roster.memberIds.includes(personId))
    if (!roster) return error ? <p role="alert" className="mt-4 text-sm text-red-300">{error} <button type="button" className="min-h-11 underline" onClick={() => setRetry(n => n + 1)}>Retry</button></p> : <p className="mt-4 text-sm text-neutral-400">Loading service team…</p>
    const additional = roster.people.filter(person => person.id !== roster.primaryId && !members.includes(person.id))
    return <div className="mt-4">
        <h3 className="text-sm font-medium text-neutral-300">Service team</h3>
        <p className="mt-1 text-sm text-neutral-400">Everyone here shares this service’s work queue and the internal client group chat, including its history.{chat?.canManage ? " Toggle In client chat to also add someone to the client-facing conversation." : ""}</p>
        <List ariaLabel="Service team" className="mt-3">
            <ListItem>
                <ListPrimaryRow><Assignee name={ownerName} userId={ownerId} /><RoundPill tone="sky" className="ml-auto">Owner</RoundPill></ListPrimaryRow>
                <ListSecondaryRow><span className="text-neutral-500">{ownerId && inClientChat(ownerId) ? "In client chat" : "Not in client chat"}</span></ListSecondaryRow>
            </ListItem>
            {members.filter(id => id !== roster.primaryId).map(id => {
                const person = roster.people.find(p => p.id === id)
                return <ListItem key={id}>
                    <ListPrimaryRow><Assignee name={person?.name ?? "Workspace member"} userId={id} /></ListPrimaryRow>
                    <ListSecondaryRow>
                        {chat?.canManage
                            ? <label className="flex min-h-11 items-center gap-2 text-xs text-neutral-400"><input type="checkbox" aria-label={`In client chat for ${person?.name ?? "this person"}`} checked={inClientChat(id)} disabled={clientChatFixed(id) || chatPendingId === id} onChange={event => void toggleClientChat(id, event.target.checked)} />In client chat</label>
                            : <span className="text-neutral-500">{inClientChat(id) ? "In client chat" : ""}</span>}
                        {allowChanges ? <button type="button" disabled={pending || Boolean(recovery) || Boolean(recoveryProblem)} className="ml-auto min-h-11 text-xs underline" onClick={() => { const next = members.filter(value => value !== id); setMembers(next); void save(next) }}>Remove</button> : null}
                    </ListSecondaryRow>
                </ListItem>
            })}
        </List>
        {recovery ? <button type="button" disabled={pending} className="mt-3 min-h-11 rounded-lg bg-white px-4 text-sm text-black disabled:opacity-50" onClick={() => void save(recovery.members)}>{pending ? "Saving…" : "Retry same change"}</button>
        : allowChanges && members.length < 19 ? <>
            <SelectorTrigger aria-label="Add to service team" open={Boolean(anchor)} disabled={pending || Boolean(recoveryProblem)} onClick={event => setAnchor(anchor ? null : event.currentTarget)} appearance="input" className="mt-3 h-auto min-h-11 py-2">
                <span className="text-neutral-400">Add person</span>
            </SelectorTrigger>
            {anchor ? <SelectorDrawer anchor={anchor} onDismiss={() => setAnchor(null)} ariaLabel="Add to service team" title="Add to service team" search={additional.length >= 7 ? query : undefined} onSearch={additional.length >= 7 ? setQuery : undefined}>
                {additional.filter(person => person.name.toLowerCase().includes(query.toLowerCase())).map(person => <SelectorOption key={person.id} selected={false} onClick={() => { const next = [...members, person.id]; setMembers(next); setAnchor(null); void save(next) }}><Assignee name={person.name} /></SelectorOption>)}
                {!additional.length ? <p className="p-3 text-sm text-neutral-500">No other eligible people.</p> : null}
            </SelectorDrawer> : null}
        </> : null}
        {!allowChanges && !recovery ? <p className="mt-2 text-sm text-neutral-400">This service is closed. Only a previously saved request can be recovered.</p> : null}
        {recoveryProblem ? <p role="alert" className="mt-2 text-sm text-red-300">{recoveryProblem} No new change can be sent until recovery is available.</p> : null}
        {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error} {!recovery && !pending ? <button type="button" className="min-h-11 underline" onClick={() => { setError(""); setRetry(n => n + 1) }}>Reload</button> : null}</p> : null}
        {chatError ? <p role="alert" className="mt-2 text-sm text-red-300">{chatError}</p> : null}
    </div>
}
