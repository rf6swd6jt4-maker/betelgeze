"use client"

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react"
import { AssignmentSelector, Button, CenteredDialog, Status } from "@/components/ui"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow } from "@/components/list/List"
import { RemoveWorkspaceUserForm } from "@/components/admin/RemoveWorkspaceUserForm"
import { offboardWorkspaceMember, type OffboardWorkspaceMemberResult } from "@/app/[workspaceSlug]/users/actions"
import { blockedItems, buildOffboardPlan, eligibleForEverything, eligiblePeople, footprintKindLabel, isWorkItem,
    type MemberFootprint, type MemberFootprintResponse, type OffboardInput } from "@/lib/member-offboarding"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"

type LegacyResult = { ok: boolean; message: string }

function plural(count: number, one: string, many = `${one}s`) { return `${count} ${count === 1 ? one : many}` }

function summary(footprint: MemberFootprint) {
    const count = (kinds: string[]) => footprint.items.filter(item => kinds.includes(item.kind)).length
    const parts = [
        [count(["client_manager"]), "client they manage", "clients they manage"],
        [count(["service_assignee", "legacy_service_assignee"]), "service"],
        [count(["queue_member"]), "shared queue"],
        [count(["work_owner", "work_collaborator"]), "open task"],
    ].filter(([value]) => (value as number) > 0).map(([value, one, many]) => plural(value as number, one as string, many as string | undefined))
    return parts.length ? new Intl.ListFormat("en", { type: "conjunction" }).format(parts) : "nothing"
}

/** Settings > Users "Remove": moves everything the person holds to others, then removes them, in one transaction. */
export function RemoveWorkspaceUser({ workspaceSlug, currentUserId, userId, email, legacyAction }: {
    workspaceSlug: string; currentUserId: string; userId: string; email: string
    legacyAction: (previous: LegacyResult | null, formData: FormData) => Promise<LegacyResult>
}) {
    const [open, setOpen] = useState(false)
    return <>
        <button type="button" onClick={() => setOpen(true)} className="w-full rounded-lg border border-red-900 px-3 py-1 text-sm text-red-300 sm:w-auto">Remove</button>
        {open ? <RemoveWorkspaceUserDialog workspaceSlug={workspaceSlug} currentUserId={currentUserId} userId={userId} email={email} legacyAction={legacyAction} onClose={() => setOpen(false)} /> : null}
    </>
}

