"use client"

import { useLayoutEffect, useMemo, useRef } from "react"
import { Assignee, SelectorDrawer, SelectorOption } from "@/components/ui"
import type { MentionPerson } from "@/lib/chat-formatting"
import { composerMentionSuggestions, suggestionKey, type ComposerMentionSuggestion, type ReferenceContext } from "@/lib/communications/reference-suggestions"
import { ReferenceIcon } from "./ReferenceIcon"
import { useComposerReferenceSearch } from "./useComposerReferenceSearch"

export function ComposerMentionPicker({ anchor, people, query, referenceContext, frozenSuggestions, active, onSelect, onSuggestions, onHighlight, onDismiss }: {
    anchor: HTMLElement | null
    people: MentionPerson[]
    query: string
    referenceContext?: ReferenceContext
    frozenSuggestions?: ComposerMentionSuggestion[]
    active: number
    onSelect: (suggestion: ComposerMentionSuggestion) => void
    onSuggestions: (query: string, suggestions: ComposerMentionSuggestion[]) => void
    onHighlight: (active: number, suggestions: ComposerMentionSuggestion[]) => void
    onDismiss: () => void
}) {
    const options = useRef<HTMLDivElement>(null)
    const search = useComposerReferenceSearch(referenceContext, query)
    const suggestions = useMemo(() => frozenSuggestions ?? composerMentionSuggestions(people, search.results, query), [frozenSuggestions, people, search.results, query])
    useLayoutEffect(() => { onSuggestions(query, suggestions) }, [onSuggestions, query, suggestions])
    useLayoutEffect(() => {
        const button = options.current?.querySelector<HTMLButtonElement>(`[data-mention-index="${active}"]`)
        // Scroll only the menu; scrollIntoView could move the composer or shell.
        const scroller = options.current
        if (!button || !scroller) return
        const row = button.getBoundingClientRect(), frame = scroller.getBoundingClientRect()
        if (row.top < frame.top) scroller.scrollTop -= frame.top - row.top
        else if (row.bottom > frame.bottom) scroller.scrollTop += row.bottom - frame.bottom
    }, [active, suggestions])
    const status = search.status === "loading" ? "Searching…" : search.status === "error" ? "Record search unavailable. Type to retry." : !suggestions.length ? "No matches" : ""
    function distinguishingDetail(suggestion: ComposerMentionSuggestion) {
        if (suggestion.type === "person") return undefined
        const twins = suggestions.filter(item => item.type === suggestion.type && item.id !== suggestion.id && item.label.toLocaleLowerCase() === suggestion.label.toLocaleLowerCase())
        if (!twins.length || (suggestion.detail && twins.every(item => item.type !== "person" && item.detail !== suggestion.detail))) return suggestion.detail
        return `${suggestion.detail ? `${suggestion.detail} · ` : ""}#${suggestion.id.slice(-8)}`
    }
    return <SelectorDrawer anchor={anchor} onDismiss={onDismiss} ariaLabel="Insert a reference" autoFocusOptions={false}>
        <div ref={options} data-composer-scroll data-reference-picker aria-busy={search.status === "loading"} className="max-h-[min(12rem,40dvh)] touch-pan-y overflow-y-auto overscroll-contain">
            {suggestions.map((suggestion, index) => {
                const detail = distinguishingDetail(suggestion)
                return <SelectorOption key={suggestionKey(suggestion)} data-mention-index={index} aria-label={`${suggestion.type === "person" ? "Mention" : suggestion.type === "work_item" ? "Reference work item" : `Reference ${suggestion.type}`} ${suggestion.label}${detail ? `, ${detail}` : ""}`} aria-current={index === active || undefined} selected={index === active} active={index === active} showCheck={false}
                onPointerDown={(event) => { event.preventDefault(); onHighlight(index, suggestions) }}
                onClick={() => onSelect(suggestion)}>
                <span className="flex min-h-8 min-w-0 items-center gap-2">
                    {suggestion.type === "person" ? <Assignee compact name={suggestion.person.name} avatarSrc={suggestion.person.avatarSrc} /> : <ReferenceIcon type={suggestion.type} className="h-[18px] w-[18px] text-neutral-400" />}
                    <span className="min-w-0">
                        <span className="block truncate">{suggestion.label}</span>
                        {detail ? <span className="block truncate text-[11px] leading-4 text-neutral-500">{detail}</span> : null}
                    </span>
                </span>
            </SelectorOption>})}
            {status ? <p role="status" className={suggestions.length && search.status === "loading" ? "sr-only" : "px-3 py-3 text-xs text-neutral-500"}>{status}</p> : null}
        </div>
    </SelectorDrawer>
}
