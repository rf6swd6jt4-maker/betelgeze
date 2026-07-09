"use client"

import { useLayoutEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
    WORKSPACE_TAB_FRAME_NAME_PREFIX,
    WORKSPACE_TAB_FRAME_PARAM,
    workspaceTabFrameUrl,
} from "@/lib/workspace-tabs"

export function WorkspaceTabFrameGuard() {
    const pathname = usePathname()
    const router = useRouter()
    const searchParams = useSearchParams()

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
