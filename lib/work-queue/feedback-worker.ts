import "server-only"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { queueAiConfiguration } from "./worker"
import { QUEUE_MODEL } from "./ranking"
import { dayInTimezone, horizonDay, effectiveHorizon, FEEDBACK_INSTRUCTIONS, FEEDBACK_SCHEMA, parseFeedback, type Horizon } from "./feedback-policy"
import { notifyQueueDispute } from "@/lib/push/chat-notifications"
type Job={id:string;workspace_id:string;entity_id:string;lease_token:string}
export async function processQueueFeedback(kind:"schedule"|"dispute"|"notify",request:typeof fetch=fetch) {
 const config=queueAiConfiguration();if(kind==='dispute'&&!config.enabled)return {processed:0}
 const claim=await supabaseAdmin.rpc('claim_queue_feedback_job',{p_kind:kind,p_daily_limit:config.dailyLimit});if(claim.error)throw new Error('Could not claim feedback work')
 const job=claim.data?.[0] as Job|undefined;if(!job)return {processed:0}
 let error:string|null=null,received=false,dispatched=false
 try {
  if(kind==='schedule'){
   const calibrated=await supabaseAdmin.rpc('calibrate_queue_effort',{p_workspace:job.workspace_id,p_user:job.entity_id});if(calibrated.error)throw calibrated.error
   const context=await supabaseAdmin.rpc('queue_schedule_context',{p_workspace:job.workspace_id,p_user:job.entity_id});if(context.error)throw context.error
   const {tasks,timezone}=context.data as {timezone:string;tasks:{id:string;effort:number;factor:number;horizon:Horizon;anchor_day:string|null;old_horizon:Horizon|null;ready:boolean}[]}
   if(tasks.length>1000)throw new Error('More than 1000 items require a manager workload review')
   const today=dayInTimezone(Date.now(),timezone)
   const ready=tasks.filter(t=>t.ready),urgent=ready.filter(t=>['now','today'].includes(effectiveHorizon(t.horizon,t.anchor_day??today,today)))
   const plans=ready.map(t=>{const anchor=t.old_horizon===t.horizon&&t.anchor_day?t.anchor_day:today;const conflict=urgent.length>3&&urgent.includes(t);return {id:t.id,effort_minutes:Math.ceil(t.effort*t.factor),horizon:t.horizon,anchor_day:anchor,target_day:horizonDay(t.horizon,anchor),conflict,reason:conflict?'Several items need attention now or today; review the workload with your manager.':'Priority reflects the consequence of postponement, not a promised finish time.'}})
   const saved=await supabaseAdmin.rpc('publish_queue_schedule',{p_job:job.id,p_lease:job.lease_token,p_plans:plans});if(saved.error)throw saved.error
  }else{
   const result=await supabaseAdmin.from('work_queue_disputes').select('id,workspace_id,work_item_id,resolver_id,conversation_id,message_id,reason,note,snapshot,assessment').eq('workspace_id',job.workspace_id).eq('id',job.entity_id).single();if(result.error)throw result.error
   const d=result.data
   if(kind==='notify')await notifyQueueDispute({workspaceId:job.workspace_id,disputeId:d.id})
   else {
    let assessment=d.assessment
    if(!assessment){
     // The immutable saved dispute is assessed once. No chat history is collected.
     const snapshot=d.snapshot as {title?:string;instructions?:string;description?:string;assessment?:unknown;metadata?:unknown}
     const input=JSON.stringify({reason:d.reason,note:d.note,work:{title:snapshot.title,instructions:snapshot.instructions?.slice(0,18000),goal:snapshot.description?.slice(0,3000),estimate:snapshot.assessment}})
     dispatched=true
     const response=await request('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY!.trim()}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(65000),body:JSON.stringify({model:QUEUE_MODEL,store:false,reasoning:{effort:'low'},instructions:FEEDBACK_INSTRUCTIONS,input:[{role:'user',content:[{type:'input_text',text:input}]}],max_output_tokens:2500,text:{format:{type:'json_schema',name:'queue_feedback',strict:true,schema:FEEDBACK_SCHEMA}}})})
     if(!response.ok)throw new Error('Feedback assessment unavailable')
     const body=await response.json() as {status:string;usage?:{input_tokens:number;output_tokens:number};output?:{type:string;content?:{type:string;text?:string}[]}[]}
     const i=body.usage?.input_tokens,o=body.usage?.output_tokens
     const usage=await supabaseAdmin.from('work_queue_ai_usage').update({status:'received',input_tokens:i??null,output_tokens:o??null,cost_usd:i!==undefined&&o!==undefined?(i*.75+o*4.5)/1e6:null}).eq('id',job.lease_token);if(usage.error)throw usage.error;received=true
     const content=body.output?.flatMap(x=>x.content??[])??[];if(body.status!=='completed'||content.some(x=>x.type==='refusal'))throw new Error('Feedback assessment incomplete')
     assessment=parseFeedback(JSON.parse(content.filter(x=>x.type==='output_text').map(x=>x.text??'').join('')))
     const saved=await supabaseAdmin.from('work_queue_disputes').update({assessment,assessment_at:new Date().toISOString()}).eq('id',d.id).eq('workspace_id',job.workspace_id).is('assessment',null);if(saved.error)throw saved.error
    }else {const usage=await supabaseAdmin.from('work_queue_ai_usage').update({status:'received',input_tokens:0,output_tokens:0,cost_usd:0}).eq('id',job.lease_token);if(usage.error)throw usage.error;received=true}
   }
  }
 } catch {
  error=kind==='dispute'?'AI assessment could not be confirmed. Manager review is available.':'Feedback follow-up needs retry.'
  if(kind==='dispute'&&!received)await supabaseAdmin.from('work_queue_ai_usage').update({status:dispatched?'unknown':'received',...(!dispatched?{input_tokens:0,output_tokens:0,cost_usd:0}:{})}).eq('id',job.lease_token)
 }
 const finished=await supabaseAdmin.rpc('finish_queue_feedback_job',{p_job:job.id,p_lease:job.lease_token,p_error:error});if(finished.error)throw new Error('Could not finish feedback work')
 return {processed:1}
}
export async function processQueueFeedbackFast(){for(const kind of ['notify','schedule'] as const)for(let n=0;n<2;n++)if(!(await processQueueFeedback(kind)).processed)break}
