"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "@/components/workspace/WorkspaceLink"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { FilterRail, FilterRailButton, FilterRailCount } from "@/components/panel/FilterRail"
import { CenteredDialog } from "@/components/ui/CenteredDialog"
import { Status, RoundPill } from "@/components/ui"
import { HORIZON_LABELS } from "@/lib/work-queue/feedback-policy"
import { DISPUTE_REASONS, rankQueue, type RankedQueueItem } from "@/lib/work-queue/ranking"
import { shortId, formatRelativeTime } from "@/lib/ui/relative-time"
import type { PersonalQueueSnapshot } from "@/lib/work-queue/server"

const button = "min-h-11 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
export function PersonalWorkQueue({ data }: { data: PersonalQueueSnapshot }) {
    const [snapshot,setSnapshot] = useState(data)
    const [previousData,setPreviousData] = useState(data)
    const [view,setView] = useState<"ready"|"deferred">(data.view ?? "ready")
    const [busy,setBusy] = useState<string|null>(null)
    const [error,setError] = useState<string|null>(null)
    const [dispute,setDispute] = useState<RankedQueueItem|null>(null)
    const [reason,setReason] = useState<string>("")
    const [note,setNote] = useState("")
    const disputeRequest=useRef("")
    const [completion,setCompletion] = useState<RankedQueueItem|null>(null)
    const active = useWorkspaceNavigation()?.active ?? true
    const generation = useRef(0)
    const flight = useRef(false)
    const abort = useRef<AbortController|null>(null)
    if (previousData !== data) { setPreviousData(data); if (view === data.view) setSnapshot(data) }
    useEffect(() => { generation.current++; abort.current?.abort() },[data])
    useEffect(() => () => { generation.current++; abort.current?.abort() },[])
    const [previousActive,setPreviousActive] = useState(active)
    if (previousActive !== active) { setPreviousActive(active); if (!active) { setDispute(null);setCompletion(null) } }
    const ranked = useMemo(() => rankQueue(snapshot.items),[snapshot])
    const ready = ranked.filter(x => x.state === "Ready" || x.state === "In progress")
    const featured = view === "ready" ? ready[0] : null
    const rows = view === "ready" ? ready.slice(1) : ranked.filter(x => x.state !== "Ready" && x.state !== "In progress")
    const href = (id: string) => `/${snapshot.workspaceSlug}/work-items/${id}`
    async function refresh(append = false, nextView = view) {
        if (flight.current) return
        flight.current = true; setBusy("refresh"); setError(null)
        const version = ++generation.current
        const controller = new AbortController(); abort.current = controller
        const timeout = window.setTimeout(() => controller.abort(),30000)
        try {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(data.workspaceSlug)}/panels/queue?view=${nextView}&offset=${append ? snapshot.items.length : 0}`, { headers: { "x-workspace-user":data.userId },cache:"no-store",signal:controller.signal })
            if (!response.ok || response.redirected) throw new Error("Could not refresh your queue. Please retry.")
            const next = await response.json() as PersonalQueueSnapshot
            if (next.userId !== data.userId || next.workspaceId !== data.workspaceId) throw new Error("Your session changed. Reload the workspace.")
            if (generation.current === version) { setView(nextView);setSnapshot(current => ({ ...next,items:append ? [...current.items,...next.items.filter(i => !current.items.some(x => x.id === i.id))] : next.items })) }
        } catch(e) { if (generation.current === version) setError(e instanceof Error ? e.message : "Could not refresh") }
        finally { clearTimeout(timeout); flight.current=false; setBusy(null) }
    }
    async function command(item: RankedQueueItem,action:"start"|"pause"|"complete") {
        if (flight.current) return
        flight.current=true; setBusy(item.id); setError(null)
        const version=++generation.current
        const controller=new AbortController();abort.current=controller
        const timeout=window.setTimeout(()=>controller.abort(),30000)
        try {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(data.workspaceSlug)}/queue`, { method:"POST",headers:{"Content-Type":"application/json","x-workspace-user":data.userId},body:JSON.stringify({id:item.id,action,version:item.updated_at}),signal:controller.signal })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error ?? "Could not confirm this action. Refresh before retrying.")
            if (generation.current!==version) return
            // Never invent success before the transaction acknowledges it.
            setSnapshot(current => ({...current,items: action === "complete" ? current.items.filter(x=>x.id!==item.id) : current.items.map(x=>x.id===item.id?{...x,...result}:x)}))
            setCompletion(null)
            flight.current=false
            await refresh()
        } catch(e) { if(generation.current===version) setError(e instanceof Error && e.name!=="TimeoutError" && e.name!=="AbortError" ? e.message : "The action was not confirmed. Refresh before retrying.") }
        finally { clearTimeout(timeout);flight.current=false; setBusy(null) }
    }
    const draftKey=(id:string)=>`queue-dispute:${data.workspaceId}:${data.userId}:${id}`
    function saveDisputeDraft(nextReason:string,nextNote:string){if(!dispute)return;setReason(nextReason);setNote(nextNote);try{sessionStorage.setItem(draftKey(dispute.id),JSON.stringify({reason:nextReason,note:nextNote,requestId:disputeRequest.current}))}catch{ /* Keep the mounted draft if session storage is unavailable. */ }}
    function openDispute(item: RankedQueueItem) {let draft={reason:"",note:"",requestId:crypto.randomUUID() as string};try{const saved=sessionStorage.getItem(draftKey(item.id));if(saved)draft=JSON.parse(saved)}catch{};setReason(draft.reason);setNote(draft.note);disputeRequest.current=draft.requestId;setDispute(item);setError(null)}
    async function submitDispute(){if(!dispute||flight.current)return;flight.current=true;setBusy(dispute.id);setError(null)
        try{const response=await fetch(`/api/workspaces/${encodeURIComponent(data.workspaceSlug)}/queue/feedback`,{method:"POST",headers:{"Content-Type":"application/json","x-workspace-user":data.userId},body:JSON.stringify({action:"dispute",id:dispute.id,version:dispute.updated_at,requestId:disputeRequest.current,reason,note}),signal:AbortSignal.timeout(30000)});const result=await response.json();if(!response.ok)throw new Error(result.error??"Could not confirm dispute");try{sessionStorage.removeItem(draftKey(dispute.id))}catch{};setDispute(null);flight.current=false;await refresh()}
        catch(e){setError(e instanceof Error?e.message:"The dispute was not confirmed. Retry to recover the same request.")}
        finally{flight.current=false;setBusy(null)}
    }
    const priorityLabel=(item:RankedQueueItem)=>item.priority_band===4?'Backlog':item.priority_band!==undefined?Object.values(HORIZON_LABELS)[item.priority_band]:item.assessment?.horizon?HORIZON_LABELS[item.assessment.horizon]:'Assessment pending'

    const tone = (item: RankedQueueItem) => item.state === "In progress" ? "yellow" as const : item.state === "Ready" ? "green" as const : "grey" as const
    return <>
        <PanelTabHeader title="Work Queue" description="Your ready work, ordered by value, timing and what it enables." actions={<><Link className={button} href={`/${snapshot.workspaceSlug}/queue/feedback`}>Feedback</Link><button className={button} disabled={Boolean(busy)} onClick={()=>void refresh()}>Refresh</button></>} />
        <QuickStats ariaLabel="Your queue statistics" items={[{label:"Ready",value:snapshot.ready},{label:"Waiting",value:snapshot.deferred},{label:"Open work",value:snapshot.total}]} />
        <FilterRail ariaLabel="Your work"><FilterRailButton selected={view==="ready"} disabled={Boolean(busy)} onClick={()=>void refresh(false,"ready")}>Ready <FilterRailCount>{snapshot.ready}</FilterRailCount></FilterRailButton><FilterRailButton selected={view==="deferred"} disabled={Boolean(busy)} onClick={()=>void refresh(false,"deferred")}>Waiting & scheduled <FilterRailCount>{snapshot.deferred}</FilterRailCount></FilterRailButton></FilterRail>
        {error ? <p role="alert" className="mt-5 rounded-lg border border-red-900 bg-red-950/20 p-3 text-sm text-red-200">{error}</p> : null}
        <List ariaLabel="Personal work queue">
            {featured ? <ListItem className="[content-visibility:visible]">
                <ListPrimaryRow><ListTitle href={href(featured.id)} className="flex-1">{featured.title}</ListTitle><Status label={featured.state === "In progress" ? "In progress" : priorityLabel(featured)} tone={tone(featured)} /></ListPrimaryRow>
                <ListSecondaryRow><span className="min-w-0 flex-1 truncate text-neutral-300">{featured.relationship ?? "Workspace work"}</span><ListTrailing><span className="font-mono text-neutral-500">{shortId(featured.id)}</span></ListTrailing></ListSecondaryRow>
                <div className="space-y-3 border-t border-neutral-900 px-3.5 py-4 sm:px-4" data-queue-feature>
                    {featured.description ? <p className="max-w-3xl text-sm leading-6 text-neutral-300">{featured.description}</p> : null}
                    <p className="max-w-3xl text-sm text-neutral-400">{featured.reason}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-500">
                        {featured.service ? <RoundPill tone="emerald">{featured.service}</RoundPill> : null}
                        {featured.assessment ? <span>Estimated effort: {(featured.calibrated_minutes??featured.assessment.effort_minutes)} min</span> : null}
                        {featured.assessment?.horizon_reason ? <span>{featured.assessment.horizon_reason}</span> : null}
                        {featured.assessment_status === "queued" || featured.assessment_status === "running" ? <span>Assessment pending</span> : featured.assessment_status === "failed" ? <span>Assessment unavailable</span> : null}
                        {!snapshot.aiEnabled ? <span>AI assessment is not enabled</span> : null}
                    </div>
                    {featured.assessment?.guidance ? <p className="text-sm text-neutral-300">{featured.assessment.guidance}</p> : null}
                    {featured.schedule_conflict ? <p className="text-sm text-amber-200">{featured.schedule_reason}</p> : null}
                    {featured.assessment?.uncertainty ? <p className="text-xs text-neutral-500">Estimate note: {featured.assessment.uncertainty}</p> : null}
                    <div className="flex flex-wrap gap-2">
                        {featured.status === "doing" ? <><button className={`${button} border-neutral-300 bg-neutral-100 !text-neutral-950 hover:bg-white`} disabled={Boolean(busy)} onClick={()=>setCompletion(featured)}>Complete</button><button className={button} disabled={Boolean(busy)} onClick={()=>void command(featured,"pause")}>Pause</button></> : <button className={`${button} border-neutral-300 bg-neutral-100 !text-neutral-950 hover:bg-white`} disabled={Boolean(busy)} onClick={()=>void command(featured,"start")}>{busy===featured.id?"Starting…":featured.actual_start_at?"Resume":"Accept & start"}</button>}
                        <Link href={href(featured.id)} className={button}>Instructions & assets</Link>
                        <button className={button} disabled={Boolean(busy)} onClick={()=>openDispute(featured)}>Dispute</button>
                    </div>
                </div>
            </ListItem> : null}
            {rows.map(item => {
                const actions=[{label:"Open work item",href:href(item.id)},...(item.state==="Ready" && !ready.some(x=>x.state==="In progress")?[{label:item.actual_start_at?"Resume":"Accept & start",onClick:()=>void command(item,"start")}]:[]),{label:"Dispute",onClick:()=>openDispute(item)}]
                return <ListItem key={item.id}><MobileListActionSurface actions={actions} label={`Actions for ${item.title}`}><ListPrimaryRow><ListTitle href={href(item.id)} className="flex-1">{item.title}</ListTitle><Status label={item.state==="Ready"?priorityLabel(item):item.state} tone={tone(item)} /></ListPrimaryRow><ListSecondaryRow><span className="hidden min-w-0 flex-1 truncate text-neutral-400 sm:inline">{item.relationship ? `${item.relationship} · ` : ""}{item.reason}</span>{item.assessment ? <span className="shrink-0 text-neutral-500">~{item.calibrated_minutes??item.assessment.effort_minutes}m</span> : null}<ListTrailing><span className="font-mono text-neutral-500">{shortId(item.id)}</span><span className="text-neutral-500">{formatRelativeTime(item.updated_at)}</span><ListActionMenu className="hidden sm:block" actions={actions} /></ListTrailing></ListSecondaryRow></MobileListActionSurface></ListItem>
            })}
            {!featured && !rows.length ? <p className="px-4 py-6 text-sm text-neutral-400">{view==="ready"?"No ready work is assigned to you. Check waiting work or ask your manager for an assignment.":"No waiting or scheduled work on this page."}</p> : null}
        </List>
        {snapshot.hasMore ? <button className={`${button} mt-5`} disabled={Boolean(busy)} onClick={()=>void refresh(true)}>Load more work</button> : null}
        {dispute ? <CenteredDialog title="Dispute work item" busy={Boolean(busy)} onClose={()=>setDispute(null)} footer={<button className={button} disabled={Boolean(busy)||!reason||(reason==="Other"&&!note.trim())} onClick={()=>void submitDispute()}>{busy?"Submitting…":"Submit dispute"}</button>}><p className="mb-4 text-sm text-neutral-300">{dispute.title}</p><fieldset className="space-y-1"><legend className="mb-2 text-sm text-neutral-400">What is stopping you?</legend>{DISPUTE_REASONS.map(value=><label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-neutral-900"><input type="radio" name="dispute-reason" value={value} checked={reason===value} onChange={()=>saveDisputeDraft(value,note)} />{value}</label>)}</fieldset><label className="mt-4 block text-sm text-neutral-400">{reason==="Other"?"Explanation":"Additional details (optional)"}<textarea className="mt-2 min-h-24 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-white" value={note} onChange={e=>saveDisputeDraft(reason,e.target.value)} maxLength={3000} required={reason==="Other"} /></label><p className="mt-3 text-xs text-neutral-500">Sent to your internal team for manager review. The client is not notified. Presentation preferences let you keep working.</p>{error?<p role="alert" className="mt-3 text-sm text-red-200">{error}</p>:null}</CenteredDialog> : null}
        {completion ? <CenteredDialog title="Complete work item" onClose={()=>setCompletion(null)} busy={Boolean(busy)} footer={<button className={button} disabled={Boolean(busy)} onClick={()=>void command(completion,"complete")}>{busy?"Completing…":"Confirm complete"}</button>}><p className="text-sm text-neutral-200">{completion.title}</p><p className="mt-3 text-sm leading-6 text-neutral-400">Confirm that you have followed the instructions and met the completion requirements.</p><Link href={href(completion.id)} className="mt-3 inline-block text-sm underline">Review instructions and assets</Link>{error?<p role="alert" className="mt-3 text-sm text-red-200">{error}</p>:null}</CenteredDialog> : null}
    </>
}
