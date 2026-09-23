"use client"

import { useEffect, useLayoutEffect, useRef, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
    WORKSPACE_TAB_FRAME_NAME_PREFIX,
    WORKSPACE_TAB_MESSAGE_SOURCE,
    type WorkspaceTabParentMessage,
    WORKSPACE_TAB_FRAME_PARAM,
    workspaceTabFrameUrl,
} from "@/lib/workspace-tabs"

import { captureWorkspaceAutosaveDepartureCheck, checkpointWorkspaceAutosaves, flushWorkspaceAutosaves } from "@/lib/workspace-mutations"
import { createWorkspaceFrameNavigator, WorkspaceFrameDraftError, WORKSPACE_FRAME_NAVIGATION_ATTRIBUTE, WORKSPACE_FRAME_NAVIGATION_EVENT } from "@/lib/workspace-frame-navigation"
import { WORKSPACE_FRAME_DEPARTURE_CONFIRM_EVENT, WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE, type WorkspaceFrameDepartureConfirmation } from "@/lib/workspace-tab-departure"

export function WorkspaceTabFrameGuard() {
    const pathname = usePathname()
    const router = useRouter()
    const searchParams = useSearchParams()

    const [navigationPending, startNavigationTransition] = useTransition()
    const navigatorRef = useRef<ReturnType<typeof createWorkspaceFrameNavigator> | null>(null)

    useEffect(() => {
        if (window.self === window.top) return
        const tabId = new URLSearchParams(window.location.search).get(WORKSPACE_TAB_FRAME_PARAM)
            || (window.name.startsWith(WORKSPACE_TAB_FRAME_NAME_PREFIX) ? window.name.slice(WORKSPACE_TAB_FRAME_NAME_PREFIX.length) : "")
        if (!tabId) return
        const documentId = document.documentElement.getAttribute(WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE) || crypto.randomUUID()
        document.documentElement.setAttribute(WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE, documentId)
        let departureSequence = 0
        let departureCheck: { requestId: string; check: ReturnType<typeof captureWorkspaceAutosaveDepartureCheck>; timer: number } | null = null
        const clearDepartureCheck = () => {
            if (!departureCheck) return
            window.clearTimeout(departureCheck.timer)
            departureCheck.check.dispose()
            departureCheck = null
        }
        const confirmDeparture = (event: Event) => {
            const detail = (event as CustomEvent<WorkspaceFrameDepartureConfirmation>).detail
            if (detail?.documentId !== documentId || detail.requestId !== departureCheck?.requestId) return
            detail.safe = departureCheck.check.validate()
            clearDepartureCheck()
        }
        const currentUrl = () => `${window.location.pathname}${window.location.search}${window.location.hash}`
        const navigator = createWorkspaceFrameNavigator({
            currentUrl, flush: () => flushWorkspaceAutosaves(1500, { navigation: true }),
            push: (url) => startNavigationTransition(() => router.push(url)),
            replace: (url) => startNavigationTransition(() => router.replace(url)),
        })
        navigatorRef.current = navigator
        function navigate(url: string, replace = false) {
            window.dispatchEvent(new Event("betelgeze:workspace-navigation-start"))
            void navigator.navigate(workspaceTabFrameUrl(url, tabId!, window.location.origin), replace).catch((error) => {
                // Failed draft persistence must stop navigation, never discard it.
                const failureReason = error instanceof WorkspaceFrameDraftError ? "drafts" : undefined
                window.parent.postMessage({ source: WORKSPACE_TAB_MESSAGE_SOURCE, target: "host", tabId, type: "navigation-failed", url, failureReason, retainedUrl: failureReason ? currentUrl() : undefined }, window.location.origin)
            })
        }
        function receive(event: MessageEvent<WorkspaceTabParentMessage>) {
            const message = event.data
            if (event.origin !== window.location.origin || event.source !== window.parent || message?.source !== WORKSPACE_TAB_MESSAGE_SOURCE || message.target !== "frame" || message.tabId !== tabId) return
            if (message.type === "prepare-departure" && message.requestId && message.documentId === documentId) {
                const sequence = ++departureSequence
                clearDepartureCheck()
                departureCheck = { requestId: message.requestId, check: captureWorkspaceAutosaveDepartureCheck(), timer: window.setTimeout(clearDepartureCheck, 2_000) }
                const checkpoint = message.checkpointOnly ? Promise.resolve(checkpointWorkspaceAutosaves()) : flushWorkspaceAutosaves(1500, { navigation: true })
                void checkpoint.then((safe) => {
                    if (sequence !== departureSequence || document.documentElement.getAttribute(WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE) !== documentId) return
                    if (!safe) clearDepartureCheck()
                    else departureCheck?.check.acknowledge()
                    window.parent.postMessage({ source: WORKSPACE_TAB_MESSAGE_SOURCE, target: "host", type: "departure-ready", tabId, documentId, requestId: message.requestId, safe }, window.location.origin)
                })
                return
            }
            if ((message.type === "navigate" || message.type === "traverse") && message.url) {
                if (message.type === "traverse") window.dispatchEvent(new Event("betelgeze:clear-loading"))
                navigate(message.url, message.type === "traverse")
            }
        }
        function localNavigate(event: Event) {
            const detail = (event as CustomEvent<{ url: string; replace?: boolean }>).detail
            if (detail?.url) navigate(detail.url, detail.replace)
        }
        window.addEventListener("message", receive)
        window.addEventListener(WORKSPACE_FRAME_NAVIGATION_EVENT, localNavigate)
        window.addEventListener(WORKSPACE_FRAME_DEPARTURE_CONFIRM_EVENT, confirmDeparture)
        document.documentElement.setAttribute(WORKSPACE_FRAME_NAVIGATION_ATTRIBUTE, tabId)
        return () => {
            departureSequence += 1
            clearDepartureCheck()
            navigator.dispose()
            navigatorRef.current = null
            document.documentElement.removeAttribute(WORKSPACE_FRAME_NAVIGATION_ATTRIBUTE)
            document.documentElement.removeAttribute(WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE)
            window.removeEventListener("message", receive)
            window.removeEventListener(WORKSPACE_FRAME_NAVIGATION_EVENT, localNavigate)
            window.removeEventListener(WORKSPACE_FRAME_DEPARTURE_CONFIRM_EVENT, confirmDeparture)
        }
    }, [router, startNavigationTransition])

    useEffect(() => {
        if (navigationPending) return
        navigatorRef.current?.committed(`${pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`)
        // A -> B -> A can finish without changing usePathname. Ask the
        // still-mounted page bridge to acknowledge that retained destination.
        window.dispatchEvent(new Event("betelgeze:frame-navigation-committed"))
    }, [pathname, searchParams, navigationPending])

    useLayoutEffect(() => {
        if (window.self === window.top) return
        const markerTabId = searchParams.get(WORKSPACE_TAB_FRAME_PARAM)
        const namedTabId = window.name.startsWith(WORKSPACE_TAB_FRAME_NAME_PREFIX)
            ? window.name.slice(WORKSPACE_TAB_FRAME_NAME_PREFIX.length)
            : ""
        const tabId = markerTabId || namedTabId
        if (!tabId) return
        window.name = `${WORKSPACE_TAB_FRAME_NAME_PREFIX}${tabId}`
        if (markerTabId) return

        const query = searchParams.toString()
        const current = `${pathname}${query ? `?${query}` : ""}${window.location.hash}`
        router.replace(workspaceTabFrameUrl(current, tabId, window.location.origin), { scroll: false })
    }, [pathname, router, searchParams])

    return null
}
