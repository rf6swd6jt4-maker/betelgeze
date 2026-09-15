import { after } from 'next/server'
import { unstable_rethrow } from 'next/navigation'
import { requireWorkspace } from '@/lib/workspaces'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { processQueueFeedbackFast } from '@/lib/work-queue/feedback-worker'
const headers={'Cache-Control':'private, no-store'}
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
export async function GET(request:Request,{params}:{params:Promise<{workspaceSlug:string}>}){
 const {workspaceSlug}=await params;const {workspace,user}=await requireWorkspace(workspaceSlug)
 if(request.headers.get('x-workspace-user')!==user.id)return Response.json({error:'Your session changed'},{status:409,headers})
 const disputeId=new URL(request.url).searchParams.get('id');if(disputeId){if(!uuid(disputeId))return Response.json({error:'Invalid dispute'},{status:400,headers});const detail=await supabaseAdmin.rpc('read_queue_dispute',{p_workspace:workspace.id,p_user:user.id,p_dispute:disputeId});return detail.error||!detail.data?Response.json({error:'Dispute unavailable'},{status:404,headers}):Response.json(detail.data,{headers})}
 const result=await supabaseAdmin.rpc('read_queue_feedback',{p_workspace:workspace.id,p_user:user.id})
 return result.error?Response.json({error:'Could not load feedback'},{status:503,headers}):Response.json({...result.data,userId:user.id,workspaceId:workspace.id},{headers})
}
export async function POST(request:Request,{params}:{params:Promise<{workspaceSlug:string}>}){
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid request origin'},{status:403,headers})
 try{
  const {workspaceSlug}=await params;const {workspace,user}=await requireWorkspace(workspaceSlug)
  if(request.headers.get('x-workspace-user')!==user.id)return Response.json({error:'Your session changed'},{status:409,headers})
  const text=await request.text();if(text.length>12000)return Response.json({error:'Request too large'},{status:413,headers})
  const b=JSON.parse(text);let rpc:string;let args:Record<string,unknown>={p_workspace:workspace.id,p_user:user.id}
  if(b.action==='dispute'&&uuid(b.id)&&uuid(b.requestId)&&typeof b.version==='string'&&Number.isFinite(Date.parse(b.version))&&typeof b.reason==='string'&&typeof b.note==='string'){
   rpc='submit_queue_dispute';args={...args,p_item:b.id,p_version:b.version,p_request:b.requestId,p_reason:b.reason,p_note:b.note}
  }else if(b.action==='resolve'&&uuid(b.id)&&typeof b.resolution==='string'&&typeof b.approved==='boolean'){
   rpc='resolve_queue_dispute';args={...args,p_dispute:b.id,p_resolution:b.resolution,p_approved:b.approved}
  }else if(b.action==='preferences'&&(b.timezone===undefined||typeof b.timezone==='string')&&(b.reset===undefined||typeof b.reset==='boolean')){
   rpc='queue_feedback_settings';args={...args,p_timezone:b.timezone??null,p_reset:b.reset??false}
  }else if(b.action==='correct-time'&&uuid(b.id)&&Number.isInteger(b.minutes)){
   rpc='correct_queue_effort';args={...args,p_run:b.id,p_minutes:b.minutes}
  }else return Response.json({error:'Invalid feedback action'},{status:400,headers})
  const result=await supabaseAdmin.rpc(rpc,args)
  if(result.error)return Response.json({error:result.error.code==='P0001'?result.error.message:'Feedback was not confirmed. Retry the same request.'},{status:409,headers})
  after(async()=>{try{await processQueueFeedbackFast()}catch{console.error('Durable feedback follow-up remains pending')}})
  return Response.json(result.data??{saved:true},{headers})
 }catch(e){unstable_rethrow(e);return Response.json({error:'Feedback was not confirmed. Retry the same request.'},{status:500,headers})}
}
