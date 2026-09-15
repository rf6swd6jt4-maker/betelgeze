import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { PersonalWorkQueue } from "@/components/work-queue/PersonalWorkQueue"
import { loadPersonalQueue } from "@/lib/work-queue/server"
import { requireWorkspace } from "@/lib/workspaces"
export const dynamic = "force-dynamic"
export default async function QueuePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const [data, { workspace, user }] = await Promise.all([loadPersonalQueue(workspaceSlug),requireWorkspace(workspaceSlug)])
    return <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6"><WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" /><div className="mx-auto max-w-7xl"><PersonalWorkQueue data={data} /></div></main>
}
