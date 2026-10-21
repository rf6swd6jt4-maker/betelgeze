"use client"
import {useCallback,useEffect,useMemo,useRef,useState} from "react"
import { Selector } from "@/components/ui/Selector"
import { Status } from "@/components/ui/Status"
import {List,ListItem,ListPrimaryRow,ListSecondaryRow,ListTitle} from "@/components/list/List"
import {PortalSection} from "./ClientPortalUI"
import {dateKey,monthDays,shiftMonth,validMonth,groupCalendarEvents,type GhlCalendarState} from "@/lib/client-portal/ghl-calendar"
import {calendarNeedsRefresh,CALENDAR_READ_INTERVAL_MS} from "@/lib/client-portal/ghl-calendar-freshness"
import dynamic from "next/dynamic"
import type { AppointmentSummary } from "@/lib/client-portal/appointment-summary"
import styles from "./ClientPortalCalendar.module.css"
const AppointmentDetails=dynamic(()=>import("./ClientPortalAppointmentDetails").then(module=>module.ClientPortalAppointmentDetails))
const control="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-[var(--onboarding-primary,#1E3A5F)] hover:bg-black/5 focus-visible:outline-2 disabled:opacity-40"
export function ClientPortalCalendar({token,active}:{token:string;active:boolean}) {
 const [state,setState]=useState<GhlCalendarState|null>(null),[month,setMonth]=useState(()=>dateKey(new Date(),"UTC").slice(0,7)),[day,setDay]=useState<string|null>(null)
 const [calendarId,setCalendarId]=useState("")
 const [appointment,setAppointment]=useState<{id:string;title:string;summary:AppointmentSummary|null;error:string|null}|null>(null)
 const detailsOpen=Boolean(appointment)
 const detailController=useRef<AbortController|null>(null)
 const monthRef=useRef(month)
 const refreshController=useRef<AbortController|null>(null),lastQueued=useRef(new Map<string,number>())
 const selectedCalendar=useRef("")
 const cacheKey=(id:string|undefined,value:string)=>`${id??"owner"}:${value}`
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
 const lastProviderAttempt=useRef(0)
 const controller=useRef<AbortController|null>(null),generation=useRef(0),lastRead=useRef(0),mounted=useRef(true)
 const [cache,setCache]=useState(new Map<string,GhlCalendarState>())
 const connectionRevision=useRef<string|null>(null),initialized=useRef(false)
 const namesController=useRef<AbortController|null>(null),[namesBusy,setNamesBusy]=useState<string|null>(null),[namesError,setNamesError]=useState<string|null>(null)
 const api=`/api/client-portal/session/${token}/connections/ghl/calendar`
 // Optional name enrichment has its own request; it never holds calendar navigation busy.
 const loadNames=useCallback(async(base:GhlCalendarState,version:number)=>{
  if(!base.snapshot?.snapshotId||!base.refreshedAt||base.snapshot.namesStatus!=="pending")return
  namesController.current?.abort();const request=new AbortController();namesController.current=request
  setNamesBusy(base.snapshot.snapshotId);setNamesError(null)
  const timeout=window.setTimeout(()=>request.abort(),25000)
  try{
   const response=await fetch(`${api}/names`,{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({snapshotId:base.snapshot.snapshotId}),signal:request.signal})
   const value=await response.json();if(!response.ok)throw new Error("Contact details could not be updated. Original GHL titles are shown.")
   const enriched=value as GhlCalendarState
   if(!mounted.current||version!==generation.current||request.signal.aborted||enriched.revision!==base.revision||enriched.snapshot?.snapshotId!==base.snapshot.snapshotId||enriched.snapshot?.owner.id!==base.snapshot.owner.id)return
   // Name enrichment owns labels only. Its legacy snapshot cannot roll back
   // retained appointment times, versions, status or range freshness.
   const labels=new Map(enriched.snapshot.events.map(event=>[event.id,event]))
   const updated={...base,snapshot:{...base.snapshot,namesStatus:enriched.snapshot.namesStatus,events:base.snapshot.events.map(event=>{
    const label=labels.get(event.id);return label?.originalTitle?{...event,title:label.title,originalTitle:event.originalTitle??event.title,...(label.contactCity?{contactCity:label.contactCity}:{})}:event
   })}}
   setState(previous=>previous?.snapshot?.snapshotId===base.snapshot?.snapshotId&&previous?.revision===base.revision?updated:previous)
   setCache(previous=>{const entry=previous.get(cacheKey(base.snapshot!.calendarId,base.snapshot!.month));if(entry?.snapshot?.snapshotId!==base.snapshot?.snapshotId||entry?.revision!==base.revision)return previous;const next=new Map(previous);next.set(cacheKey(base.snapshot!.calendarId,base.snapshot!.month),updated);return next})
  }catch{if(mounted.current&&version===generation.current&&!request.signal.aborted)setNamesError(base.snapshot.snapshotId)}
  finally{window.clearTimeout(timeout);if(namesController.current===request){namesController.current=null;if(mounted.current)setNamesBusy(null)}}
 },[api])
 const load=useCallback(async(refresh=false,nextMonth?:string,nextCalendar=selectedCalendar.current)=>{
  if(controller.current)return
  const request=new AbortController();controller.current=request;const version=++generation.current
  namesController.current?.abort();namesController.current=null;setNamesBusy(null);setNamesError(null)
  setBusy(refresh||!initialized.current);setError(null);lastRead.current=Date.now()
  const timeout=window.setTimeout(()=>request.abort(),30000)
  try{
   if(refresh){
    // Honour the existing server cooldown when quickly switching calendars.
    const delay=Math.max(0,lastProviderAttempt.current+2100-Date.now())
    if(delay)await new Promise<void>((resolve,reject)=>{const timer=window.setTimeout(()=>{request.signal.removeEventListener("abort",cancel);resolve()},delay);const cancel=()=>{window.clearTimeout(timer);reject(new DOMException("Calendar request cancelled.","AbortError"))};request.signal.addEventListener("abort",cancel,{once:true})})
    if(request.signal.aborted)return
   }
   const query=new URLSearchParams({month:nextMonth??monthRef.current,...(nextCalendar?{calendarId:nextCalendar}:{})})
   const response=await fetch(api+(refresh?"":`?${query}`),{method:refresh?"POST":"GET",cache:"no-store",signal:request.signal,...(refresh?{headers:{"Content-Type":"application/json"},body:JSON.stringify({month:nextMonth??monthRef.current,...(nextCalendar?{calendarId:nextCalendar}:{})})}:{})})
   if(refresh)lastProviderAttempt.current=Date.now()
   const value=await response.json();if(!response.ok){if([401,403,404].includes(response.status)&&mounted.current&&version===generation.current){setState(null);setCache(new Map());setAppointment(null);detailController.current?.abort();connectionRevision.current=null;selectedCalendar.current="";setCalendarId("")}throw new Error(value.error||"The calendar could not be loaded.")}
   if(!mounted.current||version!==generation.current)return
   const saved=value as GhlCalendarState;setState(saved)
   const choices=saved.calendars??[]
   if(!selectedCalendar.current||!choices.some(item=>item.id===selectedCalendar.current)){selectedCalendar.current=choices.find(item=>item.id===saved.snapshot?.calendarId)?.id??choices[0]?.id??"";setCalendarId(selectedCalendar.current)}
   const identity=`${saved.revision}`
   const changed=connectionRevision.current!==identity;connectionRevision.current=identity
   if(changed){setCache(new Map());setAppointment(null);detailController.current?.abort();lastQueued.current.clear()}
   if(saved.snapshot){
    const s=saved.snapshot;setCache(previous=>{const next=new Map(previous);next.set(cacheKey(s.calendarId,s.month),saved);while(next.size>6)next.delete(next.keys().next().value!);return next})
    if(refresh){monthRef.current=s.month;setMonth(s.month)}
    else if(!initialized.current||changed){const current=dateKey(new Date(),s.timezone).slice(0,7);monthRef.current=current;setMonth(current)}
    initialized.current=true
    if(refresh)void loadNames(saved,version)
   }
  }catch(problem){if(mounted.current&&version===generation.current)setError(problem instanceof Error&&problem.name!=="AbortError"?problem.message:"The calendar took too long to load. Please try again.")}
  finally{window.clearTimeout(timeout);if(controller.current===request)controller.current=null;if(mounted.current&&version===generation.current)setBusy(false)}
 },[api,loadNames])
 useEffect(()=>{mounted.current=true;const requestGeneration=generation;return()=>{mounted.current=false;requestGeneration.current++;controller.current?.abort();controller.current=null;namesController.current?.abort();refreshController.current?.abort();detailController.current?.abort()}},[])
 useEffect(()=>{const refresh=()=>{if(active&&!detailsOpen&&document.visibilityState==="visible"&&(lastRead.current===0||Date.now()-lastRead.current>=CALENDAR_READ_INTERVAL_MS))void load()};refresh();window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);const timer=active&&!detailsOpen?window.setInterval(refresh,CALENDAR_READ_INTERVAL_MS):null;return()=>{if(timer!==null)window.clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh)}},[active,detailsOpen,load])
 const [localTimezone]=useState(()=>Intl.DateTimeFormat().resolvedOptions().timeZone)
 const snapshot=state?.snapshot
 const days=useMemo(()=>monthDays(month),[month])
 const {displayed,timezone,events}=useMemo(()=>{
  const saved=state?.snapshot
  const displayed=cache.get(`${calendarId||"owner"}:${month}`)??(saved?.month===month&&(!calendarId||saved.calendarId===calendarId)?state:null)
  const timezone=displayed?.snapshot?.timezone??saved?.timezone??localTimezone
  return {displayed,timezone,events:groupCalendarEvents(displayed?.snapshot?.events??[],timezone,days)}
 },[cache,calendarId,month,state,localTimezone,days])
 const today=dateKey(new Date(),timezone)
 // Acceptance is durable before showing queued state; provider work stays off
 // initial navigation. One foreground range request, bounded to the six caches.
 useEffect(()=>{
  if(!active||detailsOpen||document.visibilityState!=="visible"||!state||controller.current||refreshController.current||!calendarNeedsRefresh(displayed))return
  const key=`${state.revision}:${calendarId}:${month}`,now=Date.now()
  if(now-(lastQueued.current.get(key)??0)<5*60_000)return
  lastQueued.current.set(key,now);while(lastQueued.current.size>6)lastQueued.current.delete(lastQueued.current.keys().next().value!)
  const request=new AbortController();refreshController.current=request;const version=generation.current
  const timer=window.setTimeout(()=>request.abort(),30000)
  void (async()=>{try{
   const response=await fetch(api,{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({month,background:true,...(calendarId?{calendarId}:{})}),signal:request.signal})
   const value=await response.json();if(!response.ok){if([401,403,404].includes(response.status)&&mounted.current&&version===generation.current){setState(null);setCache(new Map());setAppointment(null);detailController.current?.abort();connectionRevision.current=null;selectedCalendar.current="";setCalendarId("")}throw new Error(value.error||"The calendar refresh could not be queued.")}
   if(!mounted.current||request.signal.aborted||version!==generation.current)return
   const saved=value as GhlCalendarState;setState(saved)
   const identity=`${saved.revision}`
   if(connectionRevision.current!==identity){connectionRevision.current=identity;setCache(new Map());setAppointment(null);detailController.current?.abort();lastQueued.current.clear()}
   if(!(saved.calendars??[]).some(item=>item.id===selectedCalendar.current)){selectedCalendar.current=saved.calendars?.[0]?.id??"";setCalendarId(selectedCalendar.current)}
   if(saved.snapshot)setCache(previous=>{const next=new Map(previous);next.set(cacheKey(saved.snapshot!.calendarId,saved.snapshot!.month),saved);return next})
  }catch(problem){if(mounted.current&&!request.signal.aborted&&version===generation.current)setError(problem instanceof Error?problem.message:"Calendar refresh unavailable.")}
  finally{window.clearTimeout(timer);if(refreshController.current===request)refreshController.current=null}})()
 },[active,api,calendarId,detailsOpen,displayed,month,state])
 const ready=Boolean(displayed?.snapshot?.owner.id)
 const selectedDay=day&&days.includes(day)?day:month===today.slice(0,7)?today:`${month}-01`
 const time=(value:string)=>new Intl.DateTimeFormat(undefined,{timeZone:timezone,hour:"numeric",minute:"2-digit"}).format(new Date(value))
 const monthLabel=new Intl.DateTimeFormat(undefined,{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(month+"-01T12:00:00Z"))
 const selectMonth=(value:string)=>{if(busy||!validMonth(value))return;monthRef.current=value;setMonth(value);setDay(null);setAppointment(null);detailController.current?.abort();setError(null);if(calendarNeedsRefresh(cache.get(cacheKey(selectedCalendar.current||undefined,value))))void load(false,value)}
 const selectCalendar=(id:string)=>{if(busy||id===selectedCalendar.current)return;selectedCalendar.current=id;setCalendarId(id);setDay(null);setAppointment(null);detailController.current?.abort();setError(null);namesController.current?.abort();namesController.current=null;setNamesBusy(null);setNamesError(null);generation.current++;if(calendarNeedsRefresh(cache.get(cacheKey(id,month))))void load(false,month,id)}
 const openAppointment=async(id:string,title:string)=>{
  detailController.current?.abort();const request=new AbortController();detailController.current=request
  setAppointment({id,title,summary:null,error:null});let timedOut=false;const timer=window.setTimeout(()=>{timedOut=true;request.abort()},30000)
  try{const response=await fetch(`${api.replace(/\/calendar$/,"")}/appointments/${encodeURIComponent(id)}?calendarId=${encodeURIComponent(calendarId)}`,{cache:"no-store",signal:request.signal});const value=await response.json();if(!response.ok){if([401,403,404].includes(response.status)&&value.code!=="not_retained"&&mounted.current&&detailController.current===request){setState(null);setCache(new Map());setAppointment(null);connectionRevision.current=null;selectedCalendar.current="";setCalendarId("");setError(value.error||"This portal is no longer available.");request.abort();return}throw new Error(value.code==="not_retained"?"Appointment details are still syncing. Please retry shortly.":value.error||"Appointment details could not be loaded.")}if(mounted.current&&!request.signal.aborted&&detailController.current===request)setAppointment({id,title,summary:value.summary,error:null})}
  catch(problem){if(mounted.current&&detailController.current===request&&(!request.signal.aborted||timedOut))setAppointment({id,title,summary:null,error:problem instanceof Error&&problem.name!=="AbortError"?problem.message:"Appointment details took too long to load. Please retry."})}
  finally{window.clearTimeout(timer);if(detailController.current===request)detailController.current=null}
 }
 return <PortalSection id="appointments" title="Your calendar" description="Appointments from your connected calendars." icon="calendar">
  {appointment?<div className="mt-4"><button className={control} onClick={()=>{detailController.current?.abort();setAppointment(null)}}>← Back to calendar</button>{appointment.summary?<AppointmentDetails summary={appointment.summary}/>:<div className="py-4"><h3 className="font-semibold">{appointment.title}</h3>{appointment.error?<><p role="alert" className="mt-2 text-sm text-red-700">{appointment.error}</p><button className={control} onClick={()=>void openAppointment(appointment.id,appointment.title)}>Retry details</button></>:<p role="status" className="mt-2 text-sm">Loading appointment details…</p>}</div>}</div>:null}
  <div className="mt-4" aria-busy={busy} hidden={Boolean(appointment)}>
   {(state?.calendars?.length??0)>1?<div className="mb-3"><Selector surface="light" appearance="input" ariaLabel="Portal calendar" value={calendarId} disabled={busy} options={state!.calendars!.map(item=>({value:item.id,label:item.name}))} onChange={selectCalendar}/></div>:null}
   <div className="flex flex-wrap items-center justify-between gap-1 pb-2"><h3 aria-live="polite" className="text-base font-semibold">{monthLabel}</h3><div className="flex items-center"><button className={control} onClick={()=>selectMonth(today.slice(0,7))} disabled={busy}>Today</button><button data-icon-button className={`${control} h-11 w-11 px-0`} aria-label="Previous month" onClick={()=>selectMonth(shiftMonth(month,-1))} disabled={busy}><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m14 6-6 6 6 6"/></svg></button><button data-icon-button className={`${control} h-11 w-11 px-0`} aria-label="Next month" onClick={()=>selectMonth(shiftMonth(month,1))} disabled={busy}><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m10 6 6 6-6 6"/></svg></button></div></div>
   <div className={styles.weekdays} aria-hidden="true">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><span key={d}>{d}</span>)}</div>
   <div className={styles.grid} role="group" aria-label={`${monthLabel} calendar`}>
    {days.map(key=>{const appointments=events.get(key)??[];const selected=key===selectedDay;return <button key={key} data-icon-button type="button" aria-pressed={selected} aria-label={`${new Intl.DateTimeFormat(undefined,{dateStyle:"full",timeZone:"UTC"}).format(new Date(key+"T12:00:00Z"))}${ready?`, ${appointments.length} event${appointments.length===1?"":"s"}`:", appointments not loaded"}`} onClick={()=>setDay(key)} className={`${styles.day} ${key.slice(0,7)!==month?styles.outside:""} ${selected?styles.selected:""}`}><span className={`${styles.number} ${key===today?styles.today:""}`}>{Number(key.slice(8))}</span><span className={styles.eventArea}>{appointments.slice(0,2).map(e=><span key={e.id} className={`${styles.event} ${e.kind==="busy"?styles.busy:""} ${["cancelled","canceled"].includes(e.status)?styles.cancelled:""}`}><span className={styles.time}>{e.allDay?"All day":time(e.start)}</span><span className={styles.title}>{e.title}</span></span>)}{appointments.length>2?<span className={styles.more}>+{appointments.length-2} more</span>:null}</span>{appointments.length>0?<span className={styles.mobileCount}>{appointments.length} <span className="sr-only">events</span></span>:null}</button>})}
   </div>
   {error||(displayed??state)?.error?<p role="alert" className="mt-3 text-sm leading-5 text-red-700">{error||(displayed??state)?.error}</p>:null}
   {!ready?<p role="status" className="mt-4 text-sm text-[var(--onboarding-muted,#475569)]">{busy||state?.busy?"Loading calendar…":"Load your GHL appointments to fill this calendar."}</p>:<div className="mt-4"><h4 className="text-sm font-semibold">{new Intl.DateTimeFormat(undefined,{weekday:"long",month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(selectedDay+"T12:00:00Z"))}</h4>{events.get(selectedDay)?.length?<List embedded surface="light" ariaLabel="Schedule on selected day" className="mt-2">{events.get(selectedDay)!.map(e=><ListItem key={e.id}><ListPrimaryRow><ListTitle className={`flex-1 ${["cancelled","canceled"].includes(e.status)?"line-through":""}`}>{e.kind==="appointment"&&calendarId?<button type="button" className="min-h-11 text-left underline-offset-4 hover:underline" onClick={()=>void openAppointment(e.id,e.title)}>{e.title}</button>:e.title}</ListTitle>{["cancelled","canceled"].includes(e.status)?<Status surface="light" tone="grey" label="Cancelled"/>:null}</ListPrimaryRow>{e.originalTitle?<ListSecondaryRow><span title={e.originalTitle} className="min-w-0 truncate text-[var(--onboarding-muted,#475569)]">{e.originalTitle}</span></ListSecondaryRow>:null}{e.contactCity?<ListSecondaryRow><span className="text-[var(--onboarding-muted,#475569)]">Contact location: {e.contactCity}</span></ListSecondaryRow>:null}<ListSecondaryRow><time dateTime={e.start} className="text-[var(--onboarding-muted,#475569)]">{e.allDay?"All day":`${time(e.start)} – ${time(e.end)}`}</time></ListSecondaryRow></ListItem>)}</List>:<p className="mt-2 text-sm text-[var(--onboarding-muted,#475569)]">{displayed?.complete===false?"This date range is still incomplete.":calendarNeedsRefresh(displayed)||displayed?.busy?"No appointments in the saved view. Checking for updates…":"Nothing scheduled on this day."}</p>}</div>}
   {displayed?.busy?<p role="status" className="mt-2 text-xs text-[var(--onboarding-muted,#475569)]">Checking GHL for calendar updates…</p>:calendarNeedsRefresh(displayed)&&ready?<p role="status" className="mt-2 text-xs text-[var(--onboarding-muted,#475569)]">Showing your saved calendar while updates are requested.</p>:null}
   {displayed?.detailsPending?<p className="mt-2 text-xs text-[var(--onboarding-muted,#475569)]">Calendar changes and appointment details are syncing.</p>:null}
   {namesBusy&&namesBusy===displayed?.snapshot?.snapshotId?<p role="status" className="mt-2 text-xs text-[var(--onboarding-muted,#475569)]">Adding contact details…</p>:namesError&&namesError===displayed?.snapshot?.snapshotId||displayed?.snapshot?.namesStatus==="unavailable"?<p className="mt-2 text-xs text-[var(--onboarding-muted,#475569)]">Contact details unavailable. Original GHL titles are shown; refresh to retry.</p>:displayed?.snapshot?.namesStatus==="pending"?<p className="mt-2 text-xs text-[var(--onboarding-muted,#475569)]">Refresh to add contact details.</p>:null}
   <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 border-t border-black/10 pt-1"><p className="text-xs text-[var(--onboarding-muted,#475569)]">{timezone.replaceAll("_"," ")}{displayed?.refreshedAt?` · Last checked with GHL ${new Intl.DateTimeFormat(undefined,{timeZone:timezone,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(displayed.refreshedAt))}`:""}</p><button className={control} disabled={busy} onClick={()=>void load(true,month)}>{busy?"Updating…":snapshot?"Refresh":"Load calendar"}</button></div>
  </div>
 </PortalSection>
}
