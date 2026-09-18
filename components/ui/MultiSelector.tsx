"use client"

import { useMemo, useState } from "react"
import { SelectorDrawer, SelectorOption, SelectorTrigger } from "./Selector"

export type MultiSelectorOption = {
    id: string
    label: string
    description?: string
}

export function MultiSelector({ name, label, placeholder, description = "Choose any records that belong here.", options, selected, onChange, disabled = false, maxSelections }: {
    name?: string
    label: string
    placeholder: string
    description?: string
    options: MultiSelectorOption[]
    selected: string[]
    onChange: (ids: string[]) => void
    disabled?: boolean
    maxSelections?: number
}) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null)
    const [query, setQuery] = useState("")
    const visible = useMemo(() => {
        const normalized = query.trim().toLowerCase()
        return normalized ? options.filter((option) => `${option.label} ${option.description ?? ""}`.toLowerCase().includes(normalized)) : options
    }, [options, query])
    const selectedSet = useMemo(() => new Set(selected), [selected])

    return <>
        {name ? selected.map((id) => <input key={id} type="hidden" name={name} value={id} />) : null}
        <SelectorTrigger open={Boolean(anchor)} appearance="input" disabled={disabled} aria-label={label} onClick={(event) => { setQuery(""); setAnchor((current) => current ? null : event.currentTarget) }}>
            {selected.length ? `${selected.length} selected` : <span className="text-neutral-600">{placeholder}</span>}
        </SelectorTrigger>
        {anchor ? <SelectorDrawer anchor={anchor} ariaLabel={label} title={label} description={description} search={query} onSearch={options.length >= 7 ? setQuery : undefined} onDismiss={() => { setAnchor(null); setQuery("") }} footer={<button type="button" onClick={() => setAnchor(null)} className="min-h-9 w-full rounded-lg px-2 text-sm text-neutral-300 hover:bg-neutral-900">Done</button>}>
            {visible.map((option) => {
                const selectedOption = selectedSet.has(option.id)
                const limitReached = !selectedOption && maxSelections !== undefined && selected.length >= maxSelections
                return <SelectorOption key={option.id} selected={selectedOption} disabled={limitReached} description={option.description} onClick={() => onChange(selectedOption ? selected.filter((id) => id !== option.id) : [...selected, option.id])}>{option.label}</SelectorOption>
            })}
            {!visible.length ? <p className="px-2.5 py-3 text-xs text-neutral-500">No matching records.</p> : null}
        </SelectorDrawer> : null}
    </>
}
