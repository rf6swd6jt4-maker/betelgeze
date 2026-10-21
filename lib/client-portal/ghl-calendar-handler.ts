import {randomUUID} from "node:crypto"
import {GhlError, parseGhlCredentials, readGhlJson} from "./ghl-provider"
import {fetchGhlCalendar, parseOwnerBinding} from "./ghl-calendar-provider"
import {calendarErrors, validMonth} from "./ghl-calendar"
type Dependencies={resolve:(token:string)=>Promise<{workspace:{id:string}}|null>;rpc:(params:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;fetchCalendar?:typeof fetchGhlCalendar}
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}})
export function projectCalendar(value:Record<string,unknown>){
 const raw=value.snapshot as import("./ghl-calendar-provider").OwnerCalendarResult|null
 const snapshot=(raw?.source==="owner-user"||raw?.source==="booking-calendar")?{source:raw.source,...(raw.calendarId ? {calendarId:raw.calendarId} : {}),owner:{id:raw.owner.id,name:raw.owner.name},timezone:raw.timezone,month:raw.month,snapshotId:raw.snapshotId,namesStatus:raw.namesStatus,events:raw.events.map(e=>{
  const contactId=e.kind==="appointment"?raw.eventContacts?.[e.id]:null
  const label=contactId?raw.contactLabels?.[contactId]:null
  const title=label?[label.name,label.city].filter(Boolean).join(" · "):e.title
  return {id:e.id,title,start:e.start,end:e.end,status:e.status,kind:e.kind,allDay:e.allDay,...(typeof e.version==="number"?{version:e.version}:{}),...(e.detailsRetained===true?{detailsRetained:true}:{}),...(label?{originalTitle:e.title,...(label.city?{contactCity:label.city}:{})}:{})}
 })}:null
 return {revision:typeof value.revision==="string"?value.revision:null,calendars:Array.isArray(value.calendars)?value.calendars.slice(0,10).filter(c=>c&&typeof c.id==="string"&&typeof c.name==="string").map(c=>({id:c.id,name:c.name,...(typeof c.isActive==="boolean"?{isActive:c.isActive}:{})})):[],snapshot,refreshedAt:value.refreshedAt??null,error:typeof value.error==="string"?calendarErrors[value.error]??calendarErrors.unavailable:null,busy:value.busy===true,complete:value.complete!==false&&Boolean(snapshot),detailsPending:value.detailsPending===true,queued:value.queued===true}}
export async function handlePortalGhlCalendar(request:Request,token:string,deps:Dependencies){
 let op:string|null=null,call:((action:string,params?:Record<string,unknown>)=>Promise<Record<string,unknown>>)|null=null
 try{
  const access=await deps.resolve(token);if(!access)return reply({error:"This calendar is not available for this portal."},404)
  call=async(action,params={})=>{const {data,error}=await deps.rpc({p_session_token:token,p_workspace_id:access.workspace.id,p_action:action,...params});if(error||!data||typeof data!=="object")throw new GhlError("storage");const result=data as Record<string,unknown>;if(typeof result.failure==="string")throw new GhlError(result.failure);return result}
  if(request.method==="GET"){
   const query=new URL(request.url).searchParams,month=query.get("month");if(month!==null&&!validMonth(month))return reply({error:"Choose a valid month."},400)
   return reply(projectCalendar(await call("read",{p_calendar_id:query.get("calendarId"),...(month?{p_month:month}:{})})))
  }
  if(request.headers.get("sec-fetch-site")==="cross-site")return reply({error:"Use the calendar in this portal."},403)
  if(!request.headers.get("content-type")?.startsWith("application/json"))return reply({error:"Expected a JSON request."},415)
  let body:Record<string,unknown>;try{body=await readGhlJson(new Response(request.body),2048)}catch{return reply({error:"Invalid calendar request."},400)}
  if(!validMonth(body.month)||(body.calendarId!=null&&(typeof body.calendarId!=="string"||!/^[a-zA-Z0-9_-]{10,80}$/.test(body.calendarId)))||(body.background!=null&&typeof body.background!=="boolean")||Object.keys(body).some(key=>!["month","calendarId","background"].includes(key)))return reply({error:"Choose a valid month. Your team selects the calendar in Client Connections."},400)
  if(body.background===true)return reply(projectCalendar(await call("request",{p_month:body.month,p_calendar_id:body.calendarId??null})),202)
  op=randomUUID();const started=await call("begin",{p_operation_id:op,p_month:body.month,p_calendar_id:body.calendarId??null});const credentials=parseGhlCredentials(started);if(!credentials)throw new GhlError("credentials")
  const snapshot=await(deps.fetchCalendar??fetchGhlCalendar)(credentials,body.month,parseOwnerBinding(started.binding))
  const saved=await call("finish",{p_operation_id:op,p_snapshot:snapshot});op=null;return reply(projectCalendar(saved))
 }catch(error){const code=error instanceof GhlError?error.code:"unavailable";if(op&&call)await call("fail",{p_operation_id:op,p_error:code}).catch(()=>{});return reply({error:calendarErrors[code]??"The calendar could not be loaded. Please try again."},code==="access"?404:["busy","changed"].includes(code)?409:["rate_limit","cooldown"].includes(code)?429:503)}
}
