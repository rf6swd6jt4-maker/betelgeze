"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { AssignmentSelector, Button, Status } from "@/components/ui"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow } from "@/components/list/List"
import { reassignWorkspaceMemberItems, type OffboardWorkspaceMemberResult } from "@/app/[workspaceSlug]/users/actions"
import { eligibleForItems, eligiblePeople, footprintKindLabel, type FootprintItem, type FootprintKind, type MemberFootprint, type MemberFootprintResponse, type ReassignInput } from "@/lib/member-offboarding"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"

const GROUPS: Array<{ title: string; kinds: FootprintKind[] }> = [
    { title: "Clients managed", kinds: ["client_manager"] },
    { title: "Services", kinds: ["service_assignee", "legacy_service_assignee"] },
    { title: "Shared queues", kinds: ["queue_member"] },
    { title: "Open tasks", kinds: ["work_owner", "work_collaborator"] },
]

/** One person's assignments, grouped by kind, with bulk "Move to". Keeps the person's membership. */
export function StaffMemberAssignments({ workspaceSlug, currentUserId, initial }: { workspaceSlug: string; currentUserId: string; initial: MemberFootprint }) {
    const [footprint, setFootprint] = useState(initial)
    const [selected, setSelected] = useState<string[]>([])
    const [recipient, setRecipient] = useState("")
    const [reason, setReason] = useState("")
    const [error, setError] = useState("")
    const [notice, setNotice] = useState("")
    const [stale, setStale] = useState(false)
    const [uncertain, setUncertain] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [pending, startTransition] = useTransition()
    const request = useRef<ReassignInput | null>(null)
    const frozen = pending || uncertain || refreshing

    const selectedItems = useMemo(() => footprint.items.filter(item => selected.includes(item.key)), [footprint, selected])
    const people = useMemo(() => eligibleForItems(footprint, selectedItems), [footprint, selectedItems])
    const ready = selectedItems.length > 0 && people.includes(recipient) && reason.trim().length > 0

    async function refresh() {
        setRefreshing(true)
        try {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/members/${encodeURIComponent(footprint.targetId)}/footprint`, {
                cache: "no-store", redirect: "error", credentials: "same-origin", headers: { "x-workspace-user": currentUserId }, signal: AbortSignal.timeout(30_000),
            })
            const value = await response.json() as MemberFootprintResponse & { error?: string }
            if (!response.ok || !value.available) throw new Error(value.error ?? "Could not reload assignments.")
            setFootprint(value); setStale(false); setError("")
            setSelected(current => current.filter(key => value.items.some(item => item.key === key)))
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not reload assignments.")
        } finally { setRefreshing(false) }
    }

    function toggle(key: string, on: boolean) {
        if (frozen) return
        request.current = null
        setSelected(current => on ? [...current, key] : current.filter(value => value !== key))
        setNotice("")
    }

    function move() {
        if (pending || stale || refreshing || (!uncertain && !ready)) return
        request.current ??= {
            expectedUserId: currentUserId, requestId: crypto.randomUUID(), sourceId: footprint.targetId, reason: reason.trim(),
            plan: selectedItems.map(item => ({ key: item.key, fingerprint: item.fingerprint, recipientId: recipient })),
        }
        const input = request.current
        const recipientName = footprint.people[recipient] ?? "the new person"
        startTransition(async () => {
            let result: OffboardWorkspaceMemberResult
            try {
                result = await runWorkspaceMutation(() => reassignWorkspaceMemberItems(workspaceSlug, input), { category: "system" })
            } catch {
                result = { ok: false, uncertain: true, message: "The move could not be confirmed. Retry the same request to check whether it completed." }
            }
            if (result.ok) {
                request.current = null
                setUncertain(false); setError(""); setSelected([]); setRecipient(""); setReason("")
                setNotice(`Moved ${input.plan.length} assignment${input.plan.length === 1 ? "" : "s"} to ${recipientName}.`)
                await refresh()
                return
            }
            setError(result.message)
            setUncertain(result.uncertain)
            if (!result.uncertain) {
                request.current = null
                setStale(/Assignments changed/.test(result.message))
            }
        })
    }

    if (!footprint.items.length) return <div>
        {notice ? <p role="status" className="mb-3 text-sm text-emerald-200">{notice}</p> : null}
        <p className="text-sm text-neutral-400">Nothing is assigned to {footprint.targetName}.</p>
    </div>

    return <div className="space-y-6 pb-28">
        {notice ? <p role="status" className="text-sm text-emerald-200">{notice}</p> : null}
        {GROUPS.map(group => {
            const items = footprint.items.filter(item => group.kinds.includes(item.kind))
            if (!items.length) return null
            const all = items.every(item => selected.includes(item.key))
            return <section key={group.title} aria-labelledby={`staff-group-${group.kinds[0]}`}>
                <div className="mb-2 flex items-center gap-3">
                    <h2 id={`staff-group-${group.kinds[0]}`} className="text-sm font-semibold text-neutral-200">{group.title}</h2>
                    <span className="text-sm text-neutral-500">{items.length}</span>
                    <button type="button" disabled={frozen} onClick={() => { request.current = null; setNotice(""); setSelected(current => all ? current.filter(key => !items.some(item => item.key === key)) : [...new Set([...current, ...items.map(item => item.key)])]) }}
                        className="ml-auto min-h-11 text-sm text-neutral-400 underline disabled:opacity-40">{all ? "Clear" : "Select all"}</button>
                </div>
                <List ariaLabel={group.title}>{items.map(item => <AssignmentRow key={item.key} item={item} footprint={footprint} checked={selected.includes(item.key)} disabled={frozen} onToggle={toggle} />)}</List>
            </section>
        })}

        {selected.length || error ? <div role="region" aria-label="Move selected assignments" className="sticky bottom-3 z-10 rounded-xl border border-card-border bg-[var(--color-surface-glass)] p-3 shadow-card backdrop-blur-xl backdrop-saturate-150">
            <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-medium">{selected.length} selected</p>
                {selected.length ? people.length
                    ? <AssignmentSelector ariaLabel="Move to" title="Move to" placeholder="Move to…" value={recipient} disabled={frozen} appearance="compact"
                        people={people.map(id => ({ id, name: footprint.people[id] ?? "Workspace member" }))} onChange={value => { request.current = null; setRecipient(value); setError("") }} className="min-h-11 min-w-44" />
                    : <p className="text-sm text-neutral-400">Nobody is eligible for all of these. Select fewer.</p> : null}
                <input value={reason} disabled={frozen} maxLength={1000} onChange={event => { request.current = null; setReason(event.target.value) }} aria-label="Reason" placeholder="Reason, for example: covering while away"
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-neutral-700 bg-black px-3 text-base sm:text-sm" />
                <Button variant="ghost" disabled={frozen} onClick={() => { request.current = null; setSelected([]); setError(""); setStale(false) }}>Clear</Button>
                {stale ? <Button variant="secondary" disabled={refreshing} onClick={() => void refresh()}>Reload</Button> : null}
                <Button disabled={pending || stale || refreshing || (!uncertain && !ready)} onClick={move}>{pending ? "Moving…" : uncertain ? "Retry same request" : "Move"}</Button>
            </div>
            {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error}</p> : null}
        </div> : null}
    </div>
}

function AssignmentRow({ item, footprint, checked, disabled, onToggle }: { item: FootprintItem; footprint: MemberFootprint; checked: boolean; disabled: boolean; onToggle: (key: string, on: boolean) => void }) {
    const blocked = item.blockedReason ?? (eligiblePeople(footprint, item).length ? null : "Nobody else is eligible yet.")
    const title = item.kind === "client_manager" ? item.client ?? "Client" : item.title
    return <ListItem>
        <ListPrimaryRow>
            <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
                <input type="checkbox" checked={checked} disabled={disabled || !!blocked} onChange={event => onToggle(item.key, event.target.checked)} className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate text-base font-medium text-neutral-100">{title}</span>
            </label>
            {blocked ? <Status label="Can't move yet" tone="red" className="ml-auto" /> : null}
        </ListPrimaryRow>
        <ListSecondaryRow>
            <span className="truncate text-neutral-400">{blocked ?? [footprintKindLabel(item.kind), item.kind === "client_manager" ? null : item.client].filter(Boolean).join(" · ")}</span>
        </ListSecondaryRow>
    </ListItem>
}
