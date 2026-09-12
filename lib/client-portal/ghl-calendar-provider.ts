import { GhlError, readGhlJson } from "./ghl-provider"
import { monthWindow, validMonth, type GhlCalendarSnapshot } from "./ghl-calendar"
const identifier = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{10,80}$/.test(v)
export async function fetchGhlCalendar(credentials: {locationId:string;privateToken:string}, month:string, calendarId:string|null, fetcher:typeof fetch=fetch):Promise<GhlCalendarSnapshot> {
    if(!validMonth(month)) throw new GhlError("response")
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),20_000)
    const request=async(path:string)=>{
        const r=await fetcher(`https://services.leadconnectorhq.com${path}`,{headers:{Authorization:`Bearer ${credentials.privateToken}`,Version:"v3",Accept:"application/json"},cache:"no-store",redirect:"error",signal:controller.signal})
        if(!r.ok){await r.body?.cancel();throw new GhlError(r.status===401||r.status===403?"permissions":r.status===429?"rate_limit":"unavailable")}
        return readGhlJson(r,524288)
    }
    try {
        const [identity,list]=await Promise.all([request(`/locations/${encodeURIComponent(credentials.locationId)}`),request(`/calendars/?locationId=${encodeURIComponent(credentials.locationId)}&showDrafted=false`)])
        const location=identity.location as Record<string,unknown>|undefined
        if(location?.id!==credentials.locationId)throw new GhlError("location")
        const timezone=location.timezone
        if(typeof timezone!=="string")throw new GhlError("response")
        try{new Intl.DateTimeFormat("en",{timeZone:timezone}).format()}catch{throw new GhlError("response")}
        if(!Array.isArray(list.calendars)||list.calendars.length>100)throw new GhlError("response")
        const calendars=list.calendars.filter(c=>c.isActive!==false).map(c=>{
            if(!identifier(c.id)||typeof c.name!=="string"||(c.locationId!==undefined&&c.locationId!==credentials.locationId))throw new GhlError("location")
            return {id:c.id,name:c.name.slice(0,160)}
        })
        const selected=calendarId??(calendars.length===1?calendars[0].id:null)
        const snapshot:GhlCalendarSnapshot={calendars,timezone,calendarId:selected,month,events:[]}
        if(!selected)return snapshot
        if(!calendars.some(c=>c.id===selected))throw new GhlError("location")
        const window=monthWindow(month,timezone)
        const body=await request(`/calendars/events?${new URLSearchParams({locationId:credentials.locationId,calendarId:selected,startTime:String(window.start),endTime:String(window.end-1)})}`)
        if(!Array.isArray(body.events)||body.events.length>1000)throw new GhlError("response")
        const seen=new Set<string>()
        snapshot.events=body.events.flatMap(row=>{
            if(!identifier(row.id)||row.calendarId!==selected||(row.locationId!==undefined&&row.locationId!==credentials.locationId))throw new GhlError("location")
            if(typeof row.startTime!=="string"||typeof row.endTime!=="string"||!/(Z|[+-]\d{2}:?\d{2})$/.test(row.startTime)||!/(Z|[+-]\d{2}:?\d{2})$/.test(row.endTime))throw new GhlError("response")
            const start=Date.parse(row.startTime),end=Date.parse(row.endTime)
            if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw new GhlError("response")
            if(start<window.start||start>=window.end||seen.has(row.id))return []
            seen.add(row.id)
            const status=typeof row.appointmentStatus==="string"?row.appointmentStatus.toLowerCase():"confirmed"
            if(["cancelled","canceled","deleted","invalid"].includes(status))return []
            return [{id:row.id,title:typeof row.title==="string"&&row.title.trim()?row.title.trim().slice(0,200):"Appointment",start:new Date(start).toISOString(),end:new Date(end).toISOString(),status}]
        }).sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id))
        return snapshot
    } catch(error){controller.abort();throw error instanceof GhlError?error:new GhlError("unavailable")}finally{clearTimeout(timeout)}
}
