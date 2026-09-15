import { requireWorkspace } from '@/lib/workspaces'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { WorkspaceTopBar } from '@/components/workspace/WorkspaceTopBar'
import { QueueFeedback } from '@/components/work-queue/QueueFeedback'
export const dynamic='force-dynamic'
export default async function FeedbackPage({params,searchParams}:{params:Promise<{workspaceSlug:string}>;searchParams:Promise<{dispute?:string|string[]}>}){
 const {workspaceSlug}=await params;const {workspace,user}=await requireWorkspace(workspaceSlug)
 const {dispute}=await searchParams
 const validId=typeof dispute==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dispute)
 const [result,detail]=await Promise.all([
  supabaseAdmin.rpc('read_queue_feedback',{p_workspace:workspace.id,p_user:user.id}),
  validId?supabaseAdmin.rpc('read_queue_dispute',{p_workspace:workspace.id,p_user:user.id,p_dispute:dispute}):Promise.resolve(null),
 ])
 if(result.error)throw new Error('Could not load queue feedback')
 const selected=detail&&!detail.error?detail.data:null
 return <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6"><WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work"/><div className="mx-auto max-w-5xl"><QueueFeedback key={`${workspace.id}:${user.id}:${validId?dispute:''}`} data={result.data} initialDispute={selected} initialError={dispute&&!selected?'This dispute is unavailable or you no longer have access.':''} userId={user.id} workspaceSlug={workspace.slug}/></div></main>
}
