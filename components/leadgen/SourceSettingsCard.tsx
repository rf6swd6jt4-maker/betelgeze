"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { LeadgenSourceKey } from "@/lib/leadgen/sources"

type SourceStatus = "not_configured" | "disabled" | "enabled"

type SourceSettings = {
    limit: number
    radiusMeters: number
    crawlDepth: number
    timeoutSeconds: number
    respectRobots: boolean
    release: string
    notes: string
}

export type SourceSettingsItem = {
    value: LeadgenSourceKey
    label: string
    detail: string
    statusLabel: string
    notesPlaceholder: string
    category: "general" | "location" | "industry"
    configured: boolean
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

const CATEGORIES: SourceCategory[] = [
    { key: "general", title: "General", detail: "Broad seed and website sources used across most target markets." },
    { key: "location", title: "Specific Locations", detail: "Sources that depend on state, city, county, or registry coverage." },
    { key: "industry", title: "Specific Industries", detail: "Sources that are strongest for licensed, regulated, or specialist verticals." },
]

function statusFor(source: SourceSettingsItem, enabledValues: Set<LeadgenSourceKey>): SourceStatus {
    if (!source.configured) return "not_configured"
    return enabledValues.has(source.value) ? "enabled" : "disabled"
}

function statusText(status: SourceStatus) {
    if (status === "enabled") return "Enabled"
    if (status === "disabled") return "Disabled"
    return "Not configured"
}

function statusClass(status: SourceStatus) {
    if (status === "enabled") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
    if (status === "disabled") return "border-neutral-700 bg-neutral-900 text-neutral-300"
    return "border-amber-400/30 bg-amber-400/10 text-amber-200"
}

function CategoryToggle({
    sources,
    enabledValues,
    onToggle,
}: {
    sources: SourceSettingsItem[]
    enabledValues: Set<LeadgenSourceKey>
    onToggle: (checked: boolean) => void
}) {
    const inputRef = useRef<HTMLInputElement>(null)
    const configured = sources.filter((source) => source.configured)
    const enabledCount = configured.filter((source) => enabledValues.has(source.value)).length
    const checked = configured.length > 0 && enabledCount === configured.length
    const indeterminate = enabledCount > 0 && enabledCount < configured.length
    useEffect(() => {
        if (inputRef.current) inputRef.current.indeterminate = indeterminate
    }, [indeterminate])

    return <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        disabled={configured.length === 0}
        onChange={(event) => onToggle(event.currentTarget.checked)}
        className="h-4 w-4 accent-white disabled:opacity-40"
        aria-label="Toggle configured sources in this category"
    />
}

export function SourceSettingsCard({ sources }: { sources: SourceSettingsItem[] }) {
    const [enabledValues, setEnabledValues] = useState<Set<LeadgenSourceKey>>(() => new Set(sources.filter((source) => source.enabled && source.configured).map((source) => source.value)))
    const sourcesByCategory = useMemo(() => {
        return CATEGORIES.map((category) => ({
            ...category,
            sources: sources.filter((source) => source.category === category.key),
        })).filter((category) => category.sources.length > 0)
    }, [sources])

    function toggleSource(source: SourceSettingsItem, checked: boolean) {
        if (!source.configured) return
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
                if (!source.configured) continue
                if (checked) next.add(source.value)
                else next.delete(source.value)
            }
            return next
        })
    }

    return <section className="rounded-2xl border border-neutral-800 bg-neutral-900">
        <div className="border-b border-neutral-800 px-5 py-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                    <h2 className="text-lg font-semibold">Sources</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">Enable source families from one place. Category checkboxes switch on every configured source in that group; unchecked groups can still be managed source by source.</p>
                </div>
                <p className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-400">{enabledValues.size} enabled</p>
            </div>
        </div>
        <div className="divide-y divide-neutral-800">
            {sourcesByCategory.map((category) => <div key={category.key}>
                <div className="grid gap-3 bg-neutral-950/45 px-4 py-3 sm:grid-cols-[24px_minmax(0,1fr)_120px] sm:items-center">
                    <CategoryToggle sources={category.sources} enabledValues={enabledValues} onToggle={(checked) => toggleCategory(category.sources, checked)} />
                    <div>
                        <h3 className="text-sm font-medium text-white">{category.title}</h3>
                        <p className="mt-1 text-xs leading-5 text-neutral-500">{category.detail}</p>
                    </div>
                    <p className="text-xs text-neutral-500 sm:text-right">{category.sources.filter((source) => source.configured).length}/{category.sources.length} configured</p>
                </div>
                <div className="divide-y divide-neutral-900">
                    {category.sources.map((source) => {
                        const status = statusFor(source, enabledValues)
                        const enabled = enabledValues.has(source.value)
                        const hasSettings = source.value === "overture" || source.value === "website" || source.value === "osm" || source.envVar || source.setupHint || source.notesPlaceholder
                        return <div key={source.value} className="bg-black/35 px-4 py-3">
                            <div className="grid gap-3 md:grid-cols-[24px_minmax(0,1fr)_128px_36px] md:items-center">
                                <input
                                    name="sources"
                                    value={source.value}
                                    type="checkbox"
                                    checked={enabled}
                                    disabled={!source.configured}
                                    onChange={(event) => toggleSource(source, event.currentTarget.checked)}
                                    className="h-4 w-4 accent-white disabled:opacity-40"
                                    aria-label={`Enable ${source.label}`}
                                />
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-medium text-white">{source.label}</p>
                                        {!source.implemented && <span className="rounded-md border border-neutral-700 px-2 py-0.5 text-[11px] uppercase tracking-wide text-neutral-500">Planned</span>}
                                    </div>
                                    <p className="mt-1 text-sm leading-5 text-neutral-400">{source.detail}</p>
                                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-500">
                                        <span>{source.mappingIndustryText}</span>
                                        <span>{source.mappingLocationText}</span>
                                        {source.envVar && <span>{source.apiKeyConfigured ? `${source.envVar} configured` : `${source.envVar} missing`}</span>}
                                    </div>
                                </div>
                                <span className={`w-fit rounded-md border px-2.5 py-1 text-xs ${statusClass(status)}`}>{statusText(status)}</span>
                                {hasSettings ? <details className="group md:justify-self-end">
                                    <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-400 transition hover:border-neutral-700 hover:text-white" aria-label={`Expand ${source.label} settings`}>
                                        <span className="transition group-open:rotate-90">›</span>
                                    </summary>
                                    <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4 md:col-span-4">
                                        <div className="grid gap-3 md:grid-cols-2">
                                            <div className="rounded-lg border border-neutral-900 bg-black/40 p-3 text-xs text-neutral-400">
                                                <p className="font-medium text-neutral-200">{source.statusLabel}</p>
                                                {source.setupHint && <p className="mt-2 leading-5">{source.setupHint}</p>}
                                                {!source.configured && <p className="mt-2 leading-5 text-amber-200">This source is visible but cannot run until its mappings, adapter, or credentials are ready.</p>}
                                            </div>
                                            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Max records per mapped task<input name={`sourceConfig:${source.value}:limit`} type="number" min={1} max={source.value === "overture" ? 500 : 50} defaultValue={source.settings.limit} className="mt-2 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>
                                            {source.value === "overture" && <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Release/version<input name="sourceConfig:overture:release" defaultValue={source.settings.release} className="mt-2 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>}
                                            {source.value === "website" && <>
                                                <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Crawl depth<input name="sourceConfig:website:crawlDepth" type="number" min={1} max={5} defaultValue={source.settings.crawlDepth} className="mt-2 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>
                                                <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Timeout seconds<input name="sourceConfig:website:timeoutSeconds" type="number" min={3} max={30} defaultValue={source.settings.timeoutSeconds} className="mt-2 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>
                                                <label className="flex items-center gap-2 text-xs text-neutral-300"><input type="hidden" name="sourceConfig:website:respectRobots" value="off" /><input name="sourceConfig:website:respectRobots" type="checkbox" defaultChecked={source.settings.respectRobots} className="h-4 w-4 accent-white" />Respect robots controls</label>
                                            </>}
                                            {(source.value === "osm" || source.value === "overture") && <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Radius in metres<input name={`sourceConfig:${source.value}:radiusMeters`} type="number" min={1000} max={40000} defaultValue={source.settings.radiusMeters} className="mt-2 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>}
                                            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 md:col-span-2">Notes<textarea name={`sourceConfig:${source.value}:notes`} defaultValue={source.settings.notes} rows={2} placeholder={source.notesPlaceholder} className="mt-2 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-neutral-600" /></label>
                                        </div>
                                    </div>
                                </details> : <span />}
                            </div>
                        </div>
                    })}
                </div>
            </div>)}
        </div>
    </section>
}
