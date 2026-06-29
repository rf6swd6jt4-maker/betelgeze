"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { LeadgenSourceKey } from "@/lib/leadgen/sources"

type SourceStatus = "not_configured" | "not_mapped" | "disabled" | "enabled"

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
    settings: SourceSettings
}

type SourceCategory = {
    key: SourceSettingsItem["category"]
    title: string
    detail: string
}

const ENRICHMENT_CATEGORIES: SourceCategory[] = [
    { key: "general", title: "General", detail: "Runs across most candidate lists once seed companies exist." },
    { key: "industry", title: "Industry-specific", detail: "Depends on mapped trades, licence types, NAICS, or vertical-specific evidence." },
    { key: "location", title: "Location-specific", detail: "Depends on mapped states, cities, counties, or local registry coverage." },
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
    if (status === "enabled") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
    if (status === "disabled") return "border-neutral-700 bg-neutral-950 text-neutral-300"
    if (status === "not_mapped") return "border-amber-400/30 bg-amber-400/10 text-amber-200"
    return "border-red-400/30 bg-red-400/10 text-red-200"
}

function statItems(stats?: SourceCatalogueStats) {
    if (!stats) return []
    return [
        ["Active", stats.active],
        ["Validation only", stats.validationOnly],
        ["Needs work", stats.needsWork],
        ["Blocked", stats.blocked],
    ] as const
}

function CategoryToggle({ sources, enabledValues, onToggle }: { sources: SourceSettingsItem[]; enabledValues: Set<LeadgenSourceKey>; onToggle: (checked: boolean) => void }) {
    const inputRef = useRef<HTMLInputElement>(null)
    const runnableSources = sources.filter(runnable)
    const enabledCount = runnableSources.filter((source) => enabledValues.has(source.value)).length
    const checked = runnableSources.length > 0 && enabledCount === runnableSources.length
    const indeterminate = enabledCount > 0 && enabledCount < runnableSources.length

    useEffect(() => {
        if (inputRef.current) inputRef.current.indeterminate = indeterminate
    }, [indeterminate])

    return <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        disabled={runnableSources.length === 0}
        onChange={(event) => onToggle(event.currentTarget.checked)}
        className="h-4 w-4 shrink-0 accent-white disabled:opacity-40"
        aria-label="Toggle runnable sources in this category"
    />
}

