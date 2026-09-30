"use client"

import { useEffect, useRef } from "react"
import { RoundPill, Status } from "@/components/ui"
import { shortId } from "@/lib/ui/relative-time"
import type { WorkspaceSearchResult, WorkspaceSearchState } from "@/lib/workspace-search"

export function WorkspaceSearchResults({ id, state, mobile = false, onChoose, onRetry, isStandalone = () => false }: {
    id: string
    state: WorkspaceSearchState
    mobile?: boolean
    onChoose: (result: WorkspaceSearchResult) => void
    onRetry: () => void
    isStandalone?: (href: string) => boolean
}) {
    const list = useRef<HTMLDivElement>(null)
    useEffect(() => {
        list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
    }, [state.key, state.selectedIndex])
    const message = state.status === "idle" ? "Type at least two characters." : state.status === "loading" ? "Searching…" : state.status === "empty" ? "No results found." : state.status === "error" ? state.error : `${state.results.length} results. Use arrow keys to choose.`
    return <>
        <p role="status" aria-live="polite" className={state.status === "results" ? "sr-only" : "px-3 py-3 text-sm text-neutral-400"}>{message}</p>
        {state.status === "error" && !state.error?.includes("Reload") && <button type="button" onClick={onRetry} className="mb-2 ml-3 min-h-11 px-2 text-sm text-neutral-100 underline underline-offset-4 md:min-h-9">Retry search</button>}
        <div ref={list} id={id} role="listbox" aria-label="Search results" aria-busy={state.status === "loading"}>
            {state.status === "results" && state.results.map((item, index) => <a key={item.id} id={`${id}-${index}`} role="option" aria-selected={index === state.selectedIndex} href={item.href} tabIndex={-1} data-global-loading="false"
                target={isStandalone(item.href) ? "_blank" : undefined} rel={isStandalone(item.href) ? "noopener noreferrer" : undefined}
                className={`block border-b border-neutral-900 px-3 ${mobile ? "py-3" : "py-2"} last:border-0 hover:bg-neutral-900 ${index === state.selectedIndex ? "bg-neutral-900" : ""}`}
                onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onChoose(item) }}>
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-neutral-100">{item.label}</p>
                        {item.path && <p className="mt-0.5 truncate text-[11px] text-neutral-400">{item.path}</p>}
                        <p className={`mt-0.5 text-xs text-neutral-500 ${mobile ? "line-clamp-2" : "truncate"}`}>{item.description}</p>
                        {item.matchReason && <p className="mt-1 text-xs text-neutral-400">{item.matchReason}</p>}
                        {item.archived && <div className="mt-1"><Status label="Archived" tone="grey" /></div>}
                        {item.recordId && <p className="mt-1 truncate font-mono text-[10px] text-neutral-600">{shortId(item.recordId)}</p>}
                    </div>
                    <RoundPill className="shrink-0">{item.type}</RoundPill>
                </div>
            </a>)}
        </div>
    </>
}
