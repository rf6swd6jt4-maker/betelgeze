import { CommunicationsPanel } from "@/components/communications/CommunicationsPanel"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { loadClientCommunicationsBootstrap } from "@/lib/communications/bootstrap"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { loadNativeCommunications } from "@/lib/teams/server"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ conversation?: string; mode?: string; nativeConversation?: string; dm?: string }>
}

export default async function CommunicationsPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user, role } = await requireWorkspacePanel(workspaceSlug, "communications")
    const initialMode = query.mode === "team" || (query.mode !== "clients" && (Boolean(query.dm) || Boolean(query.nativeConversation))) ? "team" : "clients"
    // The inactive mode is loaded after the visible view paints. Do not make a
    // client conversation wait for team history (or the reverse).
    const bootstrap = initialMode === "clients"
        ? await loadClientCommunicationsBootstrap({ currentUserId: user.id, requestedConversationId: query.conversation, workspaceId: workspace.id, workspaceSlug: workspace.slug })
        : null
    const nativeBootstrap = initialMode === "team"
        ? await loadNativeCommunications({ workspaceId: workspace.id, workspaceSlug: workspace.slug, currentUserId: user.id, role, requestedConversationId: query.nativeConversation, requestedDmUserId: query.dm })
        : null

    return (
        <main className="fixed inset-0 overflow-hidden bg-black text-white">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <CommunicationsPanel key={`${workspace.id}:${user.id}`} clientBootstrap={bootstrap} nativeBootstrap={nativeBootstrap} initialMode={initialMode} initialConversationId={query.conversation} initialNativeConversationId={query.nativeConversation} initialDmUserId={query.dm} />
        </main>
    )
}
