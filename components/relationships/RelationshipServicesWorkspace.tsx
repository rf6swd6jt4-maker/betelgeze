"use client"
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react"
import Link from "@/components/workspace/WorkspaceLink"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { Assignee, AssignmentSelector, Selector, ServiceStage } from "@/components/ui"
import { SelectorDrawer, SelectorOption, SelectorTrigger } from "@/components/ui/Selector"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { PanelSectionTabs } from "@/components/panel/PanelTabs"
import { QuickStats } from "@/components/panel/QuickStats"
import { DetailField, DetailFields } from "@/components/detail"
import { addRelationshipService, changeRelationshipService } from "@/app/[workspaceSlug]/relationships/service-actions"
import { SERVICE_STAGES, type RelationshipServicePage, type RelationshipServiceRow, type ServiceCatalogueChoice } from "@/lib/service-stages"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"

type Props = { workspaceSlug: string; relationshipId: string; userId: string; initial: RelationshipServicePage; canAdd: boolean; canImport: boolean; canSeeHistory: boolean; legacy: boolean }
const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
const inputClass = "min-h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-base text-white sm:text-sm"
async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(url, { signal, cache: "no-store", credentials: "same-origin" })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? "Could not load this section.")
    return result
}
function CataloguePicker({ endpoint, selected, onChange, disabled }: { endpoint: string; selected: ServiceCatalogueChoice | null; onChange: (value: ServiceCatalogueChoice) => void; disabled: boolean }) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null)
    const [query, setQuery] = useState("")
    const [page, setPage] = useState(0)
    const [data, setData] = useState<{items: ServiceCatalogueChoice[]; hasMore: boolean} | null>(null)
    const [error, setError] = useState("")
    const [retry, setRetry] = useState(0)
    useEffect(() => {
        if (!anchor) return
        const controller = new AbortController()
        const timer = window.setTimeout(() => {
            void read<{items: ServiceCatalogueChoice[]; hasMore: boolean}>(`${endpoint}?kind=catalogue&q=${encodeURIComponent(query)}&offset=${page * 30}`, controller.signal).then(setData).catch(error => { if (!controller.signal.aborted) setError(error.message) })
        }, query ? 200 : 0)
        return () => { clearTimeout(timer); controller.abort() }
    }, [anchor, endpoint, page, query, retry])
    return <><SelectorTrigger open={Boolean(anchor)} appearance="input" disabled={disabled} aria-label="Service catalogue" onClick={event => { setAnchor(event.currentTarget); setError("") }}>{selected?.name ?? "Choose a service"}</SelectorTrigger>
        {anchor ? <SelectorDrawer anchor={anchor} ariaLabel="Service catalogue" title="Published services" search={query} onSearch={value => { setQuery(value); setPage(0); setData(null); setError("") }} onDismiss={() => setAnchor(null)} footer={page > 0 || data?.hasMore ? <div className="flex justify-between gap-2"><button type="button" disabled={page === 0} className="min-h-11 px-2 text-xs disabled:opacity-40" onClick={() => { setData(null); setPage(page - 1) }}>Previous</button><button type="button" disabled={!data?.hasMore} className="min-h-11 px-2 text-xs disabled:opacity-40" onClick={() => { setData(null); setPage(page + 1) }}>Next</button></div> : undefined}>
            {error ? <div className="p-3 text-sm text-red-200">{error}<button type="button" className="block min-h-11 underline" onClick={() => { setError(""); setRetry(retry + 1) }}>Retry</button></div> : !data ? <p role="status" className="p-3 text-sm text-neutral-500">Loading services…</p> : data.items.length ? data.items.map(service => <SelectorOption key={service.id} selected={selected?.id === service.id} description={service.description} onClick={() => { onChange(service); setAnchor(null) }}>{service.name}</SelectorOption>) : <p className="p-3 text-sm text-neutral-500">No published services match. Publish a service in the catalogue first.</p>}
        </SelectorDrawer> : null}
    </>
}
function ServiceForm({ endpoint, props, row, onDone, onClose }: { endpoint: string; props: Props; row?: RelationshipServiceRow; onDone: () => void; onClose: () => void }) {
    const heading = useRef<HTMLHeadingElement>(null)
    useEffect(() => { heading.current?.focus() }, [])
    const [service, setService] = useState<ServiceCatalogueChoice | null>(null)
    const [origin, setOrigin] = useState(row?.origin ?? "negotiation")
    const [stage, setStage] = useState<string>(row?.stage ?? "negotiating")
    const [assignee, setAssignee] = useState(row?.assignee_user_id ?? "")
    const [people, setPeople] = useState<Array<{id: string; name: string}> | null>(null)
    const [reason, setReason] = useState("")
    const [error, setError] = useState("")
    const [peopleError, setPeopleError] = useState("")
    const [retry, setRetry] = useState(0)
    const [pending, startTransition] = useTransition()
    const [uncertain, setUncertain] = useState(false)
    const requestId = useRef<string | null>(null)
    const serviceId = row?.service_id ?? service?.id
    useEffect(() => {
        if (!serviceId) return
        const controller = new AbortController()
        void read<Array<{id: string; name: string}>>(`${endpoint}?kind=assignees&service=${encodeURIComponent(serviceId)}`, controller.signal).then(setPeople).catch(error => { if (!controller.signal.aborted) setPeopleError(error.message) })
        return () => controller.abort()
    }, [endpoint, serviceId, retry])
    function submit(event: FormEvent) {
        event.preventDefault()
        if (!serviceId || !people || peopleError) return
        requestId.current ??= crypto.randomUUID()
        setError("")
        startTransition(async () => {
            try {
                const result = await runWorkspaceMutation(() => row ? changeRelationshipService(props.workspaceSlug, props.relationshipId, { requestId: requestId.current!, expectedUserId: props.userId, instanceId: row.id, version: row.version, stage, assigneeId: assignee, reason })
                    : addRelationshipService(props.workspaceSlug, props.relationshipId, { requestId: requestId.current!, expectedUserId: props.userId, serviceId, revisionId: service!.revision_id, origin, stage, assigneeId: assignee }), { category: "services" })
                if (!result.ok) { setError(result.error ?? "Could not save service"); setUncertain("uncertain" in result && result.uncertain === true); if (!("uncertain" in result && result.uncertain)) requestId.current = null; return }
                onDone()
            } catch { setUncertain(true); setError("The save could not be confirmed. Retry this same change to avoid a duplicate.") }
        })
    }
    const stages = row ? SERVICE_STAGES.filter(s => ["negotiating", "for_later", "declined"].includes(row.stage ?? "") ? ["negotiating", "for_later", "declined"].includes(s.key) : ["setup", "maintenance", "completed"].includes(s.key)) : SERVICE_STAGES.filter(s => ["setup", "maintenance", "completed"].includes(s.key))
    return <form onSubmit={submit} className="mb-4 border-y border-neutral-800 py-4" aria-label={row ? `Edit ${row.name}` : "Add service"}>
        <h3 ref={heading} tabIndex={-1} className="mb-3 text-base font-medium outline-none">{row ? row.name : "Add a service"}</h3>
        <fieldset disabled={pending || uncertain} className="min-w-0">
            {!row ? <CataloguePicker endpoint={endpoint} selected={service} onChange={value => { setService(value); setAssignee(""); setPeople(null); setPeopleError("") }} disabled={pending || uncertain} /> : null}
            <DetailFields columns={1}>
                {!row ? <DetailField label="Start from" icon="status"><Selector ariaLabel="Service entry" disabled={pending || uncertain} value={origin} onChange={value => { setOrigin(value); setStage(value === "negotiation" ? "negotiating" : "setup") }} options={[{value:"negotiation",label:"Negotiating",description:"Discuss this service before selling it"}, ...(props.canImport ? [{value:"already_onboarded",label:"Already onboarded",description:"Record existing delivery without checkout"}] : [])]} /></DetailField> : null}
                {row || origin === "already_onboarded" ? <DetailField label="Stage" icon="status"><Selector ariaLabel="Service stage" disabled={pending || uncertain} value={stage} onChange={setStage} options={stages.map(s => ({ value: s.key, label: s.label }))} /></DetailField> : null}
                <DetailField label="Assignee" icon="user"><AssignmentSelector ariaLabel="Service assignee" disabled={!people || pending || uncertain} value={assignee} onChange={setAssignee} clearLabel="Unassigned" people={people ?? []} />{serviceId && !people && !peopleError ? <p className="text-xs text-neutral-500">Loading eligible people…</p> : null}</DetailField>
                {row ? <DetailField label="Reason" icon="description"><input aria-label="Reason for service change" required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} className={inputClass} /></DetailField> : null}
            </DetailFields>
        </fieldset>
        {origin === "already_onboarded" && !row ? <p className="my-3 text-sm leading-6 text-neutral-400">Records existing work. No checkout or onboarding link is sent. {stage === "completed" ? "This service has no unfinished setup work." : stage === "maintenance" ? "Historical setup is not repeated." : "The service is ready for setup work."}</p> : null}
        {peopleError ? <p role="alert" className="py-2 text-sm text-red-200">{peopleError}<button type="button" onClick={() => { setPeopleError(""); setRetry(retry + 1) }} className="ml-2 min-h-11 underline">Retry choices</button></p> : null}
        {error ? <p role="alert" className="py-3 text-sm text-red-200">{error}</p> : null}
        <div className="mt-3 flex flex-wrap justify-end gap-3"><button type="button" disabled={pending} onClick={onClose} className="min-h-11 px-3 text-sm text-neutral-400">Close</button><button disabled={pending || !serviceId || !people || Boolean(peopleError)} className={buttonClass}>{pending ? "Saving…" : uncertain ? "Retry same change" : row ? "Save change" : "Add service"}</button></div>
    </form>
}

