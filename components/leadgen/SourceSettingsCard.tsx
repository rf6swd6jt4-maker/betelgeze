"use client"

import { useMemo, useState } from "react"
import type { LeadgenSourceKey } from "@/lib/leadgen/sources"

type SourceStatus = "not_configured" | "not_mapped" | "disabled" | "enabled"
type ToggleState = "on" | "off" | "mixed"

type SourceSettings = {
    limit: number
    radiusMeters: number
    crawlDepth: number
    timeoutSeconds: number
    respectRobots: boolean
    release: string
    notes: string
}

export type SourceCatalogueStats = {
    active: number
    validationOnly: number
    needsWork: number
    blocked: number
}

export type SourceSettingsItem = {
    value: LeadgenSourceKey
    label: string
    detail: string
    statusLabel: string
    notesPlaceholder: string
    kind: "seed" | "enrichment"
    category: "general" | "location" | "industry"
    configured: boolean
    mapped: boolean
    enabled: boolean
    implemented: boolean
    apiKeyConfigured: boolean
    envVar: string | null
    setupHint: string | null
    mappingIndustryText: string
    mappingLocationText: string
    mappingReason: string
    selectedMappedIndustryLabels: string[]
    selectedUnmappedIndustryLabels: string[]
    selectedMappedLocationLabels: string[]
    selectedUnmappedLocationLabels: string[]
    allMappedIndustryLabels: string[]
    allMappedLocationLabels: string[]
    settings: SourceSettings
}

type SourceCategory = {
    key: SourceSettingsItem["category"]
    title: string
    detail: string
}

const ENRICHMENT_CATEGORIES: SourceCategory[] = [
    { key: "general", title: "General enrichment", detail: "Runs for any candidate once seed sources have created companies." },
    { key: "industry", title: "Industry-specific", detail: "Depends on mapped trades, verticals, licensing types, or NAICS-like tags." },
    { key: "location", title: "Location-specific", detail: "Depends on mapped states, cities, counties, or regional public records." },
]

function runnable(source: SourceSettingsItem) {
    return source.configured && source.mapped
}

function statusFor(source: SourceSettingsItem, enabledValues: Set<LeadgenSourceKey>): SourceStatus {
    if (!source.configured) return "not_configured"
    if (!source.mapped) return "not_mapped"
    return enabledValues.has(source.value) ? "enabled" : "disabled"
}

function statusText(status: SourceStatus) {
    if (status === "enabled") return "Enabled"
    if (status === "disabled") return "Disabled"
    if (status === "not_mapped") return "Not mapped"
    return "Not configured"
}

function statusClass(status: SourceStatus) {
    if (status === "enabled") return "border-emerald-300/40 bg-emerald-300/15 text-emerald-100"
    if (status === "disabled") return "border-neutral-500/40 bg-neutral-500/10 text-neutral-300"
    if (status === "not_mapped") return "border-amber-300/40 bg-amber-300/15 text-amber-100"
    return "border-red-300/40 bg-red-300/15 text-red-100"
}

function statusTone(status: SourceStatus) {
    if (status === "enabled") return "text-emerald-200"
    if (status === "disabled") return "text-neutral-300"
    if (status === "not_mapped") return "text-amber-200"
    return "text-red-200"
}

function statusDescription(source: SourceSettingsItem, status: SourceStatus, enabled: boolean) {
    if (status === "enabled") return "Enabled and ready with the current ICP."
    if (status === "disabled") {
        return enabled
            ? "Ready with the current ICP."
            : "Current ICP is supported. Toggle on to include it in this workspace's polls."
    }
    if (status === "not_mapped") return source.mappingReason || "Current ICP industries or locations do not map to this source."
    if (source.setupHint) return source.setupHint
    if (source.envVar) return `${source.envVar} is not set for this environment.`
    return "Source config is incomplete or unavailable."
}

function formatList(values: string[], empty: string) {
    if (values.length === 0) return empty
    if (values.length <= 4) return values.join(", ")
    return `${values.slice(0, 4).join(", ")} +${values.length - 4} more`
}

