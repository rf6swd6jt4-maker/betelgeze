"use client"
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react"
import dynamic from "next/dynamic"
import { useRouter, useSearchParams, useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { AssignmentSelector, Selector, AttachmentCards, AttachmentCard, AddAttachmentCard, CenteredDialog, ServiceStage, RoundPill } from "@/components/ui"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow } from "@/components/list/List"
import { SopWorkProgress } from "@/components/sops/SopWorkProgress"
import type { RelationshipQueuePage } from "@/lib/relationship-service-plan"
import { RelationshipServiceTimeline, RelationshipQueue } from "./RelationshipServiceTimeline"
import { ServiceThumbnail } from "./ServiceThumbnail"
import { RelationshipContactCards } from "./RelationshipContactCards"
// The POS uses browser storage and the relationship draft provider. Loading it
// only after a seller asks for it keeps those browser-only dependencies out of
// the native relationship panel's render path.
const PosDialog = dynamic(
    () => import("./RelationshipPosDialog").then(module => module.RelationshipPosDialog),
    { ssr: false },
)
import { DetailField, DetailFields } from "@/components/detail"
import { addRelationshipService, changeRelationshipService } from "@/app/[workspaceSlug]/relationships/service-actions"
import { SERVICE_STAGES, type RelationshipServicePage, type RelationshipServiceRow, type ServiceCatalogueChoice } from "@/lib/service-stages"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"

type Props = { workspaceSlug: string; relationshipId: string; userId: string; initial: RelationshipServicePage; canAdd: boolean; canImport: boolean; canSeeHistory: boolean; legacy: boolean }
const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
const inputClass = "min-h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-base text-white sm:text-sm"
async function read<T>(url: string, signal?: AbortSignal, userId?: string): Promise<T> {
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000), cache: "no-store", credentials: "same-origin", headers: userId ? { "x-workspace-user": userId } : undefined })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? "Could not load this section.")
    return result
}
function CataloguePicker({ endpoint, selected, onChange, disabled }: { endpoint: string; selected: ServiceCatalogueChoice | null; onChange: (value: ServiceCatalogueChoice) => void; disabled: boolean }) {
    const [query, setQuery] = useState("")
    const [page, setPage] = useState(0)
    const [data, setData] = useState<{ items: ServiceCatalogueChoice[]; hasMore: boolean } | null>(null)
    const [error, setError] = useState("")
    const [retry, setRetry] = useState(0)
    const [choosing, setChoosing] = useState(!selected)
    useEffect(() => {
        if (!choosing) return
        const controller = new AbortController()
        const timer = window.setTimeout(() => { void read<{ items: ServiceCatalogueChoice[]; hasMore: boolean }>(`${endpoint}?kind=catalogue&q=${encodeURIComponent(query)}&offset=${page * 30}`, controller.signal).then(value => { if (!controller.signal.aborted) { setData(value); setError("") } }).catch(error => { if (!controller.signal.aborted) setError(error.message) }) }, query ? 200 : 0)
        return () => { clearTimeout(timer); controller.abort() }
    }, [choosing, endpoint, page, query, retry])
    if (!choosing && selected) return <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm" disabled={disabled} onClick={() => setChoosing(true)}><strong>{selected.name}</strong><span className="text-neutral-500 underline">Change</span></button>
    return <><input aria-label="Search service catalogue" placeholder="Search services" value={query} onChange={event => { setQuery(event.target.value); setPage(0); setData(null) }} className={inputClass} />{error ? <p role="alert" className="py-3 text-sm text-red-300">{error} <button type="button" className="min-h-11 underline" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : !data ? <p className="py-4 text-sm text-neutral-400">Loading services…</p> : <><List ariaLabel="Service catalogue" className="max-h-[calc(2*6rem+2px)] !overflow-y-auto overscroll-contain sm:max-h-[calc(3*6rem+2px)]">{data.items.map(service => <ListItem key={service.id} className="h-24 [content-visibility:visible]"><button type="button" disabled={disabled} className="flex h-full w-full flex-col text-left" title={service.description} onClick={() => { onChange(service); setChoosing(false) }}><ListPrimaryRow className="w-full"><RoundPill tone="emerald">{service.name}</RoundPill></ListPrimaryRow><ListSecondaryRow className="w-full flex-1 flex-wrap whitespace-normal gap-x-4 gap-y-1 !py-1"><span className="text-xs text-neutral-300">{new Intl.NumberFormat(undefined, { style: "currency", currency: service.currency }).format(service.upfront_cents / 100)} upfront</span><span className="text-xs text-neutral-300">{new Intl.NumberFormat(undefined, { style: "currency", currency: service.currency }).format(service.recurring_cents / 100)} recurring</span></ListSecondaryRow></button></ListItem>)}{!data.items.length ? <p className="p-4 text-sm text-neutral-500">No published services found.</p> : null}</List><Pagination page={page} hasMore={data.hasMore} onChange={setPage} /></>}</>
}

