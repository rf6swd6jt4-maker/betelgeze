"use client"

import { useEffect, useMemo, useState } from "react"
import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { SettingsSectionActions } from "@/components/leadgen/ManualSettingsForm"
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

function statusTone(status: SourceStatus) {
    if (status === "enabled") return "text-emerald-200"
    if (status === "disabled") return "text-neutral-300"
    if (status === "not_mapped") return "text-amber-200"
    return "text-red-200"
}

function statusMarkClass(status: SourceStatus) {
    if (status === "enabled") return "bg-emerald-300"
    if (status === "disabled") return "bg-neutral-500"
    if (status === "not_mapped") return "bg-amber-300"
    return "bg-red-300"
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
        return <span className="inline-flex h-8 w-[64px] items-center justify-start gap-2 rounded-lg text-xs font-medium text-neutral-500">
            <ToggleBox state="off" />
            <span className="w-7 text-left">Off</span>
        </span>
    }
    return <button
        type="button"
        role="checkbox"
        aria-checked={enabled}
        onClick={() => onToggle(source, !enabled)}
        data-settings-control="true"
        className="inline-flex h-8 w-[64px] items-center justify-start gap-2 rounded-lg text-xs font-medium text-neutral-300 transition hover:text-white"
        aria-label={`${enabled ? "Disable" : "Enable"} ${source.label}`}
    >
        <ToggleBox state={enabled ? "on" : "off"} />
        <span className="w-7 text-left">{enabled ? "On" : "Off"}</span>
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
        data-settings-control="true"
        className="inline-flex h-8 w-[82px] items-center justify-start gap-2 rounded-lg text-xs font-medium text-neutral-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
        aria-label="Toggle runnable sources in this category"
    >
        <ToggleBox state={checked ? "on" : mixed ? "mixed" : "off"} />
        <span className="w-12 text-left">{checked ? "All on" : mixed ? "Some" : "Off"}</span>
    </button>
}

function StatusSummary({ counts }: { counts: Record<SourceStatus, number> }) {
    return <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <p className="leading-4 text-emerald-200"><span className="font-semibold text-emerald-100">{counts.enabled}</span> Enabled</p>
        <p className="leading-4 text-neutral-300"><span className="font-semibold text-neutral-100">{counts.disabled}</span> Disabled</p>
        <p className="leading-4 text-amber-200"><span className="font-semibold text-amber-100">{counts.not_mapped}</span> Not mapped</p>
        <p className="leading-4 text-red-200"><span className="font-semibold text-red-100">{counts.not_configured}</span> No config</p>
    </div>
}

function statusLine(source: SourceSettingsItem, status: SourceStatus, enabled: boolean) {
    const config = !source.implemented
        ? "Adapter is not implemented yet."
        : !source.apiKeyConfigured && source.envVar
            ? `${source.envVar} is missing.`
            : source.configured
                ? "Required configuration is present."
                : "Source configuration is incomplete."
    const mapping = source.mapped
        ? "Current ICP has mapped industry and location coverage."
        : source.mappingReason || "Current ICP is not mapped to this source."
    const inclusion = status === "enabled"
        ? "Included in the next poll snapshot."
        : enabled
            ? "Ready but currently excluded."
            : "Excluded from the next poll snapshot."
    return [config, mapping, inclusion]
}

function HiddenSourceSettings({ source }: { source: SourceSettingsItem }) {
    return <>
        <input type="hidden" name={`sourceConfig:${source.value}:limit`} value={source.settings.limit} />
        <input type="hidden" name={`sourceConfig:${source.value}:radiusMeters`} value={source.settings.radiusMeters} />
        <input type="hidden" name={`sourceConfig:${source.value}:crawlDepth`} value={source.settings.crawlDepth} />
        <input type="hidden" name={`sourceConfig:${source.value}:timeoutSeconds`} value={source.settings.timeoutSeconds} />
        <input type="hidden" name={`sourceConfig:${source.value}:respectRobots`} value={source.settings.respectRobots ? "on" : "off"} />
        <input type="hidden" name={`sourceConfig:${source.value}:release`} value={source.settings.release} />
        <input type="hidden" name={`sourceConfig:${source.value}:notes`} value={source.settings.notes} />
    </>
}

