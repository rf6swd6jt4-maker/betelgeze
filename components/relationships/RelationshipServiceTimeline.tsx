"use client"
import { useSopWorkRefresh } from "@/components/sops/useSopWorkRefresh"
import dynamic from "next/dynamic"
import { useCallback, useEffect, useRef, useState } from "react"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { Assignee, RoundPill, Status } from "@/components/ui"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { DetailContentLoading } from "@/components/detail"
import type { RelationshipGanttPlan } from "@/lib/relationship-gantt"
import type { RelationshipServiceRow } from "@/lib/service-stages"
import type { RelationshipQueuePage } from "@/lib/relationship-service-plan"
import { ganttSyncChannelName } from "@/lib/ui/gantt-sync"

const Gantt = dynamic(() => import("@/app/[workspaceSlug]/relationships/[relationshipId]/RelationshipGantt").then(m => m.RelationshipGantt), { loading: () => <DetailContentLoading label="Loading service timelines…" /> })
type Timeline = { userId: string; relationshipId: string; services: RelationshipServiceRow[]; hasMore: boolean; plan: RelationshipGanttPlan; workTruncated: boolean }
async function get<T>(endpoint: string, userId: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(endpoint,{signal:AbortSignal.any([signal,AbortSignal.timeout(30_000)]),cache:"no-store",credentials:"same-origin",redirect:"error",headers:{"x-workspace-user":userId}})
    if (!response.ok) throw new Error([401,403,409].includes(response.status) ? "Your access changed. Reload the relationship." : "Could not load relationship work. Retry when connected.")
    return response.json()
}
function Paging({ page, hasMore, change }: {page:number;hasMore:boolean;change:(n:number)=>void}) {
    return page || hasMore ? <div className="mt-2 flex items-center justify-between gap-3 text-sm"><button disabled={!page} className="min-h-11 px-2 disabled:opacity-40" onClick={() => change(page-1)}>Previous</button><span className="text-neutral-500">Page {page+1}</span><button disabled={!hasMore} className="min-h-11 px-2 disabled:opacity-40" onClick={() => change(page+1)}>Next</button></div> : null
}
export function RelationshipQueue({ endpoint, slug, relationshipId, userId, revision, publishedQueue, onGeneration }: {endpoint:string;slug:string;relationshipId:string;userId:string;revision:unknown;publishedQueue?:RelationshipQueuePage|null;onGeneration?:(instanceId:string)=>void}) {
    const active = useWorkspaceNavigation()?.active ?? true
    const host = useRef<HTMLDivElement>(null)
    const inFlight = useRef<AbortController | null>(null)
    const [visible,setVisible] = useState(false)
    const [page,setPage] = useState(0)
    const [data,setData] = useState<RelationshipQueuePage | null>(null)
    const [error,setError] = useState("")
    const [retry,setRetry] = useState(0)
    const [receivedQueue, setReceivedQueue] = useState(publishedQueue)
    const presented = useRef(new Set<string>())
    useEffect(() => {
        const run = data?.generation?.find(run => run.status !== "published" && !presented.current.has(run.instance_id))
        if (run && onGeneration) { presented.current.add(run.instance_id); onGeneration(run.instance_id) }
    }, [data, onGeneration])
    if (publishedQueue !== receivedQueue) { setReceivedQueue(publishedQueue); if (publishedQueue) { setData(publishedQueue); setPage(0); setError("") } }
    useEffect(() => { const observer = new IntersectionObserver(entries => { setVisible(entries.some(e => e.isIntersecting)) },{rootMargin:"160px"}); if(host.current)observer.observe(host.current); return () => observer.disconnect() },[])
    useEffect(() => {
        if(!visible || !active)return
        const controller = new AbortController()
        inFlight.current = controller
        void get<RelationshipQueuePage>(`${endpoint}?kind=queue&offset=${page*30}`,userId,controller.signal).then(value => {if(!controller.signal.aborted){setData(value);setError("")}}).catch(e => {if(!controller.signal.aborted)setError(e.message)}).finally(() => { if (inFlight.current === controller) inFlight.current = null })
        return () => { controller.abort(); if (inFlight.current === controller) inFlight.current = null }
    },[endpoint,userId,page,revision,visible,active,retry,publishedQueue])
    useEffect(() => {if(typeof BroadcastChannel === "undefined")return;const channel=new BroadcastChannel(ganttSyncChannelName(slug));channel.onmessage=()=>setRetry(n=>n+1);return()=>channel.close()},[slug])
    useSopWorkRefresh(Boolean(data?.generation?.some(run => ["pending", "queued", "running"].includes(run.status))), visible, () => { if (!inFlight.current) setRetry(n => n + 1) })
    return <div ref={host} className="flex h-full min-h-0 flex-col" aria-label="Relationship work queue"><h2 className="mb-3 shrink-0 text-base font-semibold">Queue</h2>

        {error ? <p role="alert" className="py-2 text-sm text-red-200">{error}<button className="ml-2 min-h-11 underline" onClick={()=>setRetry(n=>n+1)}>Retry</button></p> : null}
        {!data ? <p role="status" className="py-5 text-sm text-neutral-500">Loading work queue…</p> : <div className="flex min-h-0 flex-1 flex-col"><List ariaLabel="Relationship work queue" className="!mt-0 min-h-0 flex-1 !overflow-y-auto">{data.items.length ? data.items.map(item => {
            const href = item.workflow_action === "sell_client" ? `/${slug}/relationships/${relationshipId}/pos` : `/${slug}/work-items/${item.id}`
            const creatorName = item.automated ? "BE automation" : item.creator?.username
            return <ListItem key={item.id}><ListPrimaryRow><ListTitle href={href}>{item.title}</ListTitle><ListTrailing><Status label={item.queue_state} tone={item.queue_state === "Blocked" ? "red" : ["Waiting","Scheduled"].includes(item.queue_state) ? "yellow" : "green"} /></ListTrailing></ListPrimaryRow><ListSecondaryRow><span className="flex min-w-0 items-center gap-2 overflow-hidden">{item.services[0] ? <RoundPill tone="emerald" className="min-w-0 shrink">{item.services[0]}</RoundPill> : null}{item.services.length > 1 ? <span className="shrink-0 text-xs text-neutral-500">+{item.services.length - 1}</span> : null}{item.assignees[0] ? <Assignee name={item.assignees[0].username} userId={item.assignees[0].userId} className="min-w-0" /> : <span className="text-neutral-500">Unassigned</span>}{item.assignees.length > 1 ? <span className="shrink-0 text-xs text-neutral-500">+{item.assignees.length - 1}</span> : null}</span><ListTrailing>{item.due_date ? <span className="text-neutral-500">Due {new Date(`${item.due_date}T12:00:00`).toLocaleDateString("en-IE",{day:"numeric",month:"short"})}</span> : null}{creatorName ? <span className="hidden sm:inline-flex" title={`${item.automated ? "Generated by" : "Created by"} ${creatorName} · ${new Date(item.created_at).toLocaleString("en-IE")}`}><Assignee name={creatorName} userId={item.automated ? null : item.creator?.userId} avatarSrc={item.automated ? "/brand/betelgeze-logo.svg" : item.creator?.avatarUrl} compact compactSize="md" /></span> : null}</ListTrailing></ListSecondaryRow></ListItem>
        }) : <p className="px-4 py-5 text-sm text-neutral-500">No open work for this relationship.</p>}</List><Paging page={page} hasMore={data.hasMore} change={next=>{setPage(next);setData(null)}} /></div>}
    </div>
}
export function RelationshipServiceTimeline({endpoint,workspaceSlug,relationshipId,userId,revision,canEdit,canEditService,onEditService}: {
    endpoint:string;workspaceSlug:string;relationshipId:string;userId:string;revision:unknown;canEdit:boolean;canEditService:(row:RelationshipServiceRow)=>boolean;onEditService:(row:RelationshipServiceRow)=>void
}) {
    const navigation=useWorkspaceNavigation()
    const active=navigation?.active ?? true
    const host=useRef<HTMLDivElement>(null)
    const [visible,setVisible]=useState(false)
    const [page,setPage]=useState(0)
    const [data,setData]=useState<Timeline | null>(null)
    const [error,setError]=useState("")
    const [retry,setRetry]=useState(0)
    const source=useRef<{revision:unknown;page:number}|null>(null)
    useEffect(()=>{const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:"200px"});if(host.current)observer.observe(host.current);return()=>observer.disconnect()},[])
    const readPlan=useCallback(async(signal:AbortSignal)=>{
        const value=await get<Timeline>(`${endpoint}?kind=timeline&offset=${page*30}`,userId,signal)
        if(value.userId!==userId || value.relationshipId!==relationshipId)throw new Error("Your session changed. Reload this relationship.")
        if(!signal.aborted){setData(value);setError("");source.current={revision,page}}
        return value.plan
    },[endpoint,page,relationshipId,revision,userId])
    useEffect(()=>{
        if(!visible || !active || source.current?.revision===revision && source.current?.page===page && !retry)return
        const controller=new AbortController()
        void readPlan(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message)})
        return()=>controller.abort()
    },[visible,active,readPlan,revision,page,retry])
    return <div ref={host}>
        {error ? <p role="alert" className="py-3 text-sm text-red-200">{error}<button className="ml-2 min-h-11 underline" onClick={()=>setRetry(n=>n+1)}>Retry</button></p> : null}
        {data ? <>
            <Gantt workspaceSlug={workspaceSlug} relationshipId={relationshipId} userId={userId} plan={data.plan} canEdit={canEdit} serviceMode readPlan={readPlan} canEditService={id=>Boolean(data.services.find(s=>s.id===id && canEditService(s)))} onEditService={id=>{const row=data.services.find(s=>s.id===id);if(row && canEditService(row))onEditService(row)}} />
            {!data.services.length ? <p className="py-3 text-sm text-neutral-500">No services assigned yet. Add one from your catalogue.</p> : null}
            <Paging page={page} hasMore={data.hasMore} change={next=>{setPage(next);setData(null)}} />
            {data.workTruncated ? <p className="py-2 text-xs text-neutral-500">Showing the first 500 work items in the chart. The queue below includes all accessible open work across its pages.</p> : null}
        </> : <DetailContentLoading label="Loading service timelines…" />}
    </div>
}
