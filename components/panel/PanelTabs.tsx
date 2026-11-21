"use client"

import Link from "@/components/workspace/WorkspaceLink"
import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "@/components/workspace/WorkspaceNavigation"

import { WORKSPACE_TAB_FRAME_PARAM, workspaceTabFrameUrl } from "@/lib/workspace-tabs"
import { PanelTabStrip, panelTabClass, panelTabStripClass } from "@/components/panel/PanelTabStrip"

export type PanelTab = {
    key: string
    label: string
    href: string
}

export function PanelTabs({ items, active, ariaLabel }: { items: readonly PanelTab[]; active: string; ariaLabel: string }) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const tabId = searchParams.get(WORKSPACE_TAB_FRAME_PARAM)
    const [optimisticSelection, setOptimisticSelection] = useState<{ base: string; value: string } | null>(null)
    const optimisticActive = optimisticSelection?.base === active ? optimisticSelection.value : active
    const framedItems = useMemo(() => items.map((item) => ({
        ...item,
        navigationHref: tabId ? workspaceTabFrameUrl(item.href, tabId, "http://localhost") : item.href,
    })), [items, tabId])

    useEffect(() => {
        if (!tabId) return
        const activeIndex = framedItems.findIndex((item) => item.key === active)
        const likelyItems = [framedItems[activeIndex + 1], framedItems[activeIndex - 1]].filter((item): item is (typeof framedItems)[number] => Boolean(item))
        const warm = () => likelyItems.forEach((item) => router.prefetch(item.navigationHref))
        const requestIdle = window.requestIdleCallback
        if (typeof requestIdle === "function") {
            const idleId = requestIdle(warm, { timeout: 800 })
            return () => window.cancelIdleCallback(idleId)
        }
        const timeout = window.setTimeout(warm, 120)
        return () => window.clearTimeout(timeout)
    }, [active, framedItems, router, tabId])

    return <PanelTabStrip ariaLabel={ariaLabel}>
        {framedItems.map((item) => <Link
            key={item.key}
            href={item.navigationHref}
            aria-current={optimisticActive === item.key ? "page" : undefined}
            onPointerEnter={() => { if (tabId) router.prefetch(item.navigationHref) }}
            onFocus={() => { if (tabId) router.prefetch(item.navigationHref) }}
            onClick={() => setOptimisticSelection({ base: active, value: item.key })}
            className={panelTabClass(optimisticActive === item.key)}
        >
            {item.label}
        </Link>)}
    </PanelTabStrip>
}

/** Local detail sections share panel-tab geometry without prefetching hidden data. */
export function PanelSectionTabs<T extends string>({ items, active, onChange, ariaLabel }: { items: readonly {key: T; label: string}[]; active: T; onChange: (key: T) => void; ariaLabel: string }) {
    return <nav aria-label={ariaLabel} className={`my-5 ${panelTabStripClass}`}>
        {items.map(item => <button type="button" key={item.key} aria-current={active === item.key ? "page" : undefined} onClick={() => onChange(item.key)} className={panelTabClass(active === item.key)}>{item.label}</button>)}
    </nav>
}
