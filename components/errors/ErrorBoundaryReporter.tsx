"use client"

import { useEffect } from "react"
import { WORKSPACE_TAB_FRAME_NAME_PREFIX, WORKSPACE_TAB_FRAME_PARAM, WORKSPACE_TAB_MESSAGE_SOURCE, type WorkspaceTabParentMessage } from "@/lib/workspace-tabs"
import { WORKSPACE_FRAME_ERROR_ATTRIBUTE } from "@/lib/workspace-tab-departure"

type ReportableError = Error & { digest?: string }

export function ErrorBoundaryReporter({ error, boundary }: { error: ReportableError; boundary: "app" | "global" }) {
    useEffect(() => {
        const root = document.documentElement
        root.setAttribute(WORKSPACE_FRAME_ERROR_ATTRIBUTE, "true")
        return () => root.removeAttribute(WORKSPACE_FRAME_ERROR_ATTRIBUTE)
    }, [])
    useEffect(() => {
        if (window.self === window.top) return
        const tabId = new URLSearchParams(window.location.search).get(WORKSPACE_TAB_FRAME_PARAM)
            || (window.name.startsWith(WORKSPACE_TAB_FRAME_NAME_PREFIX) ? window.name.slice(WORKSPACE_TAB_FRAME_NAME_PREFIX.length) : "")
        if (!tabId) return
        const url = `${window.location.pathname}${window.location.search}${window.location.hash}`
        const report = () => window.parent.postMessage({
            source: WORKSPACE_TAB_MESSAGE_SOURCE, target: "host", tabId,
            type: "navigation-failed", url,
        }, window.location.origin)
        // A page error unmounts its bridge. Keep the host informed even if its
        // message listener mounted after this boundary's first acknowledgement.
        const receive = (event: MessageEvent<WorkspaceTabParentMessage>) => {
            const message = event.data
            if (event.origin !== window.location.origin || event.source !== window.parent || message?.source !== WORKSPACE_TAB_MESSAGE_SOURCE || message.target !== "frame" || message.tabId !== tabId || message.type !== "probe") return
            report()
        }
        window.addEventListener("message", receive)
        report()
        return () => window.removeEventListener("message", receive)
    }, [error])

    useEffect(() => {
        console.error(error)
        const path = `${window.location.pathname}${window.location.search}`
        const workspaceSlug = window.location.pathname.split("/").filter(Boolean)[0]
        if (!workspaceSlug) return
        void fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/activity/errors`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                boundary,
                digest: error.digest ?? null,
                message: error.message || "Unexpected application error",
                path,
            }),
            keepalive: true,
        }).catch((reportingError) => {
            console.warn("Could not send application error to Admin Activity", reportingError)
        })
    }, [boundary, error])

    return null
}