function MappingLine({ label, values, tone = "neutral" }: { label: string; values: string[]; tone?: "neutral" | "good" | "warn" }) {
    const toneClass = tone === "good" ? "text-emerald-100" : tone === "warn" ? "text-amber-100" : "text-neutral-300"
    return <p className="text-xs leading-5 text-neutral-500"><span className="font-medium text-neutral-400">{label}:</span> <span className={toneClass}>{formatList(values, "None")}</span></p>
}

function ToggleBox({ state }: { state: ToggleState }) {
    const active = state === "on"
    const mixed = state === "mixed"
    return <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${active ? "border-emerald-300 bg-emerald-300" : mixed ? "border-amber-300 bg-amber-300/20" : "border-neutral-600 bg-black"}`} aria-hidden="true">
        {active && <span className="h-2.5 w-2.5 rounded-[3px] bg-black" />}
        {mixed && <span className="h-0.5 w-2.5 rounded-full bg-amber-200" />}
    </span>
}

function SourceToggle({ source, enabled, onToggle }: { source: SourceSettingsItem; enabled: boolean; onToggle: (source: SourceSettingsItem, checked: boolean) => void }) {
    if (!runnable(source)) {
        return <span className="mt-0.5 inline-flex rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Locked</span>
    }
    return <button
        type="button"
        role="checkbox"
        aria-checked={enabled}
        onClick={() => onToggle(source, !enabled)}
        data-autosave-control="true"
        className="inline-flex h-8 items-center justify-center gap-2 rounded-lg px-1.5 text-xs text-neutral-300 transition hover:text-white"
        aria-label={`${enabled ? "Disable" : "Enable"} ${source.label}`}
    >
        <ToggleBox state={enabled ? "on" : "off"} />
        <span className="hidden font-medium sm:inline">{enabled ? "On" : "Off"}</span>
    </button>
}

function CategoryToggle({ sources, enabledValues, onToggle }: { sources: SourceSettingsItem[]; enabledValues: Set<LeadgenSourceKey>; onToggle: (checked: boolean) => void }) {
    const runnableSources = sources.filter(runnable)
    const enabledCount = runnableSources.filter((source) => enabledValues.has(source.value)).length
    const checked = runnableSources.length > 0 && enabledCount === runnableSources.length
    const mixed = enabledCount > 0 && enabledCount < runnableSources.length
    const disabled = runnableSources.length === 0

    return <button
        type="button"
        role="checkbox"
        aria-checked={mixed ? "mixed" : checked}
        disabled={disabled}
        onClick={() => onToggle(!checked)}
        data-autosave-control="true"
        className="inline-flex h-8 items-center justify-center gap-2 rounded-lg px-1.5 text-xs text-neutral-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
        aria-label="Toggle runnable sources in this category"
    >
        <ToggleBox state={checked ? "on" : mixed ? "mixed" : "off"} />
        <span className="hidden font-medium sm:inline">{checked ? "All on" : mixed ? "Some" : "Off"}</span>
    </button>
}

function SourceRow({ source, enabled, expanded, onToggle, onExpand }: { source: SourceSettingsItem; enabled: boolean; expanded: boolean; onToggle: (source: SourceSettingsItem, checked: boolean) => void; onExpand: (source: SourceSettingsItem) => void }) {
    const status = statusFor(source, new Set(enabled ? [source.value] : []))
    const showRadius = source.kind === "seed"
    const showRelease = source.value === "overture" || source.value === "alltheplaces"
    const maxLimit = source.value === "overture" ? 500 : source.value === "sam_gov" ? 1 : source.kind === "seed" ? 25 : 80
    const icpSummary = `${source.mappingIndustryText} · ${source.mappingLocationText}`

    return <div className={`rounded-lg border transition ${enabled ? "border-emerald-300/25 bg-emerald-300/[0.06]" : "border-neutral-800 bg-black/35 hover:border-neutral-700"}`}>
        <div className="grid gap-3 px-3 py-3 sm:grid-cols-[72px_minmax(0,1fr)_36px] sm:items-start sm:px-4">
            <SourceToggle source={source} enabled={enabled} onToggle={onToggle} />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium leading-5 text-white">{source.label}</p>
                    <span className={`inline-flex min-h-6 items-center justify-center rounded-md border px-2 text-[11px] font-medium leading-none ${statusClass(status)}`}>{statusText(status)}</span>
                </div>
                <p className="mt-1 max-w-4xl text-sm leading-5 text-neutral-400">{source.detail}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="inline-flex min-h-6 items-center rounded-md border border-neutral-800 bg-neutral-950 px-2 text-neutral-400">{source.kind === "seed" ? "Seed" : source.category === "general" ? "General" : source.category === "industry" ? "Industry" : "Location"}</span>
                    <span className="inline-flex min-h-6 min-w-0 items-center rounded-md border border-neutral-800 bg-neutral-950 px-2 text-neutral-500"><span className="truncate">{icpSummary}</span></span>
                </div>
                <p className={`mt-2 text-xs leading-5 ${statusTone(status)}`}>{statusDescription(source, status, enabled)}</p>
            </div>
            <button
                type="button"
                onClick={() => onExpand(source)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition hover:border-neutral-700 hover:text-white"
                aria-expanded={expanded}
                aria-label={`Toggle ${source.label} details`}
            >
                <span className={`text-lg leading-none transition ${expanded ? "rotate-90" : ""}`}>›</span>
            </button>
        </div>
        {expanded && <div className="border-t border-neutral-800 px-3 py-3 sm:px-4">
            <div className="space-y-3">
                <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-300">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Why this source {status === "enabled" || status === "disabled" ? "is ready" : "is blocked"}</p>
                    <p className="mt-2 leading-6">{statusDescription(source, status, enabled)}</p>
                    <p className="mt-2 text-xs text-neutral-500">Catalog status: {source.statusLabel}</p>
                    {source.setupHint && <p className="mt-2 text-xs text-neutral-500">{source.setupHint}</p>}
                </div>
                <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Supported coverage</p>
                    <div className="mt-2 space-y-1.5">
                        <MappingLine label="Industries" values={source.allMappedIndustryLabels} />
                        <MappingLine label="Locations" values={source.allMappedLocationLabels} />
                    </div>
                    <div className="mt-3 space-y-1.5">
                        {source.selectedUnmappedIndustryLabels.length > 0 && <MappingLine label="Selected industries not mapped" values={source.selectedUnmappedIndustryLabels} tone="warn" />}
                        {source.selectedUnmappedLocationLabels.length > 0 && <MappingLine label="Selected locations not mapped" values={source.selectedUnmappedLocationLabels} tone="warn" />}
                    </div>
                </div>
            </div>
            <div className="mt-3 grid gap-3 rounded-lg border border-neutral-800 bg-black/55 p-3 sm:grid-cols-2">
                <label className="block text-xs text-neutral-400">Max records per mapped task<input name={`sourceConfig:${source.value}:limit`} type="number" min={1} max={maxLimit} defaultValue={source.settings.limit} className="mt-2 h-10 w-full rounded-lg border border-neutral-800 bg-black px-3 text-sm text-white" /></label>
                {showRelease && <label className="block text-xs text-neutral-400">Release / version<input name={`sourceConfig:${source.value}:release`} type="text" defaultValue={source.settings.release} placeholder={source.value === "alltheplaces" ? "latest" : undefined} className="mt-2 h-10 w-full rounded-lg border border-neutral-800 bg-black px-3 text-sm text-white placeholder:text-neutral-600" /></label>}
                {source.value === "website" && <>
                    <label className="block text-xs text-neutral-400">Crawl depth<input name="sourceConfig:website:crawlDepth" type="number" min={1} max={5} defaultValue={source.settings.crawlDepth} className="mt-2 h-10 w-full rounded-lg border border-neutral-800 bg-black px-3 text-sm text-white" /></label>
                    <label className="block text-xs text-neutral-400">Timeout seconds<input name="sourceConfig:website:timeoutSeconds" type="number" min={3} max={30} defaultValue={source.settings.timeoutSeconds} className="mt-2 h-10 w-full rounded-lg border border-neutral-800 bg-black px-3 text-sm text-white" /></label>
                    <label className="flex items-center gap-2 text-xs text-neutral-300 sm:col-span-2"><input type="hidden" name="sourceConfig:website:respectRobots" value="off" /><input name="sourceConfig:website:respectRobots" type="checkbox" defaultChecked={source.settings.respectRobots} className="h-4 w-4 accent-white" />Respect robots controls</label>
                </>}
                {showRadius && <label className="block text-xs text-neutral-400">Radius (metres)<input name={`sourceConfig:${source.value}:radiusMeters`} type="number" min={1000} max={40000} defaultValue={source.settings.radiusMeters} className="mt-2 h-10 w-full rounded-lg border border-neutral-800 bg-black px-3 text-sm text-white" /></label>}
                <label className="block text-xs text-neutral-400 sm:col-span-2">Notes<textarea name={`sourceConfig:${source.value}:notes`} defaultValue={source.settings.notes} rows={2} placeholder={source.notesPlaceholder} className="mt-2 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm text-white placeholder:text-neutral-600" /></label>
            </div>
        </div>}
    </div>
}

export function SourceSettingsCard({ sources, catalogueStats }: { sources: SourceSettingsItem[]; catalogueStats?: SourceCatalogueStats }) {
    const [enabledValues, setEnabledValues] = useState<Set<LeadgenSourceKey>>(() => new Set(sources.filter((source) => source.enabled && runnable(source)).map((source) => source.value)))
    const [expandedValues, setExpandedValues] = useState<Set<LeadgenSourceKey>>(() => new Set())
    const [expandedCategories, setExpandedCategories] = useState<Set<SourceSettingsItem["category"]>>(() => new Set())
    const seedSources = useMemo(() => sources.filter((source) => source.kind === "seed"), [sources])
    const enrichmentCategories = useMemo(() => ENRICHMENT_CATEGORIES.map((category) => ({
        ...category,
        sources: sources.filter((source) => source.kind === "enrichment" && source.category === category.key),
    })).filter((category) => category.sources.length > 0), [sources])
    const statusCounts = useMemo(() => {
        return sources.reduce((acc, source) => {
            const status = statusFor(source, enabledValues)
            if (status === "enabled") acc.enabled += 1
            else if (status === "disabled") acc.disabled += 1
            else if (status === "not_mapped") acc.notMapped += 1
            else acc.notConfigured += 1
            return acc
        }, {
            enabled: 0,
            disabled: 0,
            notMapped: 0,
            notConfigured: 0,
        })
    }, [enabledValues, sources])

    function toggleSource(source: SourceSettingsItem, checked: boolean) {
        if (!runnable(source)) return
        setEnabledValues((current) => {
            const next = new Set(current)
            if (checked) next.add(source.value)
            else next.delete(source.value)
            return next
        })
    }

    function toggleCategory(categorySources: SourceSettingsItem[], checked: boolean) {
        setEnabledValues((current) => {
            const next = new Set(current)
            for (const source of categorySources) {
                if (!runnable(source)) continue
                if (checked) next.add(source.value)
                else next.delete(source.value)
            }
            return next
        })
    }

    function toggleExpanded(source: SourceSettingsItem) {
        setExpandedValues((current) => {
            const next = new Set(current)
            if (next.has(source.value)) next.delete(source.value)
            else next.add(source.value)
            return next
        })
    }

    function toggleCategoryExpanded(category: SourceSettingsItem["category"]) {
        setExpandedCategories((current) => {
            const next = new Set(current)
            if (next.has(category)) next.delete(category)
            else next.add(category)
            return next
        })
    }

    return <section className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        {[...enabledValues].map((value) => <input key={value} type="hidden" name="sources" value={value} />)}
        <div className="border-b border-neutral-800 px-4 py-4 sm:px-5">
            <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
                <div>
                    <h2 className="text-lg font-semibold leading-6">Sources</h2>
                    <p className="mt-1.5 max-w-3xl text-sm leading-5 text-neutral-400">Enabled sources run when polling. Disabled sources are ready but excluded. Not-mapped or not-configured sources cannot run with the current ICP.</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-4 xl:min-w-[520px]">
                    <p className="rounded-lg border border-emerald-300/30 bg-emerald-300/[0.12] px-3 py-2 text-center text-xs leading-4 text-emerald-200"><span className="block text-base font-semibold leading-5 text-emerald-100">{statusCounts.enabled}</span>Enabled</p>
                    <p className="rounded-lg border border-neutral-500/30 bg-neutral-950 px-3 py-2 text-center text-xs leading-4 text-neutral-300"><span className="block text-base font-semibold leading-5 text-neutral-100">{statusCounts.disabled}</span>Disabled</p>
                    <p className="rounded-lg border border-amber-300/30 bg-amber-300/[0.12] px-3 py-2 text-center text-xs leading-4 text-amber-200"><span className="block text-base font-semibold leading-5 text-amber-100">{statusCounts.notMapped}</span>Not mapped</p>
                    <p className="rounded-lg border border-red-300/30 bg-red-300/[0.12] px-3 py-2 text-center text-xs leading-4 text-red-200"><span className="block text-base font-semibold leading-5 text-red-100">{statusCounts.notConfigured}</span>No config</p>
                </div>
            </div>
            {catalogueStats ? <p className="mt-2 text-xs text-neutral-500">Catalog status: {catalogueStats.active} active, {catalogueStats.validationOnly} validation only, {catalogueStats.needsWork} needs work, {catalogueStats.blocked} blocked.</p> : null}
        </div>
        <div className="divide-y divide-neutral-800">
            <div>
                <div className="bg-neutral-950/55 px-4 py-3 sm:px-5">
                    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                        <div>
                            <h3 className="text-sm font-semibold leading-5 text-white">Seed sources</h3>
                            <p className="mt-0.5 text-xs leading-5 text-neutral-500">Candidate creation sources required to produce leads.</p>
                        </div>
                        <p className="inline-flex h-7 w-fit items-center rounded-md border border-neutral-800 bg-black px-2.5 text-xs text-neutral-400">{seedSources.filter(runnable).length}/{seedSources.length} runnable</p>
                    </div>
                </div>
                <div className="space-y-3 px-4 py-3 sm:px-5">
                    {seedSources.map((source) => <SourceRow key={source.value} source={source} enabled={enabledValues.has(source.value)} expanded={expandedValues.has(source.value)} onToggle={toggleSource} onExpand={toggleExpanded} />)}
                </div>
            </div>

            <div>
                <div className="bg-neutral-950/55 px-4 py-3 sm:px-5">
                    <h3 className="text-sm font-semibold leading-5 text-white">Enrichment sources</h3>
                    <p className="mt-0.5 text-xs leading-5 text-neutral-500">Candidate investigation sources grouped by how they apply.</p>
                </div>
                <div>
                    {enrichmentCategories.map((category) => {
                        const expanded = expandedCategories.has(category.key)
                        const runnableInCategory = category.sources.filter(runnable).length
                        return <div key={category.key} className="border-t border-neutral-800 bg-neutral-900/60 py-2 first:border-t-0 last:border-b last:pb-2">
                            <div className="grid gap-3 px-4 py-3 sm:grid-cols-[80px_minmax(0,1fr)_auto_36px] sm:items-center sm:px-5">
                                <CategoryToggle sources={category.sources} enabledValues={enabledValues} onToggle={(checked) => toggleCategory(category.sources, checked)} />
                                <div className="min-w-0">
                                    <h4 className="text-sm font-medium leading-5 text-white">{category.title}</h4>
                                    <p className="mt-0.5 text-xs leading-5 text-neutral-500">{category.detail}</p>
                                </div>
                                <p className="inline-flex h-7 w-fit items-center rounded-md border border-neutral-800 bg-black px-2.5 text-xs text-neutral-400 sm:justify-self-end">{runnableInCategory}/{category.sources.length} runnable</p>
                                <button
                                    type="button"
                                    onClick={() => toggleCategoryExpanded(category.key)}
                                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition hover:border-neutral-700 hover:text-white"
                                    aria-expanded={expanded}
                                    aria-label={`Toggle ${category.title} sources`}
                                >
                                    <span className={`text-lg leading-none transition ${expanded ? "rotate-90" : ""}`}>›</span>
                                </button>
                            </div>
                            {expanded && <div className="space-y-2 px-4 pb-3 sm:px-5">
                                {category.sources.map((source) => <SourceRow key={source.value} source={source} enabled={enabledValues.has(source.value)} expanded={expandedValues.has(source.value)} onToggle={toggleSource} onExpand={toggleExpanded} />)}
                            </div>}
                        </div>
                    })}
                </div>
            </div>
        </div>
    </section>
}
