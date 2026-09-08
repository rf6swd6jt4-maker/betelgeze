"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ShellRelationshipContextPanel } from "./ShellRelationshipContextPanel"
import type { WorkspaceCapability } from "@/lib/workspace-capabilities"
import {
    WORKSPACE_TAB_FRAME_PARAM, WORKSPACE_TAB_MESSAGE_SOURCE, workspaceTabContextStorageKey,
    type WorkspaceTabFrameMessage, type WorkspaceTabParentMessage, type WorkspaceTabRelationshipContext,
} from "@/lib/workspace-tabs"

export function RelationshipContextBridge({ workspaceSlug, contextPayload, workspaceCapabilities }: {
    workspaceSlug: string
    contextPayload: WorkspaceTabRelationshipContext
    workspaceCapabilities: WorkspaceCapability[]
}) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const tabId = searchParams.get(WORKSPACE_TAB_FRAME_PARAM) ?? "standalone"
    const storageKey = useMemo(() => workspaceTabContextStorageKey(workspaceSlug, tabId), [tabId, workspaceSlug])
    const [open, setOpen] = useState(() => typeof window === "undefined" ? true : sessionStorage.getItem(storageKey) !== "false")
    const [mobileOpen, setMobileOpen] = useState(false)
    const relationshipId = contextPayload.id

    useEffect(() => {
        sessionStorage.setItem(storageKey, open ? "true" : "false")
    }, [open, storageKey])

    useEffect(() => {
        function receiveHostMessage(event: MessageEvent<WorkspaceTabParentMessage>) {
            if (event.origin !== window.location.origin) return
            const message = event.data
            if (message?.source !== WORKSPACE_TAB_MESSAGE_SOURCE || message.target !== "frame" || message.tabId !== tabId) return
            if (message.type === "context-set" && typeof message.open === "boolean") setOpen(message.open)
        }

        window.addEventListener("message", receiveHostMessage)
        return () => window.removeEventListener("message", receiveHostMessage)
    }, [tabId])

    useEffect(() => {
        if (!relationshipId || !contextPayload || tabId === "standalone" || typeof window === "undefined" || window.parent === window) return

        const postContextStatus = (contextSupported: boolean) => {
            const message: WorkspaceTabFrameMessage = {
                source: WORKSPACE_TAB_MESSAGE_SOURCE,
                target: "host",
                tabId,
                type: "context-status",
                contextSupported,
                relationshipId,
                context: contextSupported ? contextPayload : null,
            }
            window.parent.postMessage(message, window.location.origin)
        }

        postContextStatus(true)
        return () => postContextStatus(false)
    }, [contextPayload, relationshipId, tabId])


    return <>
        <aside aria-hidden="true" className={`hidden shrink-0 lg:block ${open ? "w-80" : "w-0"}`} />
        {tabId === "standalone" ? <>
            <button type="button" onClick={() => setMobileOpen(true)} className="mt-4 text-sm text-neutral-300 underline underline-offset-4 lg:hidden">Relationship context</button>
            <button type="button" onClick={() => setOpen(!open)} className="fixed bottom-4 right-6 z-40 hidden text-xs text-neutral-400 lg:block">{open ? "Hide" : "Show"} relationship context</button>
            <ShellRelationshipContextPanel context={contextPayload} workspaceSlug={workspaceSlug} workspaceCapabilities={workspaceCapabilities}
                desktopOpen={open} mobileOpen={mobileOpen} standalone onClose={() => setMobileOpen(false)}
                onNavigate={(href) => { setMobileOpen(false); router.push(href) }} />
        </> : null}
    </>
}
