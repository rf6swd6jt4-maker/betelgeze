"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
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
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const routeUrl = `${pathname}?${searchParams.toString()}`
    const tabId = searchParams.get(WORKSPACE_TAB_FRAME_PARAM) ?? "standalone"
    const storageKey = useMemo(() => workspaceTabContextStorageKey(workspaceSlug, tabId), [tabId, workspaceSlug])
    const [open, setOpen] = useState(() => {
        try { return typeof window === "undefined" || sessionStorage.getItem(storageKey) !== "false" }
        catch { return true }
    })
    const [mobileOpen, setMobileOpen] = useState(false)
    const relationshipId = contextPayload.id

    useEffect(() => {
        try { sessionStorage.setItem(storageKey, open ? "true" : "false") } catch { /* Preference storage is optional. */ }
    }, [open, storageKey])

    const postContextStatus = useCallback((contextSupported: boolean) => {
        if (!relationshipId || tabId === "standalone" || window.parent === window) return
        const message: WorkspaceTabFrameMessage = {
            source: WORKSPACE_TAB_MESSAGE_SOURCE, target: "host", tabId,
            type: "context-status", url: routeUrl, contextSupported, relationshipId,
            context: contextSupported ? contextPayload : null,
        }
        window.parent.postMessage(message, window.location.origin)
    }, [contextPayload, relationshipId, routeUrl, tabId])

    useEffect(() => {
        function receiveHostMessage(event: MessageEvent<WorkspaceTabParentMessage>) {
            if (event.origin !== window.location.origin || event.source !== window.parent) return
            const message = event.data
            if (message?.source !== WORKSPACE_TAB_MESSAGE_SOURCE || message.target !== "frame" || message.tabId !== tabId) return
            if (message.type === "context-set" && typeof message.open === "boolean") setOpen(message.open)
            // A redirect can commit before the shell accepts this route's first
            // context message. Reuse the existing activation/probe handshake.
            if (message.type === "probe" || (message.type === "activate" && message.active)) postContextStatus(true)
        }
        window.addEventListener("message", receiveHostMessage)
        postContextStatus(true)
        return () => { window.removeEventListener("message", receiveHostMessage); postContextStatus(false) }
    }, [postContextStatus, tabId])



    return <>
        <aside aria-hidden="true" className={`hidden shrink-0 lg:block ${open ? "w-80" : "w-0"}`} />
        {tabId === "standalone" ? <>
            <button type="button" onClick={event => { event.currentTarget.focus({ preventScroll: true }); setMobileOpen(true) }} className="mt-4 text-sm text-neutral-300 underline underline-offset-4 lg:hidden">Relationship context</button>
            <button type="button" onClick={() => setOpen(!open)} className="fixed bottom-4 right-6 z-40 hidden text-xs text-neutral-400 lg:block">{open ? "Hide" : "Show"} relationship context</button>
            <ShellRelationshipContextPanel currentUrl={routeUrl} context={contextPayload} workspaceSlug={workspaceSlug} workspaceCapabilities={workspaceCapabilities}
                desktopOpen={open} mobileOpen={mobileOpen} standalone onClose={() => setMobileOpen(false)}
                onNavigate={(href) => { setMobileOpen(false); router.push(href) }} />
        </> : null}
    </>
}
