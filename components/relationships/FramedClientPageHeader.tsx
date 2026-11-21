"use client"

import type { ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ClientPageHeader } from "./ClientPageHeader"
import type { ClientPageTab, ClientPageTabKey } from "@/lib/client-page"
import { WORKSPACE_TAB_FRAME_PARAM, WORKSPACE_TAB_MESSAGE_SOURCE, type WorkspaceTabFrameMessage } from "@/lib/workspace-tabs"

/**
 * The client page header on a page the shell shows in a frame (Onboarding, Connections). A framed page cannot reach the
 * shell's Today context, so Chat asks the shell through the frame bridge: the shell docks the conversation where the
 * docked Comms panel is offered and opens the full conversation where it is not. Outside a frame, Chat is a plain link.
 */
export function FramedClientPageHeader({ workspaceSlug, relationshipId, name, business, phase, isTest, tabs, active, chat = true, actions }: {
    workspaceSlug: string; relationshipId: string; name: string; business?: string | null; phase?: string | null; isTest?: boolean
    tabs: readonly ClientPageTab[]; active: ClientPageTabKey
    /** False where the page does not report this client to the shell, so a docked chat could not be shown beside it. */
    chat?: boolean
    actions?: ReactNode
}) {
    const tabId = useSearchParams().get(WORKSPACE_TAB_FRAME_PARAM)
    const chatHref = `/${encodeURIComponent(workspaceSlug)}/communications?mode=clients&conversation=${encodeURIComponent(relationshipId)}`
    const askShell = () => {
        const message: WorkspaceTabFrameMessage = {
            source: WORKSPACE_TAB_MESSAGE_SOURCE, target: "host", tabId: tabId!, type: "client-chat",
            relationshipId, title: business?.trim() || name,
        }
        window.parent.postMessage(message, window.location.origin)
    }
    return <ClientPageHeader name={name} business={business} phase={phase} isTest={isTest} tabs={tabs} active={active} actions={actions}
        onChat={chat && tabId ? askShell : undefined} chatHref={chat && !tabId ? chatHref : undefined} />
}
