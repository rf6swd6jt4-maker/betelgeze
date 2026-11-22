"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { Button } from "@/components/ui"
import { WORKSPACE_TAB_FRAME_PARAM, WORKSPACE_TAB_MESSAGE_SOURCE, type WorkspaceTabFrameMessage } from "@/lib/workspace-tabs"
import { openLeadChat } from "@/app/[workspaceSlug]/campaigns/actions"

/**
 * Chat on a lead (docs/comms-leads.md): opens their text conversation in Comms → Leads, starting it the first time.
 * On a page the shell shows in a frame, the shell docks it where the docked Comms panel is offered (desktop, Today
 * layout) and opens Comms elsewhere, like a client's Chat. Opening it reads nothing until it is on screen.
 */
export function LeadChatButton({ workspaceSlug, leadId, variant = "secondary", className }: {
    workspaceSlug: string; leadId: string; variant?: "secondary" | "ghost"; className?: string
}) {
    const tabId = useSearchParams().get(WORKSPACE_TAB_FRAME_PARAM)
    const router = useRouter()
    const [pending, setPending] = useState(false)
    const [error, setError] = useState("")
    const open = async () => {
        if (pending) return
        setPending(true)
        setError("")
        const result = await openLeadChat(workspaceSlug, leadId).catch(() => ({ ok: false as const, error: "The conversation could not open. Please retry." }))
        setPending(false)
        if (!result.ok) { setError(result.error); return }
        if (tabId) {
            const message: WorkspaceTabFrameMessage = { source: WORKSPACE_TAB_MESSAGE_SOURCE, target: "host", tabId, type: "lead-chat", conversationId: result.conversationId, title: result.title }
            window.parent.postMessage(message, window.location.origin)
        } else router.push(result.href)
    }
    return <span className="inline-flex items-center gap-2">
        <Button size="sm" variant={variant} data-lead-chat aria-busy={pending || undefined} disabled={pending} className={className} onClick={() => { void open() }}>Chat</Button>
        {error ? <span role="alert" className="text-xs text-red-200">{error}</span> : null}
    </span>
}
