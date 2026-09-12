"use client"
import {useCallback,useEffect,useMemo,useRef,useState} from "react"
import { Status } from "@/components/ui/Status"
import {List,ListItem,ListPrimaryRow,ListSecondaryRow,ListTitle} from "@/components/list/List"
import {PortalSection} from "./ClientPortalUI"
import {dateKey,monthDays,shiftMonth,validMonth,groupCalendarEvents,type GhlCalendarState} from "@/lib/client-portal/ghl-calendar"
import styles from "./ClientPortalCalendar.module.css"
const control="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-[var(--onboarding-primary,#1E3A5F)] hover:bg-black/5 focus-visible:outline-2 disabled:opacity-40"
export function ClientPortalCalendar({token,active}:{token:string;active:boolean}) {
 const [state,setState]=useState<GhlCalendarState|null>(null),[month,setMonth]=useState(()=>dateKey(new Date(),"UTC").slice(0,7)),[day,setDay]=useState<string|null>(null)
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
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
   const updated=value as GhlCalendarState
   if(!mounted.current||version!==generation.current||request.signal.aborted||updated.revision!==base.revision||updated.snapshot?.snapshotId!==base.snapshot.snapshotId||updated.snapshot?.owner.id!==base.snapshot.owner.id)return
   setState(previous=>previous?.snapshot?.snapshotId===base.snapshot?.snapshotId&&previous?.revision===base.revision?updated:previous)
   setCache(previous=>{const entry=previous.get(base.snapshot!.month);if(entry?.snapshot?.snapshotId!==base.snapshot?.snapshotId||entry?.revision!==base.revision)return previous;const next=new Map(previous);next.set(base.snapshot!.month,updated);return next})
  }catch{if(mounted.current&&version===generation.current&&!request.signal.aborted)setNamesError(base.snapshot.snapshotId)}
  finally{window.clearTimeout(timeout);if(namesController.current===request){namesController.current=null;if(mounted.current)setNamesBusy(null)}}
 },[api])
 const load=useCallback(async(refresh=false,nextMonth?:string)=>{
  if(controller.current)return
  const request=new AbortController();controller.current=request;const version=++generation.current
  namesController.current?.abort();namesController.current=null;setNamesBusy(null);setNamesError(null)
  setBusy(true);setError(null);lastRead.current=Date.now()
  const timeout=window.setTimeout(()=>request.abort(),30000)
  try{
   const response=await fetch(api,{method:refresh?"POST":"GET",cache:"no-store",signal:request.signal,...(refresh?{headers:{"Content-Type":"application/json"},body:JSON.stringify({month:nextMonth})}:{})})
   const value=await response.json();if(!response.ok)throw new Error(value.error||"The calendar could not be loaded.")
   if(!mounted.current||version!==generation.current)return
   const saved=value as GhlCalendarState;setState(saved)
   const identity=`${saved.revision}:${saved.snapshot?.owner.id??""}`
   const changed=connectionRevision.current!==identity;connectionRevision.current=identity
   if(changed)setCache(new Map())
   if(saved.snapshot){
    const s=saved.snapshot;setCache(previous=>{const next=new Map(previous);next.set(s.month,saved);while(next.size>6)next.delete(next.keys().next().value!);return next})
    if(refresh){setMonth(s.month)}
    else if(!initialized.current||changed){setMonth(dateKey(new Date(),s.timezone).slice(0,7))}
    initialized.current=true
    if(refresh)void loadNames(saved,version)
   }
  }catch(problem){if(mounted.current&&version===generation.current)setError(problem instanceof Error&&problem.name!=="AbortError"?problem.message:"The calendar took too long to load. Please try again.")}
  finally{window.clearTimeout(timeout);if(controller.current===request)controller.current=null;if(mounted.current&&version===generation.current)setBusy(false)}
 },[api,loadNames])
 useEffect(()=>{mounted.current=true;const requestGeneration=generation;return()=>{mounted.current=false;requestGeneration.current++;controller.current?.abort();controller.current=null;namesController.current?.abort()}},[])
 useEffect(()=>{const refresh=()=>{if(active&&document.visibilityState==="visible"&&(lastRead.current===0||Date.now()-lastRead.current>60000))void load()};refresh();window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);return()=>{window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh)}},[active,load])
 const [localTimezone]=useState(()=>Intl.DateTimeFormat().resolvedOptions().timeZone)
 const snapshot=state?.snapshot,timezone=snapshot?.timezone??localTimezone
 const today=dateKey(new Date(),timezone),days=useMemo(()=>monthDays(month),[month])
 const displayed=cache.get(month)??(snapshot?.month===month?state:null)
 const ready=Boolean(displayed?.snapshot?.owner.id)
 const events=useMemo(()=>groupCalendarEvents(displayed?.snapshot?.events??[],timezone,days),[displayed,timezone,days])
 const selectedDay=day&&days.includes(day)?day:month===today.slice(0,7)?today:`${month}-01`
 const time=(value:string)=>new Intl.DateTimeFormat(undefined,{timeZone:timezone,hour:"numeric",minute:"2-digit"}).format(new Date(value))
 const monthLabel=new Intl.DateTimeFormat(undefined,{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(month+"-01T12:00:00Z"))
 const selectMonth=(value:string)=>{if(busy||!validMonth(value))return;setMonth(value);setDay(null);setError(null);if(!cache.has(value))void load(true,value)}
 return <PortalSection id="appointments" title="Your calendar" description="Appointments from GHL, all in one view." icon="calendar">
  <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-busy={busy}>
   <div className="flex flex-wrap items-center justify-between gap-1 pb-2"><h3 aria-live="polite" className="text-base font-semibold">{monthLabel}</h3><div className="flex items-center"><button className={control} onClick={()=>selectMonth(today.slice(0,7))} disabled={busy}>Today</button><button data-icon-button className={`${control} h-11 w-11 px-0`} aria-label="Previous month" onClick={()=>selectMonth(shiftMonth(month,-1))} disabled={busy}><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m14 6-6 6 6 6"/></svg></button><button data-icon-button className={`${control} h-11 w-11 px-0`} aria-label="Next month" onClick={()=>selectMonth(shiftMonth(month,1))} disabled={busy}><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m10 6 6 6-6 6"/></svg></button></div></div>
   <div className={styles.weekdays} aria-hidden="true">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><span key={d}>{d}</span>)}</div>
   <div className={styles.grid} role="group" aria-label={`${monthLabel} calendar`}>
    {days.map(key=>{const appointments=events.get(key)??[];const selected=key===selectedDay;return <button key={key} data-icon-button type="button" aria-pressed={selected} aria-label={`${new Intl.DateTimeFormat(undefined,{dateStyle:"full",timeZone:"UTC"}).format(new Date(key+"T12:00:00Z"))}${ready?`, ${appointments.length} event${appointments.length===1?"":"s"}`:", appointments not loaded"}`} onClick={()=>setDay(key)} className={`${styles.day} ${key.slice(0,7)!==month?styles.outside:""} ${selected?styles.selected:""}`}><span className={`${styles.number} ${key===today?styles.today:""}`}>{Number(key.slice(8))}</span><span className={styles.eventArea}>{appointments.slice(0,2).map(e=><span key={e.id} className={`${styles.event} ${e.kind==="busy"?styles.busy:""} ${["cancelled","canceled"].includes(e.status)?styles.cancelled:""}`}><span className={styles.time}>{e.allDay?"All day":time(e.start)}</span><span className={styles.title}>{e.title}</span></span>)}{appointments.length>2?<span className={styles.more}>+{appointments.length-2} more</span>:null}</span>{appointments.length>0?<span className={styles.mobileCount}>{appointments.length} <span className="sr-only">events</span></span>:null}</button>})}
   </div>
   {error||state?.error?<p role="alert" className="mt-3 text-sm leading-5 text-red-700">{error||state?.error}</p>:null}
   {!ready?<p role="status" className="mt-4 text-sm text-[var(--onboarding-muted,#475569)]">{busy?"Loading calendar…":"Load your GHL appointments to fill this calendar."}</p>:<div className="mt-4"><h4 className="text-sm font-semibold">{new Intl.DateTimeFormat(undefined,{weekday:"long",month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(selectedDay+"T12:00:00Z"))}</h4>{events.get(selectedDay)?.length?<List embedded surface="light" ariaLabel="Schedule on selected day" className="mt-2">{events.get(selectedDay)!.map(e=><ListItem key={e.id}><ListPrimaryRow><ListTitle className={`flex-1 ${["cancelled","canceled"].includes(e.status)?"line-through":""}`}>{e.title}</ListTitle>{["cancelled","canceled"].includes(e.status)?<Status surface="light" tone="grey" label="Cancelled"/>:null}</ListPrimaryRow>{e.originalTitle?<ListSecondaryRow><span title={e.originalTitle} className="min-w-0 truncate text-[var(--onboarding-muted,#475569)]">{e.originalTitle}</span></ListSecondaryRow>:null}{e.contactCity?<ListSecondaryRow><span className="text-[var(--onboarding-muted,#475569)]">Contact location: {e.contactCity}</span></ListSecondaryRow>:null}<ListSecondaryRow><time dateTime={e.start} className="text-[var(--onboarding-muted,#475569)]">{e.allDay?"All day":`${time(e.start)} – ${time(e.end)}`}</time></ListSecondaryRow></ListItem>)}</List>:<p className="mt-2 text-sm text-[var(--onboarding-muted,#475569)]">Nothing scheduled on this day.</p>}</div>}
   {namesBusy&&namesBusy===displayed?.snapshot?.snapshotId?<p role="status" className="mt-2 text-xs text-[var(--onboarding-muted,#475569)]">Adding contact details…</p>:namesError&&namesError===displayed?.snapshot?.snapshotId||displayed?.snapshot?.namesStatus==="unavailable"?<p className="mt-2 text-xs text-[var(--onboarding-muted,#475569)]">Contact details unavailable. Original GHL titles are shown; refresh to retry.</p>:displayed?.snapshot?.namesStatus==="pending"?<p className="mt-2 text-xs text-[var(--onboarding-muted,#475569)]">Refresh to add contact details.</p>:null}
   <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 border-t border-black/10 pt-1"><p className="text-xs text-[var(--onboarding-muted,#475569)]">{timezone.replaceAll("_"," ")}{displayed?.refreshedAt?` · Updated ${new Intl.DateTimeFormat(undefined,{timeZone:timezone,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(displayed.refreshedAt))}`:""}</p><button className={control} disabled={busy} onClick={()=>void load(true,month)}>{busy?"Updating…":snapshot?"Refresh":"Load calendar"}</button></div>
  </div>
 </PortalSection>
}
