"use client"

import { useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
    normalizeWorkspaceUrl,
    WORKSPACE_TAB_FRAME_PARAM,
    WORKSPACE_TAB_MESSAGE_SOURCE,
    workspaceTabFrameUrl,
    type WorkspaceTabFrameMessage,
    type WorkspaceTabParentMessage,
} from "@/lib/workspace-tabs"
import { WORKSPACE_TAB_VISIBILITY_EVENT } from "@/components/workspace/useWorkspaceTabActive"

type Props = {
    tabId: string
    workspaceSlug: string
}

export function WorkspaceTabBridge({ tabId, workspaceSlug }: Props) {
    const pathname = usePathname()
    const router = useRouter()
    const searchParams = useSearchParams()

    useEffect(() => {
        function reportLocation() {
            const query = searchParams.toString()
            const url = normalizeWorkspaceUrl(`${pathname}${query ? `?${query}` : ""}${window.location.hash}`, workspaceSlug, window.location.origin)
            const message: WorkspaceTabFrameMessage = {
                source: WORKSPACE_TAB_MESSAGE_SOURCE,
                target: "host",
                tabId,
                type: "location",
                url,
            }
            window.parent.postMessage(message, window.location.origin)
        }

        reportLocation()
        window.addEventListener("hashchange", reportLocation)
        return () => window.removeEventListener("hashchange", reportLocation)
    }, [pathname, searchParams, tabId, workspaceSlug])

    useEffect(() => {
        function preserveFrameNavigation(event: MouseEvent) {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            const target = event.target
            if (!(target instanceof Element)) return
            const anchor = target.closest("a[href]") as HTMLAnchorElement | null
            if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return
            const destination = new URL(anchor.href, window.location.href)
            if (destination.origin !== window.location.origin || destination.searchParams.has(WORKSPACE_TAB_FRAME_PARAM)) return
            event.preventDefault()
            router.push(workspaceTabFrameUrl(`${destination.pathname}${destination.search}${destination.hash}`, tabId, window.location.origin))
        }

        function receiveHostMessage(event: MessageEvent<WorkspaceTabParentMessage>) {
            if (event.origin !== window.location.origin) return
            const message = event.data
            if (message?.source !== WORKSPACE_TAB_MESSAGE_SOURCE || message.target !== "frame" || message.tabId !== tabId) return

            if (message.type === "navigate" && message.url) {
                router.push(workspaceTabFrameUrl(message.url, tabId, window.location.origin))
            } else if (message.type === "back") {
                router.back()
            } else if (message.type === "forward") {
                router.forward()
            } else if (message.type === "activate") {
                document.body.dataset.workspaceTabActive = message.active ? "true" : "false"
                window.dispatchEvent(new Event(WORKSPACE_TAB_VISIBILITY_EVENT))
                if (message.active && message.refresh) router.refresh()
            }
        }

        function reportPossibleMutation() {
            const message: WorkspaceTabFrameMessage = {
                source: WORKSPACE_TAB_MESSAGE_SOURCE,
                target: "host",
                tabId,
                type: "mutation",
            }
            window.parent.postMessage(message, window.location.origin)
        }

        window.addEventListener("message", receiveHostMessage)
        document.addEventListener("click", preserveFrameNavigation, true)
        document.addEventListener("submit", reportPossibleMutation, true)
        window.addEventListener("betelgeze:workspace-mutation", reportPossibleMutation)
        return () => {
            window.removeEventListener("message", receiveHostMessage)
            document.removeEventListener("click", preserveFrameNavigation, true)
            document.removeEventListener("submit", reportPossibleMutation, true)
            window.removeEventListener("betelgeze:workspace-mutation", reportPossibleMutation)
            delete document.body.dataset.workspaceTabActive
        }
    }, [router, tabId])

    return null
}