function RemoveWorkspaceUserDialog({ workspaceSlug, currentUserId, userId, email, legacyAction, onClose }: {
    workspaceSlug: string; currentUserId: string; userId: string; email: string
    legacyAction: (previous: LegacyResult | null, formData: FormData) => Promise<LegacyResult>; onClose: () => void
}) {
    const [footprint, setFootprint] = useState<MemberFootprintResponse | null>(null)
    const [loadError, setLoadError] = useState("")
    const [reload, setReload] = useState(0)
    const [everythingTo, setEverythingTo] = useState("")
    const [overrides, setOverrides] = useState<Record<string, string>>({})
    const [perItem, setPerItem] = useState(false)
    const [leaveOpenWork, setLeaveOpenWork] = useState(false)
    const [reason, setReason] = useState("")
    const [error, setError] = useState("")
    const [stale, setStale] = useState(false)
    const [uncertain, setUncertain] = useState(false)
    const [saved, setSaved] = useState(false)
    const [pending, startTransition] = useTransition()
    const request = useRef<OffboardInput | null>(null)
    const frozen = pending || uncertain || saved

    useEffect(() => {
        const controller = new AbortController()
        fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/members/${encodeURIComponent(userId)}/footprint`, {
            cache: "no-store", redirect: "error", credentials: "same-origin", headers: { "x-workspace-user": currentUserId },
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
        }).then(async response => {
            const value = await response.json()
            if (!response.ok) throw new Error(value.error ?? "Could not load this person's assignments.")
            return value as MemberFootprintResponse
        }).then(value => {
            if (controller.signal.aborted) return
            setFootprint(value); setLoadError("")
        }).catch(cause => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : "Could not load this person's assignments.") })
        return () => controller.abort()
    }, [workspaceSlug, userId, currentUserId, reload])

    const loaded = footprint?.available ? footprint : null
    const everyone = useMemo(() => loaded ? eligibleForEverything(loaded, leaveOpenWork) : [], [loaded, leaveOpenWork])
    const blocked = useMemo(() => loaded ? blockedItems(loaded, leaveOpenWork) : [], [loaded, leaveOpenWork])
    const built = useMemo(() => loaded ? buildOffboardPlan(loaded, everythingTo, overrides, leaveOpenWork) : { plan: [], missing: [] }, [loaded, everythingTo, overrides, leaveOpenWork])
    const openTasks = loaded?.items.filter(isWorkItem).length ?? 0
    const name = loaded?.targetName || email
    const showPerItem = perItem || (loaded ? loaded.items.length > 0 && everyone.length === 0 : false)
    const ready = !!loaded && built.missing.length === 0 && blocked.length === 0 && reason.trim().length > 0

    function refresh() {
        request.current = null
        setFootprint(null); setStale(false); setError(""); setOverrides({}); setEverythingTo(""); setReload(value => value + 1)
    }

    function submit(event: FormEvent) {
        event.preventDefault()
        if (!loaded || pending || saved || stale || (!uncertain && !ready)) return
        request.current ??= {
            expectedUserId: currentUserId, requestId: crypto.randomUUID(), targetId: userId, footprintFingerprint: loaded.fingerprint,
            leaveOpenWork, reason: reason.trim(), plan: built.plan,
        }
        const input = request.current
        startTransition(async () => {
            let result: OffboardWorkspaceMemberResult
            try {
                result = await runWorkspaceMutation(() => offboardWorkspaceMember(workspaceSlug, input), { category: "system" })
            } catch {
                result = { ok: false, uncertain: true, message: "The removal could not be confirmed. Retry the same request to check whether it completed." }
            }
            if (result.ok) { setSaved(true); setUncertain(false); setError(""); return }
            setError(result.message)
            setUncertain(result.uncertain)
            if (!result.uncertain) {
                request.current = null
                setStale(/Assignments changed|assigned to this person while saving/.test(result.message))
            }
        })
    }

    if (footprint && !footprint.available) {
        return <CenteredDialog title={`Remove ${email}`} onClose={onClose}>
            <p className="text-sm leading-6 text-neutral-300">Moving someone&apos;s work to others is not switched on yet. You can remove a person who has nothing assigned; otherwise Betelgeze explains what still needs handing over.</p>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3"><Button variant="ghost" onClick={onClose}>Cancel</Button><RemoveWorkspaceUserForm userId={userId} email={email} action={legacyAction} /></div>
        </CenteredDialog>
    }

    const footer = saved ? <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div> : <div className="flex flex-wrap items-center justify-end gap-3">
        <Button variant="ghost" disabled={frozen} onClick={onClose}>Cancel</Button>
        {stale ? <Button variant="secondary" disabled={pending} onClick={refresh}>Reload assignments</Button> : null}
        <Button type="submit" form={`remove-${userId}`} variant="destructive" disabled={pending || stale || (!uncertain && !ready)}>
            {pending ? "Moving and removing…" : uncertain ? "Retry same request" : loaded && loaded.items.length === 0 ? "Remove" : "Reassign and remove"}
        </Button>
    </div>

    return <CenteredDialog title={`Reassign and remove ${name}`} busy={pending || uncertain} onClose={onClose} footer={loaded ? footer : undefined} wide={showPerItem}>
        {saved ? <p role="status" className="text-sm leading-6">{name} was removed. Their assignments now belong to the people you chose{leaveOpenWork && openTasks ? ", and their open tasks are unassigned" : ""}.</p>
        : !footprint ? <div className="text-sm text-neutral-400">{loadError ? <><p role="alert" className="text-red-300">{loadError}</p><Button className="mt-3" variant="secondary" onClick={() => setReload(value => value + 1)}>Try again</Button></> : <p role="status">Loading assignments…</p>}</div>
        : loaded ? <form id={`remove-${userId}`} onSubmit={submit} data-workspace-mutation="background" className="space-y-4">
            <p className="text-sm leading-6 text-neutral-300">{loaded.items.length ? <>{name} has {summary(loaded)}. Everything moves in one step; if anything fails, nothing changes and {name} stays a member.</> : <>Nothing is assigned to {name}.</>}</p>
            {loaded.history.sellerClients ? <p className="text-sm text-neutral-400">They stay recorded as the seller on {plural(loaded.history.sellerClients, "client")}.</p> : null}

            {blocked.length ? <div role="alert" className="space-y-2 rounded-xl border border-red-900/60 p-3">
                <Status tone="red" label="Can't move yet" />
                <List ariaLabel="Assignments that cannot move yet" embedded>{blocked.map(item => <ListItem key={item.key}>
                    <ListPrimaryRow><span className="text-sm">{item.title}{item.client ? ` · ${item.client}` : ""}</span></ListPrimaryRow>
                    <ListSecondaryRow><span className="text-red-200">{item.blockedReason ?? "Nobody else is eligible. Give someone eligibility in Settings › Services or Teams first."}</span></ListSecondaryRow>
                </ListItem>)}</List>
            </div> : null}

            {loaded.items.length ? <>
                <div className="space-y-2">
                    <p className="text-sm font-medium">Give everything to</p>
                    {everyone.length ? <AssignmentSelector ariaLabel="Give everything to" title="Give everything to" placeholder="Choose person" value={everythingTo} disabled={frozen}
                        people={everyone.map(id => ({ id, name: loaded.people[id] ?? "Workspace member" }))} onChange={value => { setEverythingTo(value); setError("") }} className="min-h-11 w-full" />
                        : <p className="text-sm text-neutral-400">No one can take all of it. Choose someone for each assignment below.</p>}
                </div>
                {everyone.length ? <button type="button" aria-expanded={showPerItem} disabled={frozen} onClick={() => setPerItem(value => !value)} className="min-h-11 text-sm text-neutral-300 underline">
                    {showPerItem ? "Hide individual assignments" : `Choose per assignment (${loaded.items.length})`}</button> : null}
                {showPerItem ? <List ariaLabel="Assignments to move" className="max-h-80 !overflow-y-auto">{loaded.items.map(item => {
                    const people = eligiblePeople(loaded, item)
                    const leaving = leaveOpenWork && isWorkItem(item) && !overrides[item.key]
                    return <ListItem key={item.key}>
                        <ListPrimaryRow><span className="min-w-0 text-sm">{item.title}{item.client ? ` · ${item.client}` : ""}</span></ListPrimaryRow>
                        <ListSecondaryRow><span className="text-neutral-400">{footprintKindLabel(item.kind)}</span>
                            {people.length && !item.blockedReason ? <AssignmentSelector ariaLabel={`Who takes ${item.title}`} title={`Who takes ${item.title}`} placeholder={leaving ? "Leave unassigned" : "Choose person"}
                                appearance="compact" disabled={frozen} value={overrides[item.key] || (leaving ? "" : everythingTo)}
                                clearLabel={isWorkItem(item) && leaveOpenWork ? "Leave unassigned" : undefined}
                                people={people.map(id => ({ id, name: loaded.people[id] ?? "Workspace member" }))}
                                onChange={value => setOverrides(current => ({ ...current, [item.key]: value }))} className="min-h-11 min-w-40" /> : null}
                        </ListSecondaryRow>
                    </ListItem>
                })}</List> : null}
                {openTasks ? <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" disabled={frozen} checked={leaveOpenWork} onChange={event => setLeaveOpenWork(event.target.checked)} />
                    Leave {plural(openTasks, "open task")} unassigned instead</label> : null}
                {built.missing.length && !blocked.length ? <p className="text-sm text-neutral-400">{plural(built.missing.length, "assignment")} still {built.missing.length === 1 ? "needs" : "need"} someone.</p> : null}
            </> : null}

            <label className="block text-sm">Reason<textarea required maxLength={1000} disabled={frozen} value={reason} onChange={event => setReason(event.target.value)} placeholder="For example: left the agency"
                className="mt-2 min-h-20 w-full rounded-lg border border-neutral-700 bg-black p-3 text-base" /></label>
            {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
        </form> : null}
    </CenteredDialog>
}