function SourceRow({ source, enabled, expanded, onToggle, onExpand }: { source: SourceSettingsItem; enabled: boolean; expanded: boolean; onToggle: (source: SourceSettingsItem, checked: boolean) => void; onExpand: (source: SourceSettingsItem) => void }) {
    const status = statusFor(source, new Set(enabled ? [source.value] : []))
    const hasSettings = Boolean(source.setupHint || source.envVar || source.notesPlaceholder || ["overture", "osm", "alltheplaces", "foursquare_os_places", "website"].includes(source.value))
    const disabled = !runnable(source)
    const maxLimit = source.value === "overture" ? 500 : source.value === "sam_gov" ? 1 : source.kind === "seed" ? 25 : 80
    const showRadius = source.kind === "seed"
    const showRelease = source.value === "overture" || source.value === "alltheplaces"

    return <div className="bg-black/35 px-4 py-4 sm:px-5">
        <div className="grid gap-3 md:grid-cols-[24px_minmax(0,1fr)_auto_40px] md:items-start">
            <input
                type="checkbox"
                checked={enabled}
                disabled={disabled}
                onChange={(event) => onToggle(source, event.currentTarget.checked)}
                className="mt-1 h-4 w-4 accent-white disabled:opacity-40"
                aria-label={`Enable ${source.label}`}
            />
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-white sm:text-base">{source.label}</p>
                    {!source.implemented && <span className="rounded-md border border-neutral-700 px-2 py-0.5 text-[11px] uppercase tracking-wide text-neutral-500">Planned</span>}
                </div>
                <p className="mt-1 max-w-4xl text-sm leading-5 text-neutral-400">{source.detail}</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
                    <span>{source.mappingIndustryText}</span>
                    <span>{source.mappingLocationText}</span>
                    {source.envVar && <span>{source.apiKeyConfigured ? `${source.envVar} configured` : `${source.envVar} missing`}</span>}
                </div>
            </div>
            <span className={`w-fit rounded-md border px-2.5 py-1 text-xs ${statusClass(status)}`}>{statusText(status)}</span>
            {hasSettings ? <button
                type="button"
                onClick={() => onExpand(source)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition hover:border-neutral-700 hover:text-white"
                aria-expanded={expanded}
                aria-label={`Toggle ${source.label} settings`}
            >
                <span className={`text-lg leading-none transition ${expanded ? "rotate-90" : ""}`}>›</span>
            </button> : <span className="hidden md:block" />}
        </div>
        {expanded && <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(280px,1.1fr)]">
                <div className="rounded-lg border border-neutral-900 bg-black/40 p-3 text-sm text-neutral-400">
                    <p className="font-medium text-neutral-200">{source.statusLabel}</p>
                    {source.setupHint && <p className="mt-2 leading-6">{source.setupHint}</p>}
                    {!source.configured && <p className="mt-2 leading-6 text-red-200">This source cannot run until its required endpoint, adapter, or credential is configured.</p>}
                    {source.configured && !source.mapped && <p className="mt-2 leading-6 text-amber-200">The source is configured, but this ICP selection does not map to it yet.</p>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Max records per mapped task<input name={`sourceConfig:${source.value}:limit`} type="number" min={1} max={maxLimit} defaultValue={source.settings.limit} className="mt-2 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>
                    {showRelease && <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Release/version<input name={`sourceConfig:${source.value}:release`} defaultValue={source.settings.release} placeholder={source.value === "alltheplaces" ? "latest" : undefined} className="mt-2 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-neutral-600" /></label>}
                    {source.value === "website" && <>
                        <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Crawl depth<input name="sourceConfig:website:crawlDepth" type="number" min={1} max={5} defaultValue={source.settings.crawlDepth} className="mt-2 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>
                        <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Timeout seconds<input name="sourceConfig:website:timeoutSeconds" type="number" min={3} max={30} defaultValue={source.settings.timeoutSeconds} className="mt-2 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>
                        <label className="flex items-center gap-2 text-xs text-neutral-300 sm:col-span-2"><input type="hidden" name="sourceConfig:website:respectRobots" value="off" /><input name="sourceConfig:website:respectRobots" type="checkbox" defaultChecked={source.settings.respectRobots} className="h-4 w-4 accent-white" />Respect robots controls</label>
                    </>}
                    {showRadius && <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Radius in metres<input name={`sourceConfig:${source.value}:radiusMeters`} type="number" min={1000} max={40000} defaultValue={source.settings.radiusMeters} className="mt-2 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>}
                    <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 sm:col-span-2">Notes<textarea name={`sourceConfig:${source.value}:notes`} defaultValue={source.settings.notes} rows={2} placeholder={source.notesPlaceholder} className="mt-2 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-neutral-600" /></label>
                </div>
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

    return <section className="rounded-2xl border border-neutral-800 bg-neutral-900">
        {[...enabledValues].map((value) => <input key={value} type="hidden" name="sources" value={value} />)}
        <div className="border-b border-neutral-800 px-5 py-4">
            <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
                <div>
                    <h2 className="text-lg font-semibold">Sources</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">Seed sources create candidate companies. Enrichment sources investigate those candidates for owner identity, owner phone, and supporting evidence.</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-5 xl:min-w-[520px]">
                    <p className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-400 sm:text-center"><span className="block text-base font-semibold text-neutral-100">{enabledValues.size}</span>enabled</p>
                    {statItems(catalogueStats).map(([label, value]) => <p key={label} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-500 sm:text-center"><span className="block text-base font-semibold text-neutral-100">{value}</span>{label}</p>)}
                </div>
            </div>
        </div>
        <div className="divide-y divide-neutral-800">
            <div>
                <div className="bg-neutral-950/45 px-4 py-3 sm:px-5">
                    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                        <div>
                            <h3 className="text-sm font-medium text-white">Seed sources</h3>
                            <p className="mt-1 text-xs leading-5 text-neutral-500">Candidate creation sources. These are always visible because at least one must be runnable for a poll to start.</p>
                        </div>
                        <p className="text-xs text-neutral-500">{seedSources.filter(runnable).length}/{seedSources.length} runnable</p>
                    </div>
                </div>
                <div className="divide-y divide-neutral-900">
                    {seedSources.map((source) => <SourceRow key={source.value} source={source} enabled={enabledValues.has(source.value)} expanded={expandedValues.has(source.value)} onToggle={toggleSource} onExpand={toggleExpanded} />)}
                </div>
            </div>

            <div>
                <div className="bg-neutral-950/45 px-4 py-3 sm:px-5">
                    <h3 className="text-sm font-medium text-white">Enrichment sources</h3>
                    <p className="mt-1 text-xs leading-5 text-neutral-500">Candidate investigation sources. Category checkboxes enable every runnable source in that group; collapsed groups still submit their enabled sources.</p>
                </div>
                <div className="divide-y divide-neutral-800">
                    {enrichmentCategories.map((category) => {
                        const expanded = expandedCategories.has(category.key)
                        return <div key={category.key}>
                            <div className="grid gap-3 px-4 py-3 sm:grid-cols-[24px_minmax(0,1fr)_auto_40px] sm:items-center sm:px-5">
                                <CategoryToggle sources={category.sources} enabledValues={enabledValues} onToggle={(checked) => toggleCategory(category.sources, checked)} />
                                <div className="min-w-0">
                                    <h4 className="text-sm font-medium text-white">{category.title}</h4>
                                    <p className="mt-1 text-xs leading-5 text-neutral-500">{category.detail}</p>
                                </div>
                                <p className="text-xs text-neutral-500 sm:text-right">{category.sources.filter(runnable).length}/{category.sources.length} runnable</p>
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
                            {expanded && <div className="divide-y divide-neutral-900">
                                {category.sources.map((source) => <SourceRow key={source.value} source={source} enabled={enabledValues.has(source.value)} expanded={expandedValues.has(source.value)} onToggle={toggleSource} onExpand={toggleExpanded} />)}
                            </div>}
                        </div>
                    })}
                </div>
            </div>
        </div>
    </section>
}
