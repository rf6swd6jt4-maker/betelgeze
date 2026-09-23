import Link from "next/link"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { requireWorkspace } from "@/lib/workspaces"

export default async function RetiredNewPollPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    return <main className="min-h-screen bg-neutral-950 px-4 pb-5 text-white sm:px-6 sm:pb-6">
        <div className="mx-auto max-w-7xl">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
            <h1 className="mt-8 text-2xl font-semibold">Lead Gen has been retired</h1>
            <p className="mt-3 text-neutral-400">New polls are unavailable. Saved poll history remains available to administrators.</p>
            <Link className="mt-5 inline-block text-blue-300 underline" href={`/${workspace.slug}/leadgen/polls`}>View poll history</Link>
        </div>
    </main>
}
