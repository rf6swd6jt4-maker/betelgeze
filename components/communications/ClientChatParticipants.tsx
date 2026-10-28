"use client"
import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { useRosterDialog } from "@/components/communications/useRosterDialog"
import { Assignee } from "@/components/ui"
import { List, ListItem } from "@/components/list/List"
import type { ClientConversation, CommunicationPerson } from "@/lib/communications/types"

export function ClientChatParticipants({ active = true, workspaceSlug, conversation, userId, people, onSaved }: { active?: boolean; workspaceSlug: string; conversation: ClientConversation; userId: string; people: CommunicationPerson[]; onSaved: () => Promise<void> }) {
    const [open, setOpen] = useState(false)
    const [selected, setSelected] = useState(conversation.participants?.optionalIds ?? [])
    const [editIds, setEditIds] = useState((conversation.participants?.memberIds ?? []).filter(id => !(conversation.participants?.viewOnlyIds ?? []).includes(id)))
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const dialogSession = useRef(0)
    const roster = conversation.participants
    const canManage = roster?.managerId === userId
    const fixedIds = new Set(roster?.memberIds.filter(id => !roster.optionalIds.includes(id)))
    const personById = new Map(people.map(person => [person.id, person]))
    const listedIds = active && open ? [...new Set([...(roster?.memberIds ?? []), ...(roster?.eligibleIds ?? [])])] : []
    const close = useCallback(() => { dialogSession.current++; setOpen(false) }, [])
    const dialogRef = useRosterDialog(active && open, close)
    useLayoutEffect(() => {
        if (!active) return
        // A retained chat can become inactive without unmounting its header.
        // Its previous roster must not reappear when that chat resumes.
        return close
    }, [active, close, conversation.id])
    async function save() {
        if (pending || !canManage) return
        const session = dialogSession.current
        setPending(true); setError(null)
        try {
            const editingIds = new Set(editIds)
            const viewOnlyIds = selected.filter(id => !editingIds.has(id))
            const response = await fetch(`/api/workspaces/${workspaceSlug}/communications/participants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relationshipId: conversation.id, viewIds: selected, ...(viewOnlyIds.length ? { viewOnlyIds } : {}) }), signal: AbortSignal.timeout(30_000) })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error ?? "Could not update participants.")
            await onSaved()
            if (dialogSession.current === session) close()
        } catch (error) {
            if (dialogSession.current === session) setError(error instanceof Error ? error.message : "Could not update participants.")
        }
        finally { setPending(false) }
    }
    // An older retained snapshot has no Edit metadata. Let the existing sync
    // replace it before exposing a permission form that could save stale flags.
    if (!roster || !Array.isArray(roster.viewOnlyIds)) return null
    return <>
        <button type="button" aria-label="Client conversation participants" title="Participants" onClick={() => { dialogSession.current++; setSelected(roster.optionalIds); setEditIds(roster.memberIds.filter(id => !roster.viewOnlyIds.includes(id))); setError(null); setOpen(true) }} className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-neutral-400 hover:text-white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5"><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 21v-2a6 6 0 0 0-4-5" /></svg></button>
        {active && open ? <div role="dialog" aria-modal="true" aria-labelledby="client-participants-title" className="fixed inset-0 z-[180] flex items-center justify-center bg-black/75 p-4" onMouseDown={(e) => { if(e.target === e.currentTarget) close() }}><section ref={dialogRef} className="betelgeze-popup-enter max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-950 p-4">
            <header className="flex items-center gap-3"><h2 id="client-participants-title" className="flex-1 text-lg font-semibold">Client conversation</h2><button type="button" onClick={close} aria-label="Close participants" className="h-9 w-9 text-xl text-neutral-500">×</button></header>
            <p className="mt-1 text-xs text-neutral-500">{conversation.title}</p>
            <div className="mt-3 flex justify-end px-3 text-xs text-neutral-400" aria-hidden="true"><span className="w-11 text-center">View</span><span className="w-11 text-center">Edit</span></div>
            <List ariaLabel="Client chat participants" className="!mt-1">
                <ListItem className="px-3 py-2 text-sm">{conversation.title} <span className="text-xs text-neutral-500">· Client</span></ListItem>
                {listedIds.map(id => {
                    const person = personById.get(id)
                    const name = person?.name ?? "Team member"
                    const fixed = fixedIds.has(id)
                    const view = fixed || selected.includes(id)
                    const edit = fixed || view && editIds.includes(id)
                    return <ListItem key={id} className="flex items-center gap-2 px-3 py-1">
                        <div className="min-w-0 flex-1"><Assignee userId={id} name={name} avatarSrc={person?.avatarSrc} /></div>
                        <div className="flex shrink-0">
                            <label className="flex h-11 w-11 items-center justify-center"><input type="checkbox" aria-label={`View access for ${name}`} checked={view} disabled={fixed || !canManage || pending} className="h-4 w-4 accent-white disabled:opacity-50" onChange={event => { const checked = event.target.checked; setSelected(ids => checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id)); if (!checked) setEditIds(ids => ids.filter(value => value !== id)) }} /></label>
                            <label className="flex h-11 w-11 items-center justify-center"><input type="checkbox" aria-label={`Edit access for ${name}`} checked={edit} disabled={fixed || !canManage || pending} className="h-4 w-4 accent-white disabled:opacity-50" onChange={event => { const checked = event.target.checked; setEditIds(ids => checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id)); if (checked) setSelected(ids => [...new Set([...ids, id])]) }} /></label>
                        </div>
                    </ListItem>
                })}
            </List>
            <p className="mt-2 text-xs text-neutral-500">View allows reading this chat. Edit also allows messages and reactions. The seller and assigned manager always have both.</p>
            {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
            {canManage && listedIds.some(id => !fixedIds.has(id)) ? <div className="mt-4 flex justify-end"><button disabled={pending} onClick={() => void save()} className="h-9 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-40">{pending ? "Saving…" : "Save participants"}</button></div> : null}
        </section></div> : null}
    </>
}