function SourceRow({ source, enabled, expanded, nested = false, onToggle, onExpand }: { source: SourceSettingsItem; enabled: boolean; expanded: boolean; nested?: boolean; onToggle: (source: SourceSettingsItem, checked: boolean) => void; onExpand: (source: SourceSettingsItem) => void }) {
    const status = statusFor(source, new Set(enabled ? [source.value] : []))
    const showRadius = source.kind === "seed"
    const showRelease = source.value === "overture" || source.value === "alltheplaces"
    const maxLimit = source.value === "overture" ? 500 : source.value === "sam_gov" ? 1 : source.kind === "seed" ? 25 : 80
    const detailLines = statusLine(source, status, enabled)

    return <div className={`border-b border-neutral-900 transition last:border-b-0 ${enabled ? "bg-emerald-300/[0.035]" : nested ? "bg-black hover:bg-neutral-950" : "bg-neutral-950 hover:bg-black"}`}>
        {!expanded && <HiddenSourceSettings source={source} />}
        <div className="grid min-h-12 gap-3 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_150px_36px] sm:items-center sm:px-4">
            <div className="flex min-w-0 items-center gap-3">
                <SourceToggle source={source} enabled={enabled} onToggle={onToggle} />
                <p className="min-w-0 truncate text-sm font-medium leading-5 text-white">{source.label}</p>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className={`inline-flex items-center gap-2 text-sm ${statusTone(status)}`}><BetelgezeStatusMark className={statusMarkClass(status)} />{statusText(status)}</span>
                <button
                    type="button"
                    onClick={() => onExpand(source)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-900 hover:text-white sm:hidden"
                    aria-expanded={expanded}
                    aria-label={`Toggle ${source.label} details`}
                >
                    <span className={`text-lg leading-none transition ${expanded ? "rotate-90" : ""}`}>›</span>
                </button>
            </div>
            <button
                type="button"
                onClick={() => onExpand(source)}
                className="hidden h-9 w-9 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-900 hover:text-white sm:flex"
                aria-expanded={expanded}
                aria-label={`Toggle ${source.label} details`}
            >
                <span className={`text-lg leading-none transition ${expanded ? "rotate-90" : ""}`}>›</span>
            </button>
        </div>
        {expanded && <div className="border-t border-neutral-900 bg-neutral-950/65 px-3 py-3 sm:px-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
                <div className="rounded-lg border border-neutral-800 bg-black p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Description</p>
                    <p className="mt-2 text-sm leading-5 text-neutral-300">{source.detail}</p>
                    <p className={`mt-3 text-sm leading-5 ${statusTone(status)}`}>{statusDescription(source, status, enabled)}</p>
                </div>
                <div className="rounded-lg border border-neutral-800 bg-black p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Configuration status</p>
                    <div className="mt-2 space-y-1.5">
                        {detailLines.map((line) => <p key={line} className="text-xs leading-5 text-neutral-400">{line}</p>)}
                    </div>
                    <p className="mt-2 text-xs text-neutral-600">Catalog: {source.statusLabel}</p>
                    {source.setupHint && <p className="mt-1 text-xs leading-5 text-neutral-500">{source.setupHint}</p>}
                </div>
                <div className="rounded-lg border border-neutral-800 bg-black p-3 lg:col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">ICP coverage</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <div className="space-y-1.5">
                            <MappingLine label="Industries" values={source.allMappedIndustryLabels} />
                            {source.selectedUnmappedIndustryLabels.length > 0 && <MappingLine label="Selected industries not mapped" values={source.selectedUnmappedIndustryLabels} tone="warn" />}
                        </div>
                        <div className="space-y-1.5">
                            <MappingLine label="Locations" values={source.allMappedLocationLabels} />
                            {source.selectedUnmappedLocationLabels.length > 0 && <MappingLine label="Selected locations not mapped" values={source.selectedUnmappedLocationLabels} tone="warn" />}
                        </div>
                    </div>
                </div>
            </div>
            <div className="mt-3 grid gap-3 rounded-lg border border-neutral-800 bg-black p-3 sm:grid-cols-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 sm:col-span-2">Source-specific options</p>
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
    function statusCountsFor(groupSources: SourceSettingsItem[]) {
        return groupSources.reduce<Record<SourceStatus, number>>((acc, source) => {
            const status = statusFor(source, enabledValues)
            acc[status] += 1
            return acc
        }, {
            enabled: 0,
            disabled: 0,
            not_mapped: 0,
            not_configured: 0,
        })
    }

    function groupCounts(groupSources: SourceSettingsItem[]) {
        return {
            enabled: groupSources.filter((source) => statusFor(source, enabledValues) === "enabled").length,
            runnable: groupSources.filter(runnable).length,
            total: groupSources.length,
        }
    }

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

    const seedCounts = groupCounts(seedSources)
    const seedStatusCounts = statusCountsFor(seedSources)
    const enrichmentSources = useMemo(() => enrichmentCategories.flatMap((category) => category.sources), [enrichmentCategories])
    const enrichmentStatusCounts = statusCountsFor(enrichmentSources)
    const seedKeys = useMemo(() => new Set(seedSources.map((source) => source.value)), [seedSources])
    const enrichmentKeys = useMemo(() => new Set(enrichmentSources.map((source) => source.value)), [enrichmentSources])
    const initialEnabledValues = useMemo(() => new Set(sources.filter((source) => source.enabled && runnable(source)).map((source) => source.value)), [sources])

    useEffect(() => {
        const reset = (event: Event) => {
            const section = (event as CustomEvent<string>).detail
            if (section !== "seed-sources" && section !== "enrichment-sources") return
            const relevantKeys = section === "seed-sources" ? seedKeys : enrichmentKeys
            setEnabledValues((current) => {
                const next = new Set(current)
                for (const key of relevantKeys) {
                    if (initialEnabledValues.has(key)) next.add(key)
                    else next.delete(key)
                }
                return next
            })
        }
        window.addEventListener("betelgeze:settings-section-revert", reset)
        return () => window.removeEventListener("betelgeze:settings-section-revert", reset)
    }, [enrichmentKeys, initialEnabledValues, seedKeys])

    return <div className="space-y-4">
        <section data-settings-section="seed-sources" className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
            {[...enabledValues].filter((value) => seedKeys.has(value)).map((value) => <input key={value} type="hidden" name="sources" value={value} />)}
            <div className="border-b border-neutral-800 bg-neutral-950/35 px-4 py-4 sm:px-5">
                <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-start">
                    <div>
                        <h2 className="text-lg font-semibold leading-6">Seed sources</h2>
                        <p className="mt-1 text-sm leading-5 text-neutral-400">Candidate creation sources required before enrichment can investigate leads.</p>
                    </div>
                    <div className="space-y-1.5 xl:text-right">
                        <StatusSummary counts={seedStatusCounts} />
                        <p className="text-xs leading-4 text-neutral-500">{seedCounts.runnable}/{seedCounts.total} runnable</p>
                    </div>
                </div>
            </div>
            <div className="divide-y divide-neutral-900">
                {seedSources.map((source) => <SourceRow key={source.value} source={source} enabled={enabledValues.has(source.value)} expanded={expandedValues.has(source.value)} onToggle={toggleSource} onExpand={toggleExpanded} />)}
            </div>
            <div className="border-t border-neutral-800 px-4 pb-4 sm:px-5">
                <SettingsSectionActions section="seed-sources" label="seed sources" />
            </div>
        </section>

        <section data-settings-section="enrichment-sources" className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
            {[...enabledValues].filter((value) => enrichmentKeys.has(value)).map((value) => <input key={value} type="hidden" name="sources" value={value} />)}
            <div className="border-b border-neutral-800 bg-neutral-950/35 px-4 py-4 sm:px-5">
                <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-start">
                    <div>
                        <h2 className="text-lg font-semibold leading-6">Enrichment sources</h2>
                        <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-400">Candidate investigation sources grouped by how they apply. Descriptions, ICP coverage, and source options live inside each expanded row.</p>
                        {catalogueStats ? <p className="mt-2 text-xs text-neutral-500">Catalog: {catalogueStats.active} active, {catalogueStats.validationOnly} validation only, {catalogueStats.needsWork} needs work, {catalogueStats.blocked} blocked.</p> : null}
                    </div>
                    <div className="space-y-1.5 xl:text-right">
                        <StatusSummary counts={enrichmentStatusCounts} />
                        <p className="text-xs leading-4 text-neutral-500">{enrichmentSources.filter(runnable).length}/{enrichmentSources.length} runnable</p>
                    </div>
                </div>
            </div>
            <div className="divide-y divide-neutral-800">
                {enrichmentCategories.map((category) => {
                    const expanded = expandedCategories.has(category.key)
                    const counts = groupCounts(category.sources)
                    return <div key={category.key} className="bg-neutral-900/60">
                        <div className="grid gap-3 bg-neutral-900 px-4 py-3 sm:grid-cols-[84px_minmax(0,1fr)_auto_36px] sm:items-center sm:px-5">
                            <CategoryToggle sources={category.sources} enabledValues={enabledValues} onToggle={(checked) => toggleCategory(category.sources, checked)} />
                            <div className="min-w-0">
                                <h4 className="text-sm font-semibold leading-5 text-white">{category.title}</h4>
                                <p className="mt-0.5 text-xs leading-5 text-neutral-500">{category.detail}</p>
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-400 sm:justify-self-end">
                                <span>{counts.enabled} on</span>
                                <span>{counts.runnable}/{counts.total} runnable</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => toggleCategoryExpanded(category.key)}
                                className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-950 hover:text-white"
                                aria-expanded={expanded}
                                aria-label={`Toggle ${category.title} sources`}
                            >
                                <span className={`text-lg leading-none transition ${expanded ? "rotate-90" : ""}`}>›</span>
                            </button>
                        </div>
                        {expanded && <div className="border-t border-neutral-800 bg-neutral-950 py-1 pl-3 sm:pl-8">
                            <div className="overflow-hidden border-l border-neutral-800">
                                {category.sources.map((source) => <SourceRow key={source.value} source={source} enabled={enabledValues.has(source.value)} expanded={expandedValues.has(source.value)} nested onToggle={toggleSource} onExpand={toggleExpanded} />)}
                            </div>
                        </div>}
                    </div>
                })}
            </div>
            <div className="border-t border-neutral-800 px-4 pb-4 sm:px-5">
                <SettingsSectionActions section="enrichment-sources" label="enrichment sources" />
            </div>
        </section>
    </div>
}
