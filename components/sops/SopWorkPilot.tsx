"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "@/components/workspace/WorkspaceLink"
import { Selector, Status } from "@/components/ui"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { WORKSPACE_MUTATION_END } from "@/lib/workspace-mutations"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"
import { interpretationUnavailable, type SopAsset } from "@/lib/sops/records-policy"
import type { sopWorkReport } from "@/lib/sops/work-server"
import { sopButtonClass, sopCommand, useSopDraft } from "./client"

type Relationship = { id: string; primary_person_name: string; business_name: string | null; created_at: string; lifecycle_phase: string }
type Page<T> = { items: T[]; next: string | null }
type Report = NonNullable<Awaited<ReturnType<typeof sopWorkReport>>>
type Intent = { id: string; assetId: string; relationshipId: string; serviceKey: string; runId?: string }
const usd = (value: number) => `$${value.toFixed(5)}`
const time = (value: string) => new Date(value).toLocaleString()
function intentFrom(value: string | null): Intent | null {
    try { const parsed = JSON.parse(value ?? "null"); return parsed && typeof parsed.id === "string" && typeof parsed.assetId === "string" && typeof parsed.relationshipId === "string" && typeof parsed.serviceKey === "string" ? parsed : null } catch { return null }
}
export function SopWorkPilot({ workspaceSlug, workspaceId, userId, sopId, assets: initialAssets, relationships: initialRelationships, ready, initialRunId = "" }: {
    workspaceSlug: string; workspaceId: string; userId: string; sopId: string; assets: Page<SopAsset>; relationships: Page<Relationship>; ready: boolean; initialRunId?: string
}) {
    const api = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/sops/${sopId}`
    const draft = useSopDraft(`sop-work:${workspaceId}:${userId}:${sopId}`), intent = intentFrom(draft.stored)
    const [assets, setAssets] = useState(initialAssets), [relationships, setRelationships] = useState(initialRelationships)
    const [assetId, setAssetId] = useState(""), [relationshipId, setRelationshipId] = useState(""), [service, setService] = useState<{ key: string; name: string } | null>(null)
    const [services, setServices] = useState<{key:string;name:string}[]>([])
    const [runId, setRunId] = useState(initialRunId), [report, setReport] = useState<Report | null>(null), [recent, setRecent] = useState<{ id: string; status: string; created_at: string }[]>([])
    const [busy, setBusy] = useState(false), [error, setError] = useState("")
    const activeRunId = runId || intent?.runId || ""
    const readSequence = useRef(0), serviceSequence = useRef(0), notified = useRef(new Set<string>())
    const tabActive = useWorkspaceTabActive(), watch = useRef({ id: "", deadline: 0 })
    const status = report?.id === activeRunId ? report.status : undefined
    const read = useCallback(async (id: string) => {
        const sequence = ++readSequence.current
        const value = await sopCommand(`${api}/work-runs/${id}`, undefined, "GET") as Report
        if (sequence === readSequence.current) {
            setReport(value)
            if (value.status === "published" && !notified.current.has(id)) {
                notified.current.add(id)
                window.dispatchEvent(new CustomEvent(WORKSPACE_MUTATION_END, { detail: { mutationId: `sop-work:${id}`, failed: false } }))
            }
        }
        return value
    }, [api])
    // One visible, active run only. Sequential reads, four-minute ceiling, no
    // provider calls on GET, no hidden-tab polling or workspace-wide watcher.
    useEffect(() => {
        if (!activeRunId || !tabActive || status === "published" || status === "failed") return
        let cancelled = false, pending = false, timer: ReturnType<typeof setTimeout> | undefined
        if (watch.current.id !== activeRunId) watch.current = { id: activeRunId, deadline: Date.now() + 240000 }
        const deadline = watch.current.deadline
        const tick = async () => {
            if (cancelled || pending || document.visibilityState !== "visible" || Date.now() >= deadline) return
            pending = true
            try {
                const result = await read(activeRunId)
                if (!cancelled && ["queued", "running"].includes(result.status)) timer = setTimeout(() => void tick(), 5000)
            } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Could not check progress.") }
            finally { pending = false }
        }
        const visible = () => { if (timer) clearTimeout(timer); void tick() }
        timer = setTimeout(() => void tick(), 0)
        document.addEventListener("visibilitychange", visible)
        return () => { cancelled = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", visible) }
    }, [activeRunId, read, status, tabActive])
    const action = async (operation: () => Promise<void>) => {
        if (busy) return
        setBusy(true); setError("")
        try { await operation() } catch (e) { setError(e instanceof Error ? e.message : "The request was not confirmed. Retry with the saved request.") } finally { setBusy(false) }
    }
    const chooseRelationship = (id: string) => {
        setRelationshipId(id); setService(null); setServices([]); setError("")
        const sequence = ++serviceSequence.current
        void sopCommand(`${api}/work-options?relationshipId=${id}`, undefined, "GET").then(result => { if (sequence === serviceSequence.current) { setServices(result.services); if (result.services.length === 1) setService(result.services[0]) } }).catch(e => { if (sequence === serviceSequence.current) setError(e.message) })
    }
    const start = () => action(async () => {
        const request = intent && !intent.runId ? intent : { id: crypto.randomUUID(), assetId, relationshipId, serviceKey: service!.key }
        draft.write(request) // Must persist before accepting a potentially paid run.
        const result = await sopCommand(`${api}/work-runs`, request)
        draft.write({ ...request, runId: result.id })
        setRunId(result.id); setReport(null)
        await read(result.id)
    })
    const disabled = busy || Boolean(intent && !intent.runId)
    return <div className="mt-6 space-y-6">
        <p className="max-w-3xl text-sm leading-6 text-neutral-400">Services connected to this SOP generate work automatically when a test service enters Setup. No onboarding form is required. Use this page to inspect usage or manually retry with a procedure and a test service in Setup. Work appears in Library and the relationship queue; existing service assignments are preserved.</p>
        {!ready ? <p role="status" className="text-sm text-amber-200">Work generation is disabled. Apply the pilot migration and enable SOP AI and the work pilot in the server environment.</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="mb-2 block text-xs text-neutral-500">SOP source</label><Selector ariaLabel="SOP source" value={assetId} options={assets.items.map(item => ({ value: item.asset_id, label: item.asset.title, description: interpretationUnavailable(item.asset) ?? item.role, disabled: Boolean(interpretationUnavailable(item.asset)) }))} onChange={setAssetId} placeholder="Choose procedure file" appearance="input" disabled={disabled} />
                {assets.next ? <button type="button" disabled={busy} onClick={() => void action(async () => { setAssets(await sopCommand(`${api}/work-options?kind=assets&cursor=${encodeURIComponent(assets.next!)}`, undefined, "GET")); setAssetId("") })} className="mt-2 text-xs text-neutral-400 underline">Next source files</button> : null}
            </div>
            <div><label className="mb-2 block text-xs text-neutral-500">Test relationship</label><Selector ariaLabel="Test relationship" value={relationshipId} options={relationships.items.map(item => ({ value: item.id, label: item.business_name || item.primary_person_name, description: item.lifecycle_phase }))} onChange={chooseRelationship} placeholder="Choose test relationship" appearance="input" disabled={disabled} />
                {relationships.next ? <button type="button" disabled={busy} onClick={() => void action(async () => { setRelationships(await sopCommand(`${api}/work-options?cursor=${encodeURIComponent(relationships.next!)}`, undefined, "GET")); setRelationshipId(""); setService(null) })} className="mt-2 text-xs text-neutral-400 underline">Next test relationships</button> : null}
            </div>
        </div>
        {services.length ? <Selector ariaLabel="Setup service" value={service?.key ?? ""} options={services.map(item => ({value:item.key,label:item.name}))} onChange={key => setService(services.find(item => item.key === key) ?? null)} placeholder="Choose Setup service" appearance="input" disabled={disabled} /> : null}
        <div className="flex flex-wrap gap-3">
            <button type="button" className={sopButtonClass} disabled={!ready || busy || (!(intent && !intent.runId) && (!assetId || !relationshipId || !service))} onClick={() => void start()}>{busy ? "Working…" : intent && !intent.runId ? "Recover saved request" : "Begin test fulfilment"}</button>
            <button type="button" className="min-h-10 text-sm text-neutral-400 underline underline-offset-4" disabled={busy} onClick={() => void action(async () => setRecent((await sopCommand(`${api}/work-runs`, undefined, "GET")).items))}>Load recent runs</button>
            <Link href={`/${workspaceSlug}/sops/${sopId}`} className="inline-flex min-h-10 items-center text-sm text-neutral-500">Back to SOP</Link>
        </div>
        {recent.length ? <Selector ariaLabel="Recent pilot run" value={activeRunId} appearance="input" options={recent.map(item => ({ value: item.id, label: `${time(item.created_at)} · ${item.status}`, description: item.id }))} onChange={id => { readSequence.current++; setRunId(id); setReport(null); void action(async () => { await read(id) }) }} /> : null}
        {error ? <p role="alert" className="break-words text-sm text-red-300">{error}</p> : null}
        {activeRunId ? <section className="border-t border-neutral-800 pt-6">
            <div className="flex flex-wrap items-center gap-3"><h2 className="text-base font-medium">Generation run</h2><Status label={status === "published" ? "Work created" : status === "failed" ? "Needs attention" : status === "running" ? "Generating" : "Queued"} tone={status === "published" ? "green" : status === "failed" ? "red" : "yellow"} /></div>
            <p className="mt-2 break-all font-mono text-xs text-neutral-500">{activeRunId}</p>
            <div className="mt-3 flex flex-wrap gap-4"><button type="button" disabled={busy} onClick={() => void action(async () => { await read(activeRunId) })} className="min-h-10 text-sm text-neutral-300 underline">Check progress and cost</button>
                {status !== "published" ? <button type="button" disabled={busy || !ready || (status === "failed" && (report?.attempts ?? 0) >= 3)} onClick={() => void action(async () => { await sopCommand(`${api}/work-runs/${activeRunId}`, { retry: status === "failed" }); await read(activeRunId) })} className="min-h-10 text-sm text-neutral-300 underline">{status === "failed" ? "Retry · may incur another charge" : "Resume queued run"}</button> : null}
            </div>
            {report?.id === activeRunId ? <>
                {report.error_summary ? <p role="alert" className="mt-3 text-sm text-red-300">{report.error_summary}</p> : null}
                <h3 className="mt-5 text-sm font-medium">Cost report · USD</h3>
                <a href={`${api}/work-runs/${activeRunId}?download=1`} className="mt-2 inline-flex min-h-10 items-center text-xs text-neutral-400 underline">Download run report</a>
                <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-3">
                    <div><dt className="text-neutral-500">Known cost incurred by this run</dt><dd className="mt-1 text-neutral-100">{usd(report.costs.thisRun.knownUsd)}{report.costs.thisRun.unknownCalls ? ` + ${report.costs.thisRun.unknownCalls} unpriced request(s)` : ""}</dd></div>
                    <div><dt className="text-neutral-500">SOP processing history</dt><dd className="mt-1 text-neutral-100">{report.sourceHistoryUnmetered ? "No recorded usage yet" : `${usd(report.costs.sourceHistory.knownUsd)}${report.costs.sourceHistory.unknownCalls ? " + unknown usage" : ""}`}</dd></div>
                    <div><dt className="text-neutral-500">Work generation · this run</dt><dd className="mt-1 text-neutral-100">{usd(report.costs.generation.knownUsd)}{report.costs.generation.unknownCalls ? " + unknown usage" : ""}</dd></div>
                </dl>
                <p className="mt-3 text-xs leading-5 text-neutral-500">Estimates use provider-reported tokens and the rate saved with each request. SOP history can include processing paid for by an earlier run; do not add it to this run twice. Unknown or missing usage is not zero. Hosting, storage and taxes are excluded. Reusing a completed interpretation requires no new SOP-reading call.</p>
                {report.entries.length ? <List ariaLabel="AI usage requests">{report.entries.map(entry => <ListItem key={entry.id}><ListPrimaryRow><ListTitle>{entry.stage === "interpretation" ? "SOP reading" : "Work generation"}</ListTitle><span className="text-sm text-neutral-300">{entry.estimated_usd === null ? "Cost unknown" : usd(entry.estimated_usd)}</span></ListPrimaryRow><ListSecondaryRow><span className="truncate text-xs text-neutral-500">{entry.model} · {entry.usage ? `${entry.usage.input.toLocaleString()} in (${entry.usage.cached.toLocaleString()} cached) · ${entry.usage.output.toLocaleString()} out` : "Usage unavailable"}</span><ListTrailing><span className="text-xs text-neutral-500">{entry.run_id === activeRunId ? "This run" : "Earlier source processing"}</span></ListTrailing></ListSecondaryRow></ListItem>)}</List> : null}
                {report.warnings && Array.isArray(report.warnings) && report.warnings.length ? <details className="mt-5 text-sm text-neutral-400"><summary className="cursor-pointer">Generation notes</summary><ul className="mt-2 list-disc space-y-1 pl-5">{(report.warnings as string[]).map((warning, index) => <li key={index}>{warning}</li>)}</ul></details> : null}
                {report.status === "published" ? <><h3 className="mt-6 text-sm font-medium">Created work items</h3><List ariaLabel="Created work items">{report.workItems.map(item => item ? <ListItem key={item.id}><ListPrimaryRow><ListTitle href={`/${workspaceSlug}/work-items/${item.id}`}>{item.title}</ListTitle></ListPrimaryRow><ListSecondaryRow><span className="text-xs text-neutral-500">SOP fulfilment</span><ListTrailing><span className="font-mono text-xs text-neutral-600">{item.id.slice(0, 8)}</span></ListTrailing></ListSecondaryRow></ListItem> : null)}</List><Link href={`/${workspaceSlug}/work-items`} className="mt-4 inline-flex min-h-10 items-center text-sm text-neutral-300 underline">Open Library work items</Link></> : null}
            </> : null}
        </section> : null}
    </div>
}
