"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { createWorkspaceSearchController, workspaceSearchState, type WorkspaceSearchInput, type WorkspaceSearchKey } from "@/lib/workspace-search"

export function useWorkspaceSearch(input: WorkspaceSearchInput) {
    const [controller] = useState(() => createWorkspaceSearchController())
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
    const { scope, userId, workspaceId, workspaceSlug, query, open } = input
    useEffect(() => {
        controller.update({ scope, userId, workspaceId, workspaceSlug, query, open })
    }, [controller, scope, userId, workspaceId, workspaceSlug, query, open])
    useEffect(() => () => controller.dispose(), [controller])
    return {
        state: workspaceSearchState(snapshot, input),
        moveSelection: (key: WorkspaceSearchKey) => { if (workspaceSearchState(controller.getSnapshot(), input).status === "results") controller.moveSelection(key) },
        selected: (id?: string) => controller.selected(input, id),
        retry: () => { if (controller.getSnapshot().key === workspaceSearchState(controller.getSnapshot(), input).key) controller.retry() },
        invalidate: useCallback(() => controller.invalidate(), [controller]),
    }
}
