"use client"

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import { LoadingPulse } from "@/components/panel/PanelLoading"
import { communicationsLocation } from "@/lib/communications/native-host"
import type { CommunicationReadProtocol } from "@/lib/communications/read-protocol"
import { confirmWorkspaceFrameDeparture, prepareWorkspaceFrameDeparture } from "@/lib/workspace-tab-departure"
import { WORKSPACE_DOCKED_CHAT_TAB_ID, WORKSPACE_TAB_FRAME_NAME_PREFIX, WORKSPACE_TAB_MESSAGE_SOURCE, workspaceTabFrameUrl, type WorkspaceTabFrameMessage, type WorkspaceTabParentMessage } from "@/lib/workspace-tabs"

const OPEN_DEADLINE_MS = 30_000

export type DockedCommunicationsHandle = {
    /** Ask the chat to checkpoint its work. Resolves false when it cannot confirm; the caller must then keep it mounted. */
    leave: () => Promise<boolean>
}

/**
 * The existing Communications page in one small frame, docked beside the active destination by the Today layout.
 * The page's own reader, read queue, drafts and alerts run unmodified. This owner only says when the dock is on
 * screen (so the reader may treat it as in front of the person), forwards record links to the work area, and refuses
 * to unmount until the page confirms its work is saved. It loads nothing until it is mounted.
 */
export function DockedCommunications({ url, shown, label, workspaceSlug, readProtocol, onOpenDestination, handle }: {
    url: string; shown: boolean; label: string; workspaceSlug: string; readProtocol: CommunicationReadProtocol
    onOpenDestination: (href: string) => void; handle: Ref<DockedCommunicationsHandle>
}) {
    const frame = useRef<HTMLIFrameElement>(null)
    const [attempt, setAttempt] = useState(0)
    const [state, setState] = useState<"opening" | "ready" | "slow">("opening")
    const ready = state === "ready"
    const readyRef = useRef(false)
    const openRef = useRef(onOpenDestination)
    useEffect(() => { openRef.current = onOpenDestination }, [onOpenDestination])
    const [src] = useState(() => workspaceTabFrameUrl(url, WORKSPACE_DOCKED_CHAT_TAB_ID, "http://localhost", readProtocol))

    const restart = useCallback(() => { readyRef.current = false; setState("opening"); setAttempt(value => value + 1) }, [])

    useEffect(() => {
        // One bounded wait per attempt; it reports, it never reloads the document by itself.
        if (state !== "opening") return
        const deadline = window.setTimeout(() => setState(current => current === "opening" ? "slow" : current), OPEN_DEADLINE_MS)
        return () => window.clearTimeout(deadline)
    }, [state, attempt])

    useEffect(() => {
        function receive(event: MessageEvent<WorkspaceTabFrameMessage>) {
            const message = event.data
            if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return
            if (message?.source !== WORKSPACE_TAB_MESSAGE_SOURCE || message.target !== "host" || message.tabId !== WORKSPACE_DOCKED_CHAT_TAB_ID) return
            if (message.type === "open-tab" && message.url) { openRef.current(message.url); return }
            if ((message.type === "location" || message.type === "location-replace") && message.url) {
                if (communicationsLocation(message.url, workspaceSlug)) { readyRef.current = true; setState("ready"); return }
                // The dock holds chat only. Anything else opened from a message belongs in the work area.
                openRef.current(message.url)
                restart()
            }
        }
        window.addEventListener("message", receive)
        return () => window.removeEventListener("message", receive)
    }, [restart, workspaceSlug])

    useEffect(() => {
        // The shell names the dock only while it is displayed and mounted; the page's reader checks this name
        // (lib/workspace-tab-activity.ts) together with focus and newest-message visibility before any read.
        const host = document.body.dataset
        const target = frame.current?.contentWindow
        if (shown && ready) host.workspaceDockedTabId = WORKSPACE_DOCKED_CHAT_TAB_ID
        else if (host.workspaceDockedTabId === WORKSPACE_DOCKED_CHAT_TAB_ID) delete host.workspaceDockedTabId
        if (ready && target) {
            const message: WorkspaceTabParentMessage = { source: WORKSPACE_TAB_MESSAGE_SOURCE, target: "frame", tabId: WORKSPACE_DOCKED_CHAT_TAB_ID, type: "activate", active: shown, refresh: false }
            target.postMessage(message, window.location.origin)
        }
        return () => { if (host.workspaceDockedTabId === WORKSPACE_DOCKED_CHAT_TAB_ID) delete host.workspaceDockedTabId }
    }, [shown, ready, attempt])

    useImperativeHandle(handle, () => ({
        async leave() {
            const node = frame.current
            // A page that never reported itself has no draft owner yet.
            if (!node || !readyRef.current) return true
            return await prepareWorkspaceFrameDeparture(node, WORKSPACE_DOCKED_CHAT_TAB_ID, window) && confirmWorkspaceFrameDeparture(node)
        },
    }), [])

    return <div data-docked-communications className="relative min-h-0 flex-1 overflow-hidden bg-neutral-950">
        <iframe key={attempt} ref={frame} name={`${WORKSPACE_TAB_FRAME_NAME_PREFIX}${WORKSPACE_DOCKED_CHAT_TAB_ID}`} src={src} title={label}
            hidden={!shown} aria-hidden={!shown || !ready} inert={!ready}
            style={{ backgroundColor: "#0a0a0a", colorScheme: "dark", opacity: ready ? 1 : 0 }}
            className="absolute inset-0 h-full w-full border-0 bg-neutral-950" />
        {ready ? null : <div className="absolute inset-0 flex flex-col gap-3 bg-neutral-950 p-4">
            {state === "slow" ? <p role="alert" className="text-sm text-red-200">Chat is taking longer than usual to open. <button type="button" className="underline underline-offset-2" onClick={restart}>Retry</button></p>
                : <div role="status" aria-label="Loading messages" className="flex flex-col gap-3">
                    <LoadingPulse className="h-9 w-3/5 rounded-xl" />
                    <LoadingPulse className="ml-auto h-9 w-1/2 rounded-xl" />
                    <LoadingPulse className="h-14 w-4/5 rounded-xl" />
                </div>}
        </div>}
    </div>
}
