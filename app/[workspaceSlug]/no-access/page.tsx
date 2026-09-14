import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { defaultWorkspaceHref, requireWorkspaceAccess } from "@/lib/workspace-access"
import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function NoWorkspaceAccessPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const { workspace, user, access } = await requireWorkspaceAccess(workspaceSlug)
    if (access.capabilities.length) redirect(defaultWorkspaceHref(access))
    return <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-3xl pt-16 text-center">
            <h1 className="text-2xl font-semibold">Workspace unavailable</h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-neutral-400">Your workspace membership is active, but its core panels could not be loaded. Refresh the workspace or ask an administrator to check its setup.</p>
        </div>
    </main>
}
