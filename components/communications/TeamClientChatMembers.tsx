"use client"

import { useEffect, useRef, useState } from "react"
import { DeliveryUserPicker } from "@/components/settings/DeliveryUserPicker"
import type { CommunicationPerson } from "@/lib/communications/types"

type Roster = { relationshipId: string; title: string; memberIds: string[]; eligibleIds: string[] }

/** Optional Team-roster action: no work until requested, and additions only. */
export function TeamClientChatMembers({ workspaceSlug, teamId, people }: { workspaceSlug: string; teamId: string; people: CommunicationPerson[] }) {
    const [roster, setRoster] = useState<Roster | null>(null)
    const [selected, setSelected] = useState<string[]>([])
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)
    const requestRef = useRef<AbortController | null>(null)
    useEffect(() => () => { requestRef.current?.abort() }, [])
    const endpoint = `/api/workspaces/${workspaceSlug}/communications/participants`

    async function request(add: boolean) {
        if (requestRef.current) return
        const controller = new AbortController()
        requestRef.current = controller
        setPending(true); setError(null); setSaved(false)
        const timeout = setTimeout(() => controller.abort(new Error("Request timed out. Try again.")), 30_000)
        try {
            const response = await fetch(add ? endpoint : `${endpoint}?teamId=${encodeURIComponent(teamId)}`, {
                method: add ? "POST" : "GET", cache: "no-store", signal: controller.signal,
                ...(add ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "addFromTeam", teamId, userIds: selected }) } : {}),
            })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error ?? "Could not load Client chat participants.")
            if (controller.signal.aborted) return
            setRoster(result); setSelected([]); setSaved(add)
        } catch (cause) {
            // Closing/switching the roster retires this request. A timed-out
            // write can safely be retried: the server only adds missing members.
            if (!controller.signal.aborted || controller.signal.reason instanceof Error && controller.signal.reason.name !== "AbortError") {
                setError(add ? `${cause instanceof Error ? cause.message : "Could not confirm the change."} Retry to confirm access; existing participants will be kept.` : cause instanceof Error ? cause.message : "Could not load Client chat participants.")
            }
        } finally {
            clearTimeout(timeout)
            if (requestRef.current === controller) { requestRef.current = null; setPending(false) }
        }
    }

    const remainingIds = roster?.eligibleIds.filter(id => !roster.memberIds.includes(id)) ?? []
    const candidates = people.filter(person => remainingIds.includes(person.id))
    const missingPeople = remainingIds.length > candidates.length
    return <section className="mt-4 border-t border-neutral-800 pt-4" aria-label="Add team members to Client chat">
        {!roster ? <>
            <button type="button" disabled={pending} onClick={() => void request(false)} className="min-h-10 rounded-lg border border-neutral-700 px-3 text-sm font-medium text-white disabled:opacity-40">{pending ? "Loading participants…" : "Add to Client chat"}</button>
            <p className="mt-2 text-xs leading-5 text-neutral-500">The client’s assigned manager can give team members access to Client chat.</p>
        </> : <>
            <h3 className="text-sm font-medium">Add to Client chat</h3>
            <p className="mt-1 text-xs leading-5 text-neutral-500">Selected people can read {roster.title}’s Client chat history and message the client. They stay in this Team chat.</p>
            {candidates.length ? <>
                <DeliveryUserPicker ariaLabel="Team members to add to Client chat" people={candidates} selected={selected} onChange={setSelected} disabled={pending} />
                <button type="button" disabled={pending || !selected.length} onClick={() => void request(true)} className="mt-3 min-h-10 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-40">{pending ? "Adding…" : "Add selected members"}</button>
            </> : !missingPeople ? <p className="mt-3 text-sm text-neutral-400">All eligible team members are already in Client chat.</p> : null}
            {missingPeople ? <p className="mt-3 text-xs text-neutral-400">The team has changed. Refresh Communications to load the remaining people before adding them.</p> : null}
        </>}
        {saved ? <p role="status" className="mt-3 text-sm text-neutral-300">Selected members now have access to Client chat.</p> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
    </section>
}