function ServiceForm({ endpoint, props, row, onDone, onClose, onBusyChange, onGenerating }: { endpoint: string; props: Props; row?: RelationshipServiceRow; onDone: (queue?: RelationshipQueuePage) => void; onClose: () => void; onBusyChange: (busy: boolean) => void; onGenerating: (generating: boolean) => void }) {
    const [service, setService] = useState<ServiceCatalogueChoice | null>(null)
    const [origin, setOrigin] = useState(row?.origin ?? "negotiation")
    const [stage, setStage] = useState<string>(row?.stage ?? "negotiating")
    const [assignee, setAssignee] = useState(row?.assignee_user_id ?? "")
    const [people, setPeople] = useState<Array<{id: string; name: string}> | null>(null)
    const [seller, setSeller] = useState("")
    const [manager, setManager] = useState("")
    const [cashCollected, setCashCollected] = useState("")
    const [cashRecord, setCashRecord] = useState<{ amount_cents: number | null; version: number } | null>(null)
    const [cashError, setCashError] = useState("")
    const [responsibility, setResponsibility] = useState<{ sellers: Array<{id: string; name: string}>; managers: Array<{id: string; name: string}> } | null>(null)
    const [reason, setReason] = useState("")
    const [error, setError] = useState("")
    const [peopleError, setPeopleError] = useState("")
    const [responsibilityError, setResponsibilityError] = useState("")
    const [retry, setRetry] = useState(0)
    const [pending, startTransition] = useTransition()
    const [uncertain, setUncertain] = useState(false)
    const [generation, setGeneration] = useState<{ instanceId: string | null } | null>(null)
    const [progressBusy, setProgressBusy] = useState(true)
    useEffect(() => { onBusyChange(pending || uncertain || Boolean(generation && !error && progressBusy)) }, [pending, uncertain, generation, error, progressBusy, onBusyChange])
    const requestId = useRef<string | null>(null)
    const serviceId = row?.service_id ?? service?.id
    useEffect(() => {
        if (!serviceId) return
        const controller = new AbortController()
        void read<Array<{id: string; name: string}>>(`${endpoint}?kind=assignees&service=${encodeURIComponent(serviceId)}`, controller.signal).then(setPeople).catch(error => { if (!controller.signal.aborted) setPeopleError(error.message) })
        return () => controller.abort()
    }, [endpoint, serviceId, retry])
    const completedImport = !row && origin === "already_onboarded" && stage === "completed"
    useEffect(() => {
        if (!completedImport) return
        const controller = new AbortController()
        void read<{ sellers: Array<{id: string; name: string}>; managers: Array<{id: string; name: string}> }>(`${endpoint}?kind=responsibility`, controller.signal)
            .then(value => { if (!controller.signal.aborted) { setResponsibility(value); setResponsibilityError("") } })
            .catch(error => { if (!controller.signal.aborted) setResponsibilityError(error.message) })
        return () => controller.abort()
    }, [completedImport, endpoint, retry])
    const cashEdit = Boolean(row && props.canImport && row.origin === "already_onboarded" && row.stage === "completed" && stage === "completed")
    useEffect(() => {
        if (!row || !cashEdit) return
        const controller = new AbortController()
        void read<{ amount_cents: number | null; version: number }>(`${endpoint}?kind=historical&id=${encodeURIComponent(row.id)}`, controller.signal, props.userId)
            .then(value => { if (!controller.signal.aborted) { setCashRecord(value); setCashCollected(value.amount_cents === null ? "" : (value.amount_cents / 100).toFixed(2)) } })
            .catch(cause => { if (!controller.signal.aborted) setCashError(cause.message) })
        return () => controller.abort()
    }, [cashEdit, endpoint, props.userId, retry, row])
    function submit(event: FormEvent) {
        event.preventDefault()
        const cashCents = cashCollected.trim() ? Math.round(Number(cashCollected) * 100) : cashRecord?.amount_cents === null ? null : 0
        const serviceChanged = Boolean(row && (stage !== row.stage || assignee !== (row.assignee_user_id ?? "")))
        if (!serviceId || !people || peopleError || (completedImport && (!responsibility || responsibilityError || !seller || !manager))
            || (row && (!cashEdit || serviceChanged) && !reason.trim())
            || (cashEdit && (!cashRecord || cashError || (cashCents !== null && (!Number.isSafeInteger(cashCents) || cashCents < 0 || cashCents > 1000000000000))))) return
        requestId.current ??= crypto.randomUUID()
        setError("")
        if (stage === "setup") { onBusyChange(true); setProgressBusy(true); setGeneration({ instanceId: null }); onGenerating(true) }
        startTransition(async () => {
            try {
                const result = await runWorkspaceMutation(() => row ? changeRelationshipService(props.workspaceSlug, props.relationshipId, { requestId: requestId.current!, expectedUserId: props.userId, instanceId: row.id, version: row.version, stage, assigneeId: assignee, reason, cashVersion: cashEdit ? cashRecord!.version : undefined, cashCents: cashEdit && cashCents !== cashRecord!.amount_cents ? cashCents : undefined })
                    : addRelationshipService(props.workspaceSlug, props.relationshipId, { requestId: requestId.current!, expectedUserId: props.userId, serviceId, revisionId: service!.revision_id, origin, stage, assigneeId: assignee, sellerId: completedImport ? seller : "", managerId: completedImport ? manager : "" }), { category: "services" })
                if (!result.ok) { setError(result.error ?? "Could not save service"); setUncertain("uncertain" in result && result.uncertain === true); if (!("uncertain" in result && result.uncertain)) requestId.current = null; return }
                if (result.generation) { setGeneration({ instanceId: result.id! }); onGenerating(true) } else onDone()
            } catch { setUncertain(true); setError("The save could not be confirmed. Retry this same change to avoid a duplicate.") }
        })
    }
    if (generation) return <SopWorkProgress onBusyChange={setProgressBusy} endpoint={endpoint} instanceId={generation.instanceId} userId={props.userId} initialError={error} onComplete={onDone} onClose={() => { if (uncertain) { setGeneration(null); onGenerating(false) } else onDone() }} recovery={error && !generation.instanceId ? <button type="button" className="min-h-11 text-sm text-neutral-300 underline" onClick={() => { setGeneration(null); onGenerating(false) }}>{uncertain ? "Return to retry same change" : "Back to service"}</button> : undefined} />
    const stages = row ? SERVICE_STAGES.filter(s => ["negotiating", "for_later", "declined"].includes(row.stage ?? "") ? ["negotiating", "declined"].includes(s.key) : ["setup", "maintenance", "completed"].includes(s.key)) : SERVICE_STAGES.filter(s => ["setup", "maintenance", "completed"].includes(s.key))
    return <form onSubmit={submit} className="min-w-0" aria-label={row ? `Edit ${row.name}` : "Add service"}>
        <fieldset disabled={pending || uncertain} className="min-w-0">
            {!row ? <CataloguePicker endpoint={endpoint} selected={service} onChange={value => { setService(value); setAssignee(""); setPeople(null); setPeopleError("") }} disabled={pending || uncertain} /> : null}
            {row || service ? <DetailFields columns={1}>
                {!row ? <DetailField label="Start from" icon="status"><Selector ariaLabel="Service entry" disabled={pending || uncertain} value={origin} onChange={value => { setOrigin(value); setStage(value === "negotiation" ? "negotiating" : "setup") }} options={[{value:"negotiation",label:"Negotiating",description:"Discuss this service before selling it"}, ...(props.canImport ? [{value:"already_onboarded",label:"Already onboarded",description:"Record existing delivery without checkout"}] : [])]} /></DetailField> : null}
                {row || origin === "already_onboarded" ? <DetailField label="Stage" icon="status"><Selector ariaLabel="Service stage" disabled={pending || uncertain} value={stage} onChange={setStage} options={stages.map(s => ({ value: s.key, label: s.label }))} /></DetailField> : null}
                <DetailField label="Assignee" icon="user"><AssignmentSelector ariaLabel="Service assignee" disabled={!people || pending || uncertain} value={assignee} onChange={setAssignee} clearLabel="Unassigned" people={people ?? []} />{serviceId && !people && !peopleError ? <p className="text-xs text-neutral-500">Loading eligible people…</p> : null}</DetailField>
                {cashEdit ? <DetailField label="Cash collected" icon="status"><div><input aria-label="Cash collected" type="number" min="0" max="10000000000" step="0.01" value={cashCollected} disabled={!cashRecord || Boolean(cashError)} onChange={event => { setCashCollected(event.target.value); requestId.current = null }} className={inputClass} placeholder={cashRecord ? "Not recorded" : "Loading…"} /><p className="mt-1 text-xs text-neutral-500">{row?.currency} received for this completed service. No charge is created.</p></div></DetailField> : null}
                {completedImport ? <>
                    <DetailField label="Seller" icon="user"><AssignmentSelector required ariaLabel="Relationship seller" disabled={!responsibility || pending || uncertain} value={seller} onChange={setSeller} clearLabel="Choose seller" placeholder="Choose seller" people={responsibility?.sellers ?? []} /></DetailField>
                    <DetailField label="Manager" icon="user"><AssignmentSelector required ariaLabel="Relationship manager" disabled={!responsibility || pending || uncertain} value={manager} onChange={setManager} clearLabel="Choose manager" placeholder="Choose manager" people={responsibility?.managers ?? []} />{!responsibility && !responsibilityError ? <p className="text-xs text-neutral-500">Loading responsibility choices…</p> : null}</DetailField>
                </> : null}
                {row ? <DetailField label="Reason" icon="description"><input aria-label="Reason for service change" required={!cashEdit || stage !== row?.stage || assignee !== (row?.assignee_user_id ?? "")} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} className={inputClass} /></DetailField> : null}
            </DetailFields> : null}
        </fieldset>
        {origin === "already_onboarded" && !row ? <p className="my-3 text-sm leading-6 text-neutral-400">Records existing work. No checkout or onboarding link is sent. {stage === "completed" ? "This service has no unfinished setup work." : stage === "maintenance" ? "Historical setup is not repeated." : "The service is ready for setup work."}</p> : null}
        {peopleError || responsibilityError || cashError ? <p role="alert" className="py-2 text-sm text-red-200">{peopleError || responsibilityError || cashError}<button type="button" onClick={() => { setPeopleError(""); setResponsibilityError(""); setCashError(""); setCashRecord(null); setRetry(retry + 1) }} className="ml-2 min-h-11 underline">Retry choices</button></p> : null}
        {error ? <p role="alert" className="py-3 text-sm text-red-200">{error}</p> : null}
        <div className="mt-3 flex flex-wrap justify-end gap-3"><button type="button" disabled={pending || uncertain} onClick={onClose} className="min-h-11 px-3 text-sm text-neutral-400">Close</button><button disabled={pending || !serviceId || !people || Boolean(peopleError) || (completedImport && (!responsibility || !seller || !manager || Boolean(responsibilityError))) || (cashEdit && (!cashRecord || Boolean(cashError)))} className={buttonClass}>{pending ? "Saving…" : uncertain ? "Retry same change" : row ? "Save change" : "Add service"}</button></div>
    </form>
}

