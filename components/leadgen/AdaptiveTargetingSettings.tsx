"use client"

import { useEffect, useMemo, useState } from "react"
import { SettingsSectionActions } from "@/components/leadgen/ManualSettingsForm"

export type AdaptiveIndustryOption = {
    value: string
    label: string
    category?: string | null
    detail: string
    supportedRegions: string[]
    supportedLocationValues: string[]
}

export type AdaptiveLocationOption = {
    value: string
    label: string
    detail: string
    region?: string | null
}

function SelectionMark({ checked }: { checked: boolean }) {
    return <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${checked ? "border-emerald-300 bg-emerald-300" : "border-neutral-600 bg-black"}`} aria-hidden="true">
        {checked && <span className="h-2.5 w-2.5 rounded-sm bg-black" />}
    </span>
}

function optionMatches(option: { label: string; detail?: string }, query: string) {
    const normalised = query.trim().toLowerCase()
    if (!normalised) return true
    return `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(normalised)
}

function formatRegions(regions: string[]) {
    if (regions.length === 0) return "No state-backed source mappings yet"
    if (regions.length <= 4) return `Backed in ${regions.join(", ")}`
    return `Backed in ${regions.slice(0, 4).join(", ")} +${regions.length - 4} more`
}

function MultiSelectList({
    name,
    label,
    options,
    selectedValues,
    onChange,
    emptyLabel = "No options available",
}: {
    name: string
    label: string
    options: Array<{ value: string; label: string; detail?: string }>
    selectedValues: string[]
    onChange: (values: string[]) => void
    emptyLabel?: string
}) {
    const [query, setQuery] = useState("")
    const optionByValue = new Map(options.map((option) => [option.value, option]))
    const selectedOptions = selectedValues.map((value) => optionByValue.get(value)).filter((option): option is { value: string; label: string; detail?: string } => Boolean(option))
    const filtered = useMemo(() => options.filter((option) => optionMatches(option, query)), [options, query])

    function toggle(value: string) {
        onChange(selectedValues.includes(value) ? selectedValues.filter((item) => item !== value) : [...selectedValues, value])
    }

    return <div>
        {selectedValues.map((value) => <input key={value} type="hidden" name={name} value={value} />)}
        <div className="flex items-center justify-between gap-3">
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</label>
            <span className="inline-flex h-6 items-center rounded-md border border-neutral-800 bg-neutral-950 px-2 text-xs text-neutral-500">{selectedOptions.length} selected</span>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm normal-case tracking-normal text-white placeholder:text-neutral-600" />
        <div className="mt-2 min-h-11 rounded-lg border border-neutral-800 bg-neutral-950 p-2">
            {selectedOptions.length ? <div className="flex flex-wrap gap-2">
                {selectedOptions.map((option) => <button
                    key={option.value}
                    type="button"
                    onClick={() => toggle(option.value)}
                    data-settings-control="true"
                    className="inline-flex min-h-7 items-center justify-center gap-1 rounded-md border border-emerald-300/30 bg-emerald-300/15 px-2.5 text-xs font-semibold leading-none text-emerald-100 transition hover:bg-emerald-300/20"
                    aria-label={`Remove ${option.label}`}
                >
                    {option.label}
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-emerald-500/20 text-xs font-bold leading-none text-emerald-100 hover:bg-emerald-500/30">x</span>
                </button>)}
            </div> : <p className="px-1 py-2 text-sm text-neutral-600">Nothing selected yet.</p>}
        </div>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950 p-1.5">
            {filtered.length ? <div className="space-y-1">
                {filtered.map((option) => {
                    const checked = selectedValues.includes(option.value)
                    return <button key={option.value} type="button" onClick={() => toggle(option.value)} data-settings-control="true" className={`flex w-full min-h-10 items-start gap-3 rounded-md px-2 py-2 text-left text-sm transition ${checked ? "bg-emerald-300/10 text-white" : "text-neutral-300 hover:bg-neutral-900"}`} aria-pressed={checked}>
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

export function AdaptiveTargetingSettings({
    industries,
    locations,
    selectedIndustries,
    selectedLocations,
}: {
    industries: AdaptiveIndustryOption[]
    locations: AdaptiveLocationOption[]
    selectedIndustries: string[]
    selectedLocations: string[]
}) {
    const [industryValues, setIndustryValues] = useState(selectedIndustries)
    const [locationValues, setLocationValues] = useState(selectedLocations)
    const selectedRegions = useMemo(() => {
        const regions = locations
            .filter((location) => locationValues.includes(location.value))
            .map((location) => location.region?.toUpperCase())
            .filter((region): region is string => Boolean(region))
        return new Set(regions)
    }, [locationValues, locations])
    const selectedLocationSet = useMemo(() => new Set(locationValues), [locationValues])
    const availableIndustries = useMemo(() => {
        if (selectedRegions.size === 0 && selectedLocationSet.size === 0) return industries
        return industries.filter((industry) => {
            if (industry.supportedLocationValues.some((value) => selectedLocationSet.has(value))) return true
            if (selectedRegions.size === 0) return true
            return industry.supportedRegions.some((region) => selectedRegions.has(region.toUpperCase()))
        })
    }, [industries, selectedLocationSet, selectedRegions])
    const availableIndustryValues = useMemo(() => new Set(availableIndustries.map((industry) => industry.value)), [availableIndustries])
    const effectiveIndustryValues = useMemo(() => industryValues.filter((value) => availableIndustryValues.has(value)), [availableIndustryValues, industryValues])

    useEffect(() => {
        const reset = (event: Event) => {
            const section = (event as CustomEvent<string>).detail
            if (section === "target-industries") setIndustryValues(selectedIndustries)
            if (section === "target-locations") setLocationValues(selectedLocations)
        }
        window.addEventListener("betelgeze:settings-section-revert", reset)
        return () => window.removeEventListener("betelgeze:settings-section-revert", reset)
    }, [selectedIndustries, selectedLocations])

    const industryOptions = availableIndustries.map((industry) => ({
        value: industry.value,
        label: industry.label,
        detail: `${industry.category ?? "industry"}. ${industry.detail}. ${formatRegions(industry.supportedRegions)}`,
    }))

    return <section className="grid gap-4">
        <div data-settings-section="target-industries" className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
            <h2 className="text-lg font-semibold leading-6">Target Industries</h2>
            <p className="mt-1.5 text-sm leading-5 text-neutral-400">Shared industry targets filtered to the states and cities currently selected below.</p>
            <div className="mt-4">
                <MultiSelectList
                    name="sourceConfig:icp:industries"
                    label="Target industries"
                    options={industryOptions}
                    selectedValues={effectiveIndustryValues}
                    onChange={setIndustryValues}
                    emptyLabel="No mapped contractor industries are available for the selected locations yet."
                />
            </div>
            <SettingsSectionActions section="target-industries" label="target industries" />
        </div>
        <div data-settings-section="target-locations" className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
            <h2 className="text-lg font-semibold leading-6">Target Locations</h2>
            <p className="mt-1.5 text-sm leading-5 text-neutral-400">Shared geography targets used by source mappings and poll tasks.</p>
            <div className="mt-4">
                <MultiSelectList
                    name="sourceConfig:icp:locations"
                    label="Target locations"
                    options={locations}
                    selectedValues={locationValues}
                    onChange={setLocationValues}
                />
            </div>
            <SettingsSectionActions section="target-locations" label="target locations" />
        </div>
    </section>
}
