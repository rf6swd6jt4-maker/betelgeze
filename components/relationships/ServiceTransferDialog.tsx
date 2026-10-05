"use client"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react"
import { AssignmentSelector, CenteredDialog } from "@/components/ui"
import { DetailField, DetailFields } from "@/components/detail"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow } from "@/components/list/List"
import { transferRelationshipService } from "@/app/[workspaceSlug]/relationships/service-actions"
import { defaultTransferWork, recoverServiceTransfer, type ServiceTransferPreview } from "@/lib/service-assignee-transfer"
import type { RelationshipServiceRow } from "@/lib/service-stages"
import { createWorkspaceDraftJournal } from "@/lib/workspace-draft-journal"
import { registerWorkspaceAutosaveFlusher, runWorkspaceMutation } from "@/lib/workspace-mutations"

async function read<T>(url: string, userId: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(url, { cache: "no-store", redirect: "error", credentials: "same-origin", headers: { "x-workspace-user": userId }, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error ?? "Could not load this transfer.")
    return value
}
export function ServiceTransferDialog({ row, endpoint, workspaceSlug, relationshipId, userId, recoveryOnly = false, onClose, onDone }: {
    row: RelationshipServiceRow; endpoint: string; workspaceSlug: string; relationshipId: string; userId: string;
    recoveryOnly?: boolean; onClose: () => void; onDone: () => void;
}) {
    const [people, setPeople] = useState<Array<{ id: string; name: string }> | null>(null)
    const [recipient, setRecipient] = useState("")
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
        setPreview(record.preview); setAcknowledged(true); setUncertain(true); setRecoveries([])
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
        if (!journal.active() || accountChanged || pending || saved || !preview || !reason.trim() || !acknowledged || !preview.bookingEnabled || recoveryOnly && !request.current) return
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
    return <CenteredDialog title={recoveryOnly ? `Saved transfers: ${row.name}` : `Transfer ${row.name}`} busy={pending || uncertain} onClose={saved ? onDone : onClose}>
        {saved ? <div><p role="status" className="text-sm leading-6">Transfer saved. The selected work and recipient access passed the save checks.</p><button className="mt-4 min-h-11 rounded-lg bg-white px-4 text-sm text-black" onClick={onDone}>Done — refresh service</button></div> : <form onSubmit={submit}>
            {recoveryOnly ? <p className="mb-3 text-sm leading-6 text-neutral-300">This service no longer accepts a new transfer. Review a saved request to check whether it completed. Its original details stay unchanged when you retry.</p> : null}
            {recoveryAvailable && !frozen ? <div className="mb-3 text-sm"><button type="button" className="min-h-11 underline" onClick={() => void reviewRecovery()}>Review saved transfer requests</button>{recoveries.length ? <List ariaLabel="Saved transfer requests">{recoveries.map(record => <ListItem key={record.id}><ListPrimaryRow><button type="button" className="min-h-11 text-left" onClick={() => recover(record)}>Recover transfer: {record.input.reason}</button></ListPrimaryRow><ListSecondaryRow>{record.input.workIds.length} selected work items. Recovery requires an explicit retry.</ListSecondaryRow></ListItem>)}</List> : null}</div> : null}
            {recoveryOnly && !recoveryAvailable ? <p className="text-sm text-neutral-400">No saved transfer requests were found on this device.</p> : null}
            {!recoveryOnly || preview ? <>
            <DetailFields columns={1}><DetailField label="New assignee" icon="person"><AssignmentSelector ariaLabel="New service assignee" value={recipient} people={preview && frozen ? [{ id: preview.recipientId, name: preview.recipientName }] : people ?? []} disabled={frozen || !people} onChange={value => { setRecipient(value); setPreview(null); setWorkIds([]); setAcknowledged(false); setError(""); request.current = null }} /></DetailField></DetailFields>
            </> : null}
            {!recoveryOnly && (!people ? <p className="text-sm text-neutral-400">Loading eligible people…</p> : !people.length ? <p className="text-sm text-neutral-400">No other eligible people. Add service eligibility in Settings first.</p> : null)}
            {recipient && !preview && !error ? <p role="status" className="py-3 text-sm text-neutral-400">Checking work and access…</p> : null}
            {preview ? <>
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
            <div className="mt-4 flex flex-wrap justify-end gap-3"><button type="button" disabled={frozen} onClick={onClose} className="min-h-11 px-3 text-sm">Close</button>{error && !uncertain && !recoveryOnly ? <button type="button" disabled={pending} onClick={reloadPreview} className="min-h-11 px-3 text-sm underline">Reload preview</button> : null}{!recoveryOnly || preview ? <button disabled={pending || !preview || !reason.trim() || !acknowledged || !preview.bookingEnabled} className="min-h-11 rounded-lg bg-white px-4 text-sm text-black disabled:opacity-50">{pending ? "Saving transfer…" : uncertain || recoveryOnly ? "Retry same transfer" : "Transfer assignee"}</button> : null}</div>
        </form>}
    </CenteredDialog>
}
