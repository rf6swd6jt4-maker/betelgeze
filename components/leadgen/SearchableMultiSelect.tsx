"use client"

import { useMemo, useState } from "react"

type Option = { value: string; label: string; detail?: string }

function SelectionMark({ checked }: { checked: boolean }) {
    return <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${checked ? "border-emerald-300 bg-emerald-300" : "border-neutral-600 bg-black"}`} aria-hidden="true">
        {checked && <span className="h-2.5 w-2.5 rounded-sm bg-black" />}
    </span>
}

export function SearchableMultiSelect({ name, label, options, selectedValues = [], emptyLabel = "No options available" }: { name: string; label: string; options: Option[]; selectedValues?: string[]; emptyLabel?: string }) {
    const [query, setQuery] = useState("")
    const [selected, setSelected] = useState(() => [...selectedValues])
    const optionByValue = new Map(options.map((option) => [option.value, option]))
    const filtered = useMemo(() => {
        const normalisedQuery = query.trim().toLowerCase()
        if (!normalisedQuery) return options
        return options.filter((option) => `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(normalisedQuery))
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
        <div className="flex items-center justify-between gap-3">
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</label>
            <span className="text-xs text-neutral-500">{selected.length} selected</span>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-neutral-600" />
        <div className="mt-2 min-h-12 rounded-lg border border-neutral-800 bg-neutral-950 p-2">
            {selectedOptions.length ? <div className="flex flex-wrap gap-2">
                {selectedOptions.map((option) => <button key={option.value} type="button" onClick={() => toggle(option.value)} data-autosave-control="true" className="rounded-full border border-emerald-300/30 bg-emerald-300/15 px-2.5 py-1 text-xs font-semibold text-emerald-100">
                    {option.label} <span className="text-emerald-300">remove</span>
                </button>)}
            </div> : <p className="px-1 py-2 text-sm text-neutral-600">Nothing selected yet.</p>}
        </div>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950 p-2">
            {filtered.length ? <div className="space-y-1">
                {filtered.map((option) => {
                    const checked = selected.includes(option.value)
                    return <button key={option.value} type="button" onClick={() => toggle(option.value)} data-autosave-control="true" className={`flex w-full min-h-10 items-start gap-3 rounded-md px-2 py-2 text-left text-sm transition ${checked ? "bg-emerald-300/10 text-white" : "text-neutral-300 hover:bg-neutral-900"}`} aria-pressed={checked}>
                        <SelectionMark checked={checked} />
                        <span className="min-w-0">
                            <span className="block leading-5">{option.label}</span>
                            {option.detail && <span className="mt-0.5 block text-xs leading-4 text-neutral-500">{option.detail}</span>}
                        </span>
                    </button>
                })}
            </div> : <p className="px-2 py-4 text-sm text-neutral-600">{emptyLabel}</p>}
        </div>
    </div>
}
