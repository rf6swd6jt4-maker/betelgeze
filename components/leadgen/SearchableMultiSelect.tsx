"use client"

import { useMemo, useState } from "react"

type Option = { value: string; label: string }

export function SearchableMultiSelect({ name, label, options, selectedValues = [], emptyLabel = "No options available" }: { name: string; label: string; options: Option[]; selectedValues?: string[]; emptyLabel?: string }) {
    const [query, setQuery] = useState("")
    const [selected, setSelected] = useState(() => [...selectedValues])
    const optionByValue = new Map(options.map((option) => [option.value, option]))
    const filtered = useMemo(() => {
        const normalisedQuery = query.trim().toLowerCase()
        if (!normalisedQuery) return options
        return options.filter((option) => option.label.toLowerCase().includes(normalisedQuery))
    }, [options, query])
    const selectedOptions = selected.map((value) => optionByValue.get(value)).filter((option): option is Option => Boolean(option))

    function toggle(value: string) {
        setSelected((current) => {
            const isSelected = current.includes(value)
            if (isSelected) return current.filter((item) => item !== value)
            return [...current, value]
        })
    }

    return <div>
        {selected.map((value) => <input key={value} type="hidden" name={name} value={value} />)}
        <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</label>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-neutral-600" />
        <div className="mt-2 min-h-12 rounded-lg border border-neutral-800 bg-neutral-950 p-2">
            {selectedOptions.length ? <div className="flex flex-wrap gap-2">
                {selectedOptions.map((option) => <button key={option.value} type="button" onClick={() => toggle(option.value)} data-autosave-control="true" className="rounded-full bg-emerald-300/15 px-2.5 py-1 text-xs font-semibold text-emerald-100">
                    {option.label} ×
                </button>)}
            </div> : <p className="px-1 py-2 text-sm text-neutral-600">Nothing selected yet.</p>}
        </div>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                {filtered.length ? <div className="space-y-1">
                    {filtered.map((option) => {
                    const checked = selected.includes(option.value)
                    return <label key={option.value} className="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900">
                        <input type="checkbox" checked={checked} onChange={() => toggle(option.value)} data-autosave-control="true" className="h-4 w-4 accent-white" />
                        <span>{option.label}</span>
                    </label>
                })}
            </div> : <p className="px-2 py-4 text-sm text-neutral-600">{emptyLabel}</p>}
        </div>
    </div>
}