function Pagination({ page, hasMore, onChange }: {page: number; hasMore: boolean; onChange: (page: number) => void}) {
    return page || hasMore ? <div className="mt-3 flex items-center justify-between text-sm"><button className="min-h-11 px-2 disabled:opacity-40" disabled={!page} onClick={() => onChange(page - 1)}>Previous</button><span className="text-neutral-500">Page {page + 1}</span><button className="min-h-11 px-2 disabled:opacity-40" disabled={!hasMore} onClick={() => onChange(page + 1)}>Next</button></div> : null
}
type ServiceCardDetail = RelationshipServiceRow & { notes?: string; description?: string; manager?: string; seller?: string; sold_upfront_cents?: number | null; sold_recurring_cents?: number | null; sold_currency?: string | null; billing_interval?: string; billing_interval_count?: number }
export function RelationshipServicesWorkspace(props: Props) {
    const router = useRouter()
    const search = useSearchParams()
    const active = useWorkspaceNavigation()?.active ?? true
    const endpoint = `/api/workspaces/${encodeURIComponent(props.workspaceSlug)}/relationships/${props.relationshipId}/services`
    const [adding, setAdding] = useState(false)
    const [generating, setGenerating] = useState(false)
    const [resumedGeneration, setResumedGeneration] = useState<string | null>(null)
    const [publishedQueue, setPublishedQueue] = useState<RelationshipQueuePage | null>(null)
    const [serviceBusy, setServiceBusy] = useState(false)
    const [editing, setEditing] = useState<RelationshipServiceRow | null>(null)
    const [opened, setOpened] = useState<ServiceCardDetail | null>(null)
    const [pos, setPos] = useState<string | null>(null)
    const [page, setPage] = useState(0)
    const [cards, setCards] = useState<RelationshipServicePage>(props.initial)
    const [error, setError] = useState("")
    const [retry, setRetry] = useState(0)
    const [visible, setVisible] = useState(false)
    const host = useRef<HTMLElement>(null)
    const editable = (service: RelationshipServiceRow) => !service.legacy && props.canAdd && (props.canImport || service.origin === "negotiation") && !["awaiting_payment", "onboarding"].includes(service.stage ?? "")
    const canSell = (service: RelationshipServiceRow) => props.canAdd && !service.legacy && ["negotiating", "declined", "for_later"].includes(service.stage ?? "")
    useEffect(() => { const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: "160px" }); if (host.current) observer.observe(host.current); return () => observer.disconnect() }, [])
    useEffect(() => {
        if (!active || !visible) return
        const controller = new AbortController()
        fetch(`${endpoint}?kind=cards&offset=${page * 30}`, { headers: { "x-workspace-user": props.userId }, cache: "no-store", redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error); return value }).then(value => { if (!controller.signal.aborted) { setCards(value); setError("") } }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
        return () => controller.abort()
    }, [endpoint, page, props.initial, props.userId, active, visible, retry])
    function resumeGeneration(instanceId: string) { if (!adding && !editing && !resumedGeneration) { setServiceBusy(true); setResumedGeneration(instanceId) } }
    function saved(queue?: RelationshipQueuePage) { if (queue) setPublishedQueue(queue); setGenerating(false); setResumedGeneration(null); setAdding(false); setEditing(null); setOpened(null); setRetry(value => value + 1); router.refresh() }
    function closePos() { setPos(null); if (search.has("sell")) { const next = new URLSearchParams(search.toString()); next.delete("sell"); router.replace(`/${props.workspaceSlug}/relationships/${props.relationshipId}${next.size ? `?${next}` : ""}`) } }
    const requestedPos = pos ?? search.get("sell")
    return <section className="mt-5" aria-label="Relationship services and work">
        <RelationshipServiceTimeline endpoint={endpoint} workspaceSlug={props.workspaceSlug} relationshipId={props.relationshipId} userId={props.userId} revision={props.initial} canEdit={props.canImport} canEditService={() => true} onEditService={row => setOpened(cards.items.find(card => card.id === row.id) ?? row)} />
        <div className="mt-5 grid min-w-0 gap-x-6 gap-y-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,1fr)]">
            <div className="relative h-[25.5rem] min-w-0 pt-6 xl:h-auto xl:min-h-0"><div className="h-full xl:absolute xl:inset-0 xl:pt-6"><RelationshipQueue endpoint={endpoint} slug={props.workspaceSlug} relationshipId={props.relationshipId} userId={props.userId} revision={props.initial} publishedQueue={publishedQueue} onGeneration={resumeGeneration} /></div>
            </div>
            <div className="min-w-0"><section ref={host} className="mt-6" aria-label="Assigned services"><h2 className="mb-3 text-base font-semibold">Services</h2>
                <AttachmentCards label="Assigned services" compact>{cards.items.map(row => <AttachmentCard compact thumbnailFit="contain" key={row.id} title={row.name} thumbnail={<ServiceThumbnail service={row} />} inactive={["negotiating", "declined", "for_later"].includes(row.stage ?? "")} subtitle={SERVICE_STAGES.find(stage => stage.key === row.stage)?.label ?? "Review needed"} onClick={() => setOpened(row)} />)}{props.canAdd ? <AddAttachmentCard compact label="Add service" onClick={() => { setGenerating(false); setAdding(true) }} /> : null}</AttachmentCards>
                {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error} <button className="min-h-11 underline" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : null}
                <Pagination page={page} hasMore={cards.hasMore} onChange={setPage} />
            </section><RelationshipContactCards workspaceSlug={props.workspaceSlug} relationshipId={props.relationshipId} userId={props.userId} revision={props.initial} canAdd={props.canAdd} /></div>
        </div>
        {adding ? <CenteredDialog title={generating ? "Generating work…" : "Add service"} busy={serviceBusy} onClose={() => setAdding(false)}><ServiceForm onGenerating={setGenerating} onBusyChange={setServiceBusy} endpoint={endpoint} props={props} onDone={saved} onClose={() => setAdding(false)} /></CenteredDialog> : null}
        {editing ? <CenteredDialog title={generating ? "Generating work…" : "Edit service"} busy={serviceBusy} onClose={() => setEditing(null)}><ServiceForm onGenerating={setGenerating} onBusyChange={setServiceBusy} key={editing.id} row={editing} endpoint={endpoint} props={props} onDone={saved} onClose={() => setEditing(null)} /></CenteredDialog> : null}
        {resumedGeneration ? <CenteredDialog title="Generating work…" busy={serviceBusy} onClose={() => setResumedGeneration(null)}><SopWorkProgress onBusyChange={setServiceBusy} endpoint={endpoint} instanceId={resumedGeneration} userId={props.userId} onComplete={saved} onClose={() => setResumedGeneration(null)} /></CenteredDialog> : null}
        {opened ? <ServiceDetailDialog row={opened} endpoint={endpoint} userId={props.userId} onClose={() => setOpened(null)} onEdit={editable(opened) ? () => { setEditing(opened); setOpened(null) } : undefined} onSell={canSell(opened) ? () => { setPos(opened.id); setOpened(null) } : undefined} /> : null}
        {requestedPos ? <PosDialog workspaceSlug={props.workspaceSlug} relationshipId={props.relationshipId} userId={props.userId} selectedId={requestedPos === "1" ? undefined : requestedPos} onClose={closePos} /> : null}
    </section>
}
function ServiceDetailDialog({ row, endpoint, userId, onClose, onEdit, onSell }: { row: ServiceCardDetail; endpoint: string; userId: string; onClose: () => void; onEdit?: () => void; onSell?: () => void }) {
    const [data, setData] = useState(row)
    const [error, setError] = useState("")
    useEffect(() => {
        const controller = new AbortController()
        fetch(`${endpoint}?kind=detail&id=${encodeURIComponent(row.id)}`, { headers: { "x-workspace-user": userId }, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) }).then(async response => { const value = await response.json(); if (!response.ok || !value.items[0]) throw new Error(value.error ?? "Service no longer available"); return value.items[0] }).then(value => { if (!controller.signal.aborted) setData(value) }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
        return () => controller.abort()
    }, [endpoint, row, userId])
    const showCataloguePrices = !(data.origin === "already_onboarded" && data.stage === "completed")
    const money = (cents: number) => new Intl.NumberFormat("en", { style: "currency", currency: data.sold_currency ?? data.currency }).format(cents / 100)
    return <CenteredDialog title={row.name} onClose={onClose} footer={onSell || onEdit ? <div className="flex justify-end gap-3">{onEdit ? <button className="min-h-11 px-3 text-sm text-neutral-300" onClick={onEdit}>Edit service</button> : null}{onSell ? <button className={buttonClass} onClick={onSell}>Sell service</button> : null}</div> : undefined}>
        <ServiceStage stage={data.stage} />
        {data.description ? <p className="mt-3 text-sm leading-6 text-neutral-400">{data.description}</p> : null}
        <DetailFields columns={1}>{showCataloguePrices ? <><DetailField label="Upfront" icon="status">{money(data.sold_upfront_cents ?? data.upfront_cents)}</DetailField><DetailField label="Recurring" icon="status">{money(data.sold_recurring_cents ?? data.recurring_cents)} / {data.billing_interval_count ?? 1} {data.billing_interval ?? "month"}</DetailField></> : null}<DetailField label="Assigned to" icon="person">{data.assignee_name}</DetailField>{data.manager ? <DetailField label="Manager" icon="person">{data.manager}</DetailField> : null}{data.seller ? <DetailField label="Seller" icon="person">{data.seller}</DetailField> : null}<DetailField label="Notes" icon="description">{data.notes || "No notes"}</DetailField></DetailFields>
        {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
    </CenteredDialog>
}