type ActivityPage = { items: Array<{id: string; title: string; status: string; updated_at: string; kind?: string}>; hasMore: boolean }
function RelationshipActivity({ endpoint, section, slug, relationshipId, legacy }: {endpoint: string; section: "work" | "history"; slug: string; relationshipId: string; legacy: boolean}) {
    const [page, setPage] = useState(0)
    const [data, setData] = useState<ActivityPage | null>(null)
    const [error, setError] = useState("")
    const [retry, setRetry] = useState(0)
    useEffect(() => {
        const controller = new AbortController()
        void read<ActivityPage>(`${endpoint}?kind=${section}&offset=${page * 30}`, controller.signal).then(setData).catch(error => { if (!controller.signal.aborted) setError(error.message) })
        return () => controller.abort()
    }, [endpoint, page, retry, section])
    return <>
        {section === "history" && legacy ? <Link href={`/${slug}/onboarding/${relationshipId}`} className="inline-flex min-h-11 items-center text-sm text-neutral-400 underline">Open current onboarding</Link> : null}
        {section === "work" ? <div className="mb-4 flex flex-wrap justify-end gap-3"><Link className="inline-flex min-h-11 items-center text-sm underline" href={`/${slug}/relationships/${relationshipId}?create=work-item`}>Add work item</Link>{legacy ? <Link className="inline-flex min-h-11 items-center text-sm underline" href={`/${slug}/relationships/${relationshipId}/pos`}>Open plan</Link> : null}</div> : null}
        {error ? <p role="alert" className="py-4 text-sm text-red-200">{error}<button className="ml-2 min-h-11 underline" onClick={() => { setError(""); setRetry(retry + 1) }}>Retry</button></p> : !data ? <p role="status" className="py-4 text-sm text-neutral-400">Loading {section}…</p> : <>
            <List ariaLabel={section === "work" ? "Relationship work" : "Sale and onboarding history"}>{data.items.length ? data.items.map(item => <ListItem key={`${item.kind ?? "work"}:${item.id}`}><ListPrimaryRow>{section === "work" ? <ListTitle href={`/${slug}/work-items/${item.id}`}>{item.title}</ListTitle> : <span className="text-sm font-medium">{item.title} <span className="font-mono text-neutral-500">{shortId(item.id)}</span></span>}</ListPrimaryRow><ListSecondaryRow><span className="capitalize">{item.status.replaceAll("_", " ")}</span><span>{formatRelativeTime(item.updated_at)}</span></ListSecondaryRow></ListItem>) : <p className="p-5 text-sm text-neutral-400">{section === "work" ? "No work items yet. Add one when this relationship needs work." : "No sales or onboarding sessions yet."}</p>}</List>
            <Pagination page={page} hasMore={data.hasMore} onChange={value => { setData(null); setPage(value) }} />
        </>}
    </>
}
function Pagination({ page, hasMore, onChange }: {page: number; hasMore: boolean; onChange: (page: number) => void}) {
    return page || hasMore ? <div className="mt-3 flex items-center justify-between text-sm"><button className="min-h-11 px-2 disabled:opacity-40" disabled={!page} onClick={() => onChange(page - 1)}>Previous</button><span className="text-neutral-500">Page {page + 1}</span><button className="min-h-11 px-2 disabled:opacity-40" disabled={!hasMore} onClick={() => onChange(page + 1)}>Next</button></div> : null
}
export function RelationshipServicesWorkspace(props: Props) {
    const router = useRouter()
    const endpoint = `/api/workspaces/${encodeURIComponent(props.workspaceSlug)}/relationships/${props.relationshipId}/services`
    const [section, setSection] = useState<"services" | "work" | "history">("services")
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<RelationshipServiceRow | null>(null)
    const [page, setPage] = useState(0)
    const [loaded, setLoaded] = useState<{ source: RelationshipServicePage; data: RelationshipServicePage } | null>(null)
    const data = (!page && loaded?.source !== props.initial) ? props.initial : loaded?.data ?? props.initial
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    async function loadPage(next: number) {
        setLoading(true); setError("")
        try { const result = await read<RelationshipServicePage>(`${endpoint}?offset=${next * 30}`); setLoaded({ source: props.initial, data: result }); setPage(next) }
        catch (error) { setError(error instanceof Error ? error.message : "Could not load services.") }
        finally { setLoading(false) }
    }
    function saved() { setAdding(false); setEditing(null); setPage(0); setLoaded(null); router.refresh() }
    return <section className="mt-5" aria-label="Relationship services and work">
        <PanelSectionTabs active={section} onChange={setSection} ariaLabel="Relationship sections" items={[{key:"services",label:"Services"},{key:"work",label:"Work"},...(props.canSeeHistory ? [{key:"history" as const,label:"Sales & onboarding"}] : [])]} />
        {section === "services" ? <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-sm leading-6 text-neutral-400">Each service has its own progress and delivery responsibility.</p>{props.canAdd ? <button className={buttonClass} onClick={() => { setAdding(!adding); setEditing(null) }}>Add service</button> : null}</div>
            {adding ? <ServiceForm endpoint={endpoint} props={props} onDone={saved} onClose={() => setAdding(false)} /> : null}
            {editing ? <ServiceForm key={editing.id} row={editing} endpoint={endpoint} props={props} onDone={saved} onClose={() => setEditing(null)} /> : null}
            {error ? <p role="alert" className="py-3 text-sm text-red-200">{error}<button onClick={() => void loadPage(page)} className="ml-2 min-h-11 underline">Retry</button></p> : null}
            <div aria-busy={loading} className={loading ? "pointer-events-none opacity-50" : ""}><List ariaLabel="Assigned services">{data.items.length ? data.items.map(service => {
                const editable = !service.legacy && props.canAdd && (props.canImport || service.origin === "negotiation") && !["awaiting_payment", "onboarding"].includes(service.stage ?? "")
                const actions = [{label:"Copy service name",copyText:service.name}, ...(editable ? [{label:"Edit service",onSelect:() => { setEditing(service); setAdding(false) }}] : [])]
                return <ListItem key={service.id}><MobileListActionSurface actions={actions} label={`Actions for ${service.name}`}>
                    <ListPrimaryRow><ListTitle className="flex-1">{service.name}</ListTitle><ServiceStage stage={service.stage} /></ListPrimaryRow>
                    <ListSecondaryRow><Assignee name={service.assignee_name} /><span className="hidden font-mono text-neutral-600 sm:inline">{shortId(service.id.replace("legacy:", ""))}</span><span className="hidden text-neutral-500 lg:inline">{service.legacy ? "Existing assignment" : service.origin === "already_onboarded" ? "Already onboarded" : "New opportunity"}</span><ListTrailing><ListActionMenu actions={actions} className="hidden sm:block" /></ListTrailing></ListSecondaryRow>
                </MobileListActionSurface></ListItem>
            }) : <p className="p-5 text-sm leading-6 text-neutral-400">No services assigned yet. Add a service from your catalogue to start a conversation or record existing work.</p>}</List><Pagination page={page} hasMore={data.hasMore} onChange={next => void loadPage(next)} /></div>
            {data.values?.map(value => <div key={`${value.kind}:${value.currency}:${value.billing_interval}:${value.billing_interval_count}`} className="mt-4"><p className="text-xs text-neutral-500">{value.kind === "catalogue_estimate" ? "Negotiating · potential value" : "Committed sales"} · {value.currency}</p><QuickStats items={[
                { label: "Upfront", value: new Intl.NumberFormat("en", {style:"currency",currency:value.currency}).format(value.upfront_cents / 100) },
                { label: `Recurring / ${value.billing_interval_count ?? 1} ${value.billing_interval ?? "month"}`, value: new Intl.NumberFormat("en", {style:"currency",currency:value.currency}).format(value.recurring_cents / 100) },
            ]} /></div>)}
            {props.legacy ? <Link href={`/${props.workspaceSlug}/relationships/${props.relationshipId}/pos`} className="mt-4 inline-flex min-h-11 items-center text-sm text-neutral-400 underline">Open existing sales and delivery plan</Link> : null}
        </> : <RelationshipActivity key={section} endpoint={endpoint} section={section} slug={props.workspaceSlug} relationshipId={props.relationshipId} legacy={props.legacy} />}
    </section>
}
