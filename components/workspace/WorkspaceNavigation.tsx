"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { usePathname as useNextPathname, useRouter as useNextRouter, useSearchParams as useNextSearchParams } from "next/navigation"
import type { WorkspaceTabRelationshipContext } from "@/lib/workspace-tabs"

export type WorkspaceNavigation = {
    tabId: string
    workspaceSlug: string
    url: string
    active: boolean
    push: (href: string) => void
    replace: (href: string) => void
    refresh: () => void
    back: () => void
    forward: () => void
    prefetch: (href: string) => void
    context: (value: WorkspaceTabRelationshipContext | null) => void
}

const Navigation = createContext<WorkspaceNavigation | null>(null)

export function WorkspaceNavigationProvider({ value, children }: { value: WorkspaceNavigation; children: ReactNode }) {
    return <Navigation.Provider value={value}>{children}</Navigation.Provider>
}

export function useWorkspaceNavigation() { return useContext(Navigation) }

// Components also appear on standalone routes. Always call the framework hook
// and only replace its public navigation methods inside a native workspace tab.
export function useRouter() {
    const router = useNextRouter()
    const local = useWorkspaceNavigation()
    return useMemo(() => local ? {
        ...router,
        push: local.push, replace: local.replace, refresh: local.refresh,
        back: local.back, forward: local.forward, prefetch: local.prefetch,
    } : router, [local, router])
}

export function usePathname() {
    const pathname = useNextPathname()
    const local = useWorkspaceNavigation()
    return local ? new URL(local.url, "http://workspace.invalid").pathname : pathname
}

export function useSearchParams() {
    const search = useNextSearchParams()
    const local = useWorkspaceNavigation()
    const localUrl = local?.url
    return useMemo(() => localUrl ? new URL(localUrl, "http://workspace.invalid").searchParams : search, [localUrl, search])
}
