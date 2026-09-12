import {randomUUID} from "node:crypto"
import {GhlError, parseGhlCredentials, readGhlJson} from "./ghl-provider"
import {fetchGhlCalendar} from "./ghl-calendar-provider"
import {calendarErrors, validMonth} from "./ghl-calendar"
type Dependencies={resolve:(token:string)=>Promise<{workspace:{id:string}}|null>;rpc:(params:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;fetchCalendar?:typeof fetchGhlCalendar}
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}})
function project(value:Record<string,unknown>){return {revision:typeof value.revision==="string"?value.revision:null,snapshot:value.snapshot??null,refreshedAt:value.refreshedAt??null,error:typeof value.error==="string"?calendarErrors[value.error]??calendarErrors.unavailable:null,busy:value.busy===true}}
export async function handlePortalGhlCalendar(request:Request,token:string,deps:Dependencies){
 let op:string|null=null,call:((action:string,params?:Record<string,unknown>)=>Promise<Record<string,unknown>>)|null=null
 try{
  const access=await deps.resolve(token);if(!access)return reply({error:"This calendar is not available for this portal."},404)
  call=async(action,params={})=>{const {data,error}=await deps.rpc({p_session_token:token,p_workspace_id:access.workspace.id,p_action:action,...params});if(error||!data||typeof data!=="object")throw new GhlError("storage");const result=data as Record<string,unknown>;if(typeof result.failure==="string")throw new GhlError(result.failure);return result}
  if(request.method==="GET")return reply(project(await call("read")))
  if(request.headers.get("sec-fetch-site")==="cross-site")return reply({error:"Use the calendar in this portal."},403)
  if(!request.headers.get("content-type")?.startsWith("application/json"))return reply({error:"Expected a JSON request."},415)
  let body:Record<string,unknown>;try{body=await readGhlJson(new Response(request.body),2048)}catch{return reply({error:"Invalid calendar request."},400)}
  if(!validMonth(body.month)||(body.calendarId!==null&&body.calendarId!==undefined&&(typeof body.calendarId!=="string"||!/^[a-zA-Z0-9_-]{10,80}$/.test(body.calendarId))))return reply({error:"Choose a valid month and calendar."},400)
  op=randomUUID();const credentials=parseGhlCredentials(await call("begin",{p_operation_id:op,p_month:body.month,p_calendar_id:body.calendarId??null}));if(!credentials)throw new GhlError("credentials")
  const snapshot=await(deps.fetchCalendar??fetchGhlCalendar)(credentials,body.month,(body.calendarId as string|null)??null)
  const saved=await call("finish",{p_operation_id:op,p_snapshot:snapshot});op=null;return reply(project(saved))
 }catch(error){const code=error instanceof GhlError?error.code:"unavailable";if(op&&call)await call("fail",{p_operation_id:op,p_error:code}).catch(()=>{});return reply({error:calendarErrors[code]??"The calendar could not be loaded. Please try again."},code==="access"?404:["busy","changed"].includes(code)?409:["rate_limit","cooldown"].includes(code)?429:503)}
}
