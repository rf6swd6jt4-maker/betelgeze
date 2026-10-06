"use client"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react"
import { Assignee, AssignmentSelector, CenteredDialog } from "@/components/ui"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow } from "@/components/list/List"
import { transferRelationshipService } from "@/app/[workspaceSlug]/relationships/service-actions"
import { defaultTransferWork, recoverServiceTransfer, type ServiceTransferPreview } from "@/lib/service-assignee-transfer"
import type { RelationshipServiceRow } from "@/lib/service-stages"
import { createWorkspaceDraftJournal } from "@/lib/workspace-draft-journal"
import { registerWorkspaceAutosaveFlusher, runWorkspaceMutation } from "@/lib/workspace-mutations"
import styles from "./ServiceTransferDialog.module.css"

async function read<T>(url: string, userId: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(url, { cache: "no-store", redirect: "error", credentials: "same-origin", headers: { "x-workspace-user": userId }, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error ?? "Could not load this transfer.")
    return value
}
function TransferPortrait({ memberId, name, workspaceSlug, userId, recoveryOnly }: { memberId: string | null; name: string; workspaceSlug: string; userId: string; recoveryOnly: boolean }) {
    const [avatarSrc, setAvatarSrc] = useState<string | null>(null)
    useEffect(() => {
        if (!memberId || recoveryOnly) return
        const controller = new AbortController()
        void read<{ avatarSrc: string | null }>(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/members/${encodeURIComponent(memberId)}/profile?view=avatar`, userId, controller.signal)
            .then(value => { if (!controller.signal.aborted) setAvatarSrc(value.avatarSrc) })
            .catch(() => { /* A missing portrait never blocks choosing or reviewing a transfer. */ })
        return () => controller.abort()
    }, [memberId, workspaceSlug, userId, recoveryOnly])
    return <Assignee name={name} avatarSrc={avatarSrc} compact compactSize="lg" />
}
export function ServiceTransferDialog({ row, endpoint, workspaceSlug, relationshipId, userId, recoveryOnly = false, onClose, onDone }: {
    row: RelationshipServiceRow; endpoint: string; workspaceSlug: string; relationshipId: string; userId: string;
    recoveryOnly?: boolean; onClose: () => void; onDone: () => void;
}) {
    const [people, setPeople] = useState<Array<{ id: string; name: string }> | null>(null)
    const [recipient, setRecipient] = useState("")
    const [reviewing, setReviewing] = useState(false)
    const reviewHeading = useRef<HTMLParagraphElement>(null)
    useEffect(() => { if (reviewing) reviewHeading.current?.focus({ preventScroll: true }) }, [reviewing])
    const [preview, setPreview] = useState<ServiceTransferPreview | null>(null)
    const [workIds, setWorkIds] = useState<string[]>([])
    const [reason, setReason] = useState("")
    const [acknowledged, setAcknowledged] = useState(false)
    const [error, setError] = useState("")
    const [retry, setRetry] = useState(0)
    const [pending, startTransition] = useTransition()
    const [uncertain, setUncertain] = useState(false)
    const [saved, setSaved] = useState(false)
    const request = useRef<Parameters<typeof transferRelationshipService>[2] | null>(null)
    const journal = useMemo(() => createWorkspaceDraftJournal({ userId, workspaceSlug, recordType: "service-transfer", recordId: row.id, field: "request" }, { maximum: 200_000 }), [row.id, userId, workspaceSlug])
    const checkpointValue = useRef("")
    const recoveryAvailable = useSyncExternalStore(journal.subscribe, journal.hasRecovery, () => false)
    const [accountChanged, setAccountChanged] = useState(false)
    const [recoveries, setRecoveries] = useState<Array<{ id: string; input: NonNullable<typeof request.current>; preview: ServiceTransferPreview }>>([])
    const checkpoint = useCallback(() => !checkpointValue.current || journal.checkpoint({ value: checkpointValue.current, baseline: "", version: "1" }), [journal])
    useLayoutEffect(() => {
        journal.start()
        const beforeUnload = (event: BeforeUnloadEvent) => { if (!checkpoint()) { event.preventDefault(); event.returnValue = "" } }
        const unregister = registerWorkspaceAutosaveFlusher(async () => checkpoint(), { checkpoint })
        const accountClearing = (event: Event) => {
            if ((event as CustomEvent<{ preservedUserId?: string }>).detail?.preservedUserId === userId) return
            checkpoint(); journal.stop(); setAccountChanged(true)
        }
        window.addEventListener("betelgeze:offline-account-clearing", accountClearing)
        window.addEventListener("beforeunload", beforeUnload)
        window.addEventListener("pagehide", checkpoint)
        return () => { checkpoint(); journal.stop(); unregister(); window.removeEventListener("betelgeze:offline-account-clearing", accountClearing); window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("pagehide", checkpoint) }
    }, [checkpoint, journal, userId])
    useEffect(() => { journal.inspectRecovery() }, [journal])
    async function reviewRecovery() {
        const result = await journal.review()
        const records: typeof recoveries = []
        for (const draft of result.drafts) {
            const value = recoverServiceTransfer(draft.value, userId, row.id)
            if (value) records.push({ id: draft.id, ...value })
        }
        setRecoveries(records)
        setError(result.error ?? (records.length ? "" : "No recoverable transfer requests were found."))
    }
    function recover(record: typeof recoveries[number]) {
        request.current = record.input
        checkpointValue.current = JSON.stringify({ input: record.input, preview: record.preview })
        setRecipient(record.input.recipientId); setReason(record.input.reason); setWorkIds(record.input.workIds)
        setPreview(record.preview); setAcknowledged(true); setUncertain(true); setRecoveries([]); setReviewing(true)
        setError("A previous save may have completed. Retry this same transfer to recover its receipt.")
    }
    function acknowledgeRequest() {
        checkpointValue.current = ""
        journal.acknowledge({ value: "", baseline: "", version: "1" })
    }
    const frozen = pending || uncertain || saved
    useEffect(() => {
        if (recoveryOnly) return
        const controller = new AbortController()
        void read<Array<{ id: string; name: string }>>(`${endpoint}?kind=assignees&service=${row.service_id}`, userId, controller.signal)
            .then(value => { if (!controller.signal.aborted) setPeople(value.filter(person => person.id !== row.assignee_user_id)) })
            .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
        return () => controller.abort()
    }, [endpoint, row.assignee_user_id, row.service_id, userId, retry, recoveryOnly])
    useEffect(() => {
        if (!recipient || frozen || recoveryOnly) return
        const controller = new AbortController()
        void read<ServiceTransferPreview>(`${endpoint}?kind=transfer&id=${row.id}&recipient=${recipient}`, userId, controller.signal)
            .then(value => { if (!controller.signal.aborted) { setPreview(value); setWorkIds(defaultTransferWork(value)); setError("") } })
            .catch(cause => { if (!controller.signal.aborted) setError(cause.message) })
        return () => controller.abort()
        // A pending mutation keeps its exact preview and payload for recovery.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endpoint, recipient, row.id, userId, retry, recoveryOnly])
    function reloadPreview() { setPreview(null); setAcknowledged(false); setError(""); request.current = null; setRetry(value => value + 1) }
    function submit(event: FormEvent) {
        event.preventDefault()
        if (!reviewing || !journal.active() || accountChanged || pending || saved || !preview || !reason.trim() || !acknowledged || !preview.bookingEnabled || recoveryOnly && !request.current) return
        request.current ??= { expectedUserId: userId, requestId: crypto.randomUUID(), instanceId: row.id, recipientId: recipient, fingerprint: preview.fingerprint, workIds: [...workIds].sort(), reason }
        checkpointValue.current = JSON.stringify({ input: request.current, preview })
        if (!recoverServiceTransfer(checkpointValue.current, userId, row.id)) {
            request.current = null; checkpointValue.current = ""
            setError("This preview cannot be safely recovered on this device. Reload the preview before transferring."); return
        }
        if (!checkpoint()) { request.current = null; checkpointValue.current = ""; setError(`No transfer was sent. ${journal.error() ?? "Device recovery is unavailable."}`); return }
        startTransition(async () => {
            try {
                const result = await runWorkspaceMutation(() => transferRelationshipService(workspaceSlug, relationshipId, request.current!), { category: "services" })
                if (!journal.active()) return
                if (result.ok) { acknowledgeRequest(); setUncertain(false); setSaved(true); setError(""); return }
                setError(result.error ?? "Could not save the transfer.")
                setUncertain(result.uncertain === true)
                if (!result.uncertain) { acknowledgeRequest(); request.current = null; setPreview(null); setAcknowledged(false) }
            } catch { setUncertain(true); setError("The transfer could not be confirmed. Retry the same transfer to recover its receipt.") }
        })
    }
    if (accountChanged) return <CenteredDialog title="Account changed" onClose={onClose}><p className="text-sm">This transfer belongs to the previous account. Sign back in to recover its saved request.</p></CenteredDialog>
    const openItems = preview?.items.filter(item => !["done", "canceled"].includes(item.status)) ?? []
    const retained = openItems.filter(item => !workIds.includes(item.id)).length
    const formerName = preview?.formerName || row.assignee_name || "Unassigned"
    const formerId = preview?.formerId ?? row.assignee_user_id
    const recipientName = people?.find(person => person.id === recipient)?.name || preview?.recipientName || "New assignee"
    return <CenteredDialog title={recoveryOnly ? `Saved transfers: ${row.name}` : `Transfer ${row.name}`} busy={pending || uncertain} onClose={saved ? onDone : onClose}>
        {saved ? <div><p role="status" className="text-sm leading-6">Transfer saved. The selected work and recipient access passed the save checks.</p><button className="mt-4 min-h-11 rounded-lg bg-white px-4 text-sm text-black" onClick={onDone}>Done — refresh service</button></div> : <form onSubmit={submit}>
            {recoveryOnly ? <p className="mb-3 text-sm leading-6 text-neutral-300">This service no longer accepts a new transfer. Review a saved request to check whether it completed. Its original details stay unchanged when you retry.</p> : null}
            {recoveryAvailable && !frozen ? <div className="mb-3 text-sm"><button type="button" className="min-h-11 underline" onClick={() => void reviewRecovery()}>Review saved transfer requests</button>{recoveries.length ? <List ariaLabel="Saved transfer requests">{recoveries.map(record => <ListItem key={record.id}><ListPrimaryRow><button type="button" className="min-h-11 text-left" onClick={() => recover(record)}>Recover transfer: {record.input.reason}</button></ListPrimaryRow><ListSecondaryRow>{record.input.workIds.length} selected work items. Recovery requires an explicit retry.</ListSecondaryRow></ListItem>)}</List> : null}</div> : null}
            {recoveryOnly && !recoveryAvailable ? <p className="text-sm text-neutral-400">No saved transfer requests were found on this device.</p> : null}
            {!recoveryOnly || preview ? <>
            <p ref={reviewHeading} tabIndex={-1} className="text-center text-sm leading-6 text-neutral-400 outline-none">{reviewing ? "Review the work and access before transferring." : "Choose who will take over this service."}</p>
            <div className="grid grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)] items-start gap-x-2 gap-y-3 py-6 sm:gap-x-4" aria-label="Service assignee handoff">
                <p className="text-center text-xs text-neutral-400">Current assignee</p><span /><p className="text-center text-xs text-neutral-400">New assignee</p>
                <div className="flex justify-center"><TransferPortrait key={`${userId}:${formerId}`} memberId={formerId} name={formerName} workspaceSlug={workspaceSlug} userId={userId} recoveryOnly={recoveryOnly} /></div>
                <svg key={recipient || "empty"} aria-hidden="true" viewBox="0 0 32 32" fill="none" className={`h-8 w-8 self-center ${recipient ? `text-white ${styles.arrow}` : "text-neutral-600"}`}><path d="M5 16h22m-8-8 8 8-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <div className="flex justify-center"><TransferPortrait key={`${userId}:${recipient}`} memberId={recipient || null} name={recipientName} workspaceSlug={workspaceSlug} userId={userId} recoveryOnly={recoveryOnly} /></div>
                <p className="flex min-h-11 min-w-0 items-center justify-center text-center text-sm font-medium break-words" title={formerName}>{formerName}</p><span />
                <AssignmentSelector ariaLabel="New service assignee" title="Choose new assignee" placeholder="Choose person" value={recipient} people={preview && frozen ? [{ id: preview.recipientId, name: preview.recipientName }] : people ?? []} disabled={frozen || !people} appearance="compact" triggerContent={<span className="block text-center whitespace-normal break-words">{recipient ? recipientName : "Choose person"}</span>} className="min-h-11 w-full min-w-0" onChange={value => { setRecipient(value); setReviewing(false); setPreview(null); setWorkIds([]); setAcknowledged(false); setError(""); request.current = null }} />
            </div>
            </> : null}
            {!recoveryOnly && (!people ? <p className="text-sm text-neutral-400">Loading eligible people…</p> : !people.length ? <p className="text-sm text-neutral-400">No other eligible people. Add service eligibility in Settings first.</p> : null)}
            {reviewing && recipient && !preview && !error ? <p role="status" className="py-3 text-sm text-neutral-400">Checking work and access…</p> : null}
            {reviewing && preview ? <>
                <p className="mt-3 text-sm text-neutral-300">{workIds.length} open work item{workIds.length === 1 ? "" : "s"} will move. {retained} will keep their explicit ownership.</p>
                <List ariaLabel="Work included in transfer" className="max-h-72 !overflow-y-auto">{openItems.map(item => <ListItem key={item.id}>
                    <ListPrimaryRow><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" disabled={frozen || !item.movable || !item.execution_owner_id && item.assignees.length === 0} checked={workIds.includes(item.id)} onChange={event => { setWorkIds(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id)); setAcknowledged(false) }} />{item.title}</label></ListPrimaryRow>
                    <ListSecondaryRow><span>{item.shared ? "Shared work — explicit ownership retained" : !item.movable ? "Explicit ownership retained" : item.execution_owner_id && item.execution_owner_id !== preview.formerId ? "Different explicit owner — select only if they should hand this work over" : workIds.includes(item.id) ? "Move responsibility to the new assignee" : "Keep explicit ownership"}</span></ListSecondaryRow>
                </ListItem>)}</List>
                <p className="mt-3 text-sm leading-6 text-neutral-400">Completed work, sales and onboarding history are preserved. Other work collaborators stay assigned. Existing Team chat members remain members; the new assignee joins through the current service rule.</p>
                {preview.appointment ? <p className="mt-3 text-sm leading-6 text-neutral-300">The recipient receives GHL setup access and {preview.stage === "onboarding" ? "booking access when the service reaches Setup" : "booking access"}. {preview.formerSetupRetained ? "The former assignee retains separate setup access." : "The former assignee loses setup access derived from this service."} {preview.formerBookingRetained ? "The former assignee retains booking access through another assignment or role." : "Booking access from this service moves to the recipient."} Owner/admin access remains available.</p> : null}
                <p className="mt-2 text-sm leading-6 text-neutral-400">Unassigned work follows its service responsibility. Retained work does not grant service access by itself. The former assignee may retain access through other assignments or workspace permissions.</p>
                {!preview.bookingEnabled ? <p role="alert" className="mt-2 text-sm text-red-300">Enable booking permission for this service before transferring.</p> : null}
                <label className="mt-4 block text-sm">Reason<textarea required maxLength={1000} disabled={frozen} value={reason} onChange={event => setReason(event.target.value)} className="mt-2 min-h-20 w-full rounded-lg border border-neutral-700 bg-black p-3 text-base" /></label>
                <label className="mt-3 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" disabled={frozen} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I reviewed the work that moves and the ownership and access that remain.</label>
            </> : null}
            {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
            {!reviewing && !recoveryOnly ? <button type="button" disabled={!recipient} onClick={() => setReviewing(true)} className="min-h-11 w-full rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-30">Confirm</button> : null}
            <div className="mt-4 flex flex-wrap justify-end gap-3"><button type="button" disabled={frozen} onClick={onClose} className="min-h-11 px-3 text-sm">Close</button>{error && !uncertain && !recoveryOnly ? <button type="button" disabled={pending} onClick={reloadPreview} className="min-h-11 px-3 text-sm underline">Reload preview</button> : null}{reviewing && (!recoveryOnly || preview) ? <button disabled={pending || !preview || !reason.trim() || !acknowledged || !preview.bookingEnabled} className="min-h-11 rounded-lg bg-white px-4 text-sm text-black disabled:opacity-50">{pending ? "Saving transfer…" : uncertain || recoveryOnly ? "Retry same transfer" : "Transfer assignee"}</button> : null}</div>
        </form>}
    </CenteredDialog>
}
