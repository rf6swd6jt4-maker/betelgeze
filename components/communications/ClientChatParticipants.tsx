"use client"
import { useState } from "react"
import { useRosterDialog } from "@/components/communications/useRosterDialog"
import { Assignee } from "@/components/ui"
import { List, ListItem } from "@/components/list/List"
import { DeliveryUserPicker } from "@/components/settings/DeliveryUserPicker"
import type { ClientConversation, CommunicationPerson } from "@/lib/communications/types"

export function ClientChatParticipants({ workspaceSlug, conversation, userId, people, onSaved }: { workspaceSlug: string; conversation: ClientConversation; userId: string; people: CommunicationPerson[]; onSaved: () => Promise<void> }) {
    const [open, setOpen] = useState(false)
    const [selected, setSelected] = useState(conversation.participants?.optionalIds ?? [])
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const roster = conversation.participants
    const canManage = roster?.managerId === userId
    const dialogRef = useRosterDialog(open, () => setOpen(false))
    async function save() {
        setPending(true); setError(null)
        try {
            const response = await fetch(`/api/workspaces/${workspaceSlug}/communications/participants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relationshipId: conversation.id, userIds: selected }) })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error ?? "Could not update participants.")
            await onSaved(); setOpen(false)
        } catch (error) { setError(error instanceof Error ? error.message : "Could not update participants.") }
        finally { setPending(false) }
    }
    if (!roster) return null
    return <>
        <button type="button" aria-label="Client conversation participants" title="Participants" onClick={() => { setSelected(roster.optionalIds); setError(null); setOpen(true) }} className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-neutral-400 hover:text-white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5"><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 21v-2a6 6 0 0 0-4-5" /></svg></button>
        {open ? <div role="dialog" aria-modal="true" aria-labelledby="client-participants-title" className="fixed inset-0 z-[180] flex items-center justify-center bg-black/75 p-4" onMouseDown={(e) => { if(e.target === e.currentTarget) setOpen(false) }}><section ref={dialogRef} className="betelgeze-popup-enter max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-950 p-4">
            <header className="flex items-center gap-3"><h2 id="client-participants-title" className="flex-1 text-lg font-semibold">Client conversation</h2><button type="button" onClick={() => setOpen(false)} aria-label="Close participants" className="h-9 w-9 text-xl text-neutral-500">×</button></header>
            <p className="mt-1 text-xs text-neutral-500">{conversation.title}</p>
            <List ariaLabel="Client chat participants" className="!mt-3"><ListItem className="px-3 py-2 text-sm">{conversation.title} <span className="text-xs text-neutral-500">· Client</span></ListItem>{people.filter((p) => roster.memberIds.includes(p.id)).map((p) => <ListItem key={p.id} className="px-3 py-2"><Assignee userId={p.id} name={p.name} avatarSrc={p.avatarSrc} /></ListItem>)}</List>
            {canManage && roster.eligibleIds.length ? <fieldset className="mt-4"><legend className="text-sm font-medium">Include fulfilment staff</legend><DeliveryUserPicker people={people.filter((p) => roster.eligibleIds.includes(p.id))} selected={selected} onChange={setSelected} disabled={pending} /><p className="mt-2 text-xs text-neutral-500">Included staff can read this conversation’s history and message the client. Delivery assignments stay the same.</p></fieldset> : null}
            {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
            {canManage && roster.eligibleIds.length ? <div className="mt-4 flex justify-end"><button disabled={pending} onClick={() => void save()} className="h-9 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-40">{pending ? "Saving…" : "Save participants"}</button></div> : null}
        </section></div> : null}
    </>
}
