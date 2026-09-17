"use client"

import { useEffect, useState } from "react"
import { useWorkspaceNavigation } from "./WorkspaceNavigation"
import { WORKSPACE_TAB_VISIBILITY_EVENT } from "@/lib/workspace-tabs"
import { workspaceDocumentIsActive } from "@/lib/workspace-tab-activity"

export { WORKSPACE_TAB_VISIBILITY_EVENT } from "@/lib/workspace-tabs"

export function useWorkspaceTabActive() {
    const navigation = useWorkspaceNavigation()
    // Match the server render; activation belongs to the hydrated document.
    const [active, setActive] = useState(false)

    useEffect(() => {
        const update = () => setActive(workspaceDocumentIsActive())
        update()
        window.addEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, update)
        return () => window.removeEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, update)
    }, [])

    return navigation?.active ?? active
}
