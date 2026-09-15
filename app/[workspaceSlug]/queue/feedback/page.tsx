import { requireWorkspace } from '@/lib/workspaces'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { WorkspaceTopBar } from '@/components/workspace/WorkspaceTopBar'
import { QueueFeedback } from '@/components/work-queue/QueueFeedback'
export const dynamic='force-dynamic'
export default async function FeedbackPage({params}:{params:Promise<{workspaceSlug:string}>}){
 const {workspaceSlug}=await params;const {workspace,user}=await requireWorkspace(workspaceSlug)
 const result=await supabaseAdmin.rpc('read_queue_feedback',{p_workspace:workspace.id,p_user:user.id});if(result.error)throw new Error('Could not load queue feedback')
 return <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6"><WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work"/><div className="mx-auto max-w-5xl"><QueueFeedback data={result.data} userId={user.id} workspaceSlug={workspace.slug}/></div></main>
}
