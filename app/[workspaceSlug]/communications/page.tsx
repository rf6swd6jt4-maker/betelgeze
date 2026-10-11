import { communicationDeviceProtocolSupported, DeviceCommunicationError, resolveCommunicationReadProtocol } from "@/lib/communications/device-server"
import { WORKSPACE_TAB_FRAME_PARAM } from "@/lib/workspace-tabs"
import { CommunicationsPanel } from "@/components/communications/CommunicationsPanel"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { loadClientCommunicationsBootstrap } from "@/lib/communications/bootstrap"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { loadNativeCommunications } from "@/lib/teams/server"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ conversation?: string; mode?: string; nativeConversation?: string; dm?: string; readProtocol?: string; [key: string]: string | undefined }>
}

export default async function CommunicationsPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user, role } = await requireWorkspacePanel(workspaceSlug, "communications")
    if (query.readProtocol && query.readProtocol !== "account-v1" && query.readProtocol !== "device-v1") throw new Error("Invalid read protocol.")
    const readProtocol = query.readProtocol === "device-v1" ? "device-v1" : query.readProtocol === "account-v1" || (!query.readProtocol && query[WORKSPACE_TAB_FRAME_PARAM]) ? "account-v1" : resolveCommunicationReadProtocol(workspace.id, user.id)
    if (readProtocol === "device-v1" && !communicationDeviceProtocolSupported(workspace.id, user.id)) throw new Error("Device unread counts are unavailable. Reload to reconnect.")
    const initialMode = query.mode === "team" || (query.mode !== "clients" && (Boolean(query.dm) || Boolean(query.nativeConversation))) ? "team" : "clients"
    // The inactive mode is loaded after the visible view paints. Do not make a
    // client conversation wait for team history (or the reverse).
    let bootstrap = null as Awaited<ReturnType<typeof loadClientCommunicationsBootstrap>> | null
    let nativeBootstrap = null as Awaited<ReturnType<typeof loadNativeCommunications>> | null
    try {
        if (initialMode === "clients") bootstrap = await loadClientCommunicationsBootstrap({ readProtocol, currentUserId: user.id, requestedConversationId: query.conversation, workspaceId: workspace.id, workspaceSlug: workspace.slug })
        else nativeBootstrap = await loadNativeCommunications({ readProtocol, workspaceId: workspace.id, workspaceSlug: workspace.slug, currentUserId: user.id, role, requestedConversationId: query.nativeConversation, requestedDmUserId: query.dm })
    } catch (error) {
        // Mount the existing device observation owner before retrying a cold
        // installation. No account-cursor bootstrap is substituted.
        if (!(readProtocol === "device-v1" && error instanceof DeviceCommunicationError && error.code === "P0002")) throw error
    }

    return (
        <main className="fixed inset-0 overflow-hidden bg-black text-white">
            <WorkspaceTopBar readProtocol={readProtocol} userId={user.id} workspace={workspace} currentProduct="client-work" />
            <CommunicationsPanel readProtocol={readProtocol} deferredScope={{ workspaceId: workspace.id, workspaceSlug: workspace.slug, userId: user.id }} key={`${workspace.id}:${user.id}`} clientBootstrap={bootstrap} nativeBootstrap={nativeBootstrap} initialMode={initialMode} initialConversationId={query.conversation} initialNativeConversationId={query.nativeConversation} initialDmUserId={query.dm} />
        </main>
    )
}
