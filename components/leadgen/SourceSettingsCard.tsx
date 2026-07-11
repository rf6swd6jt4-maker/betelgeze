"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { SettingsSectionActions } from "@/components/leadgen/ManualSettingsForm"
import { StatusStat } from "@/components/ui/StatusStat"
import type { LeadgenSourceCategoryIntentKey, LeadgenSourceCategoryKey, LeadgenSourceKey, LeadgenSourceStageKey } from "@/lib/leadgen/sources"

type SourceStatus = "not_configured" | "not_mapped" | "disabled" | "enabled"
type ToggleState = "on" | "off" | "mixed"
type SourceStageKey = LeadgenSourceStageKey

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
    category: LeadgenSourceCategoryKey
    sourceStage: SourceStageKey | null
    stageKeys: SourceStageKey[]
    configured: boolean
    mapped: boolean
    enabled: boolean
    implemented: boolean
    apiKeyConfigured: boolean
    envVar: string | null
    envVars: string[]
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

const SOURCE_CATEGORIES: SourceCategory[] = [
    { key: "general", title: "General", detail: "Applies broadly across mapped industries and locations." },
    { key: "industry", title: "Industry-specific", detail: "Depends on mapped trades, verticals, licensing types, or NAICS-like tags." },
    { key: "location", title: "Location-specific", detail: "Depends on mapped states, cities, counties, or regional public records." },
]

const SOURCE_STAGE_CARDS: Array<{ key: SourceStageKey; title: string; detail: string; empty: string }> = [
    { key: "business_validation", title: "Business validation sources", detail: "Sources that can confirm a seeded business is real enough to enter the owner pipeline.", empty: "No honest business-validation source is exposed for this workspace yet." },
    { key: "owner_identity", title: "Owner identity discovery", detail: "Sources that can find a credible owner, principal, license holder, or authorised official name.", empty: "No owner-identity source is exposed for this workspace yet." },
    { key: "owner_phone", title: "Owner phone sources", detail: "Sources that can attach a phone number to the discovered owner or principal.", empty: "No owner-phone source is exposed for this workspace yet." },
    { key: "phone_validation", title: "Phone validation sources", detail: "Sources that check owner-phone format now, and can later add carrier, line-type, and reachability checks.", empty: "No phone-validation source is exposed for this workspace yet." },
]

function runnable(source: SourceSettingsItem) {
    return source.configured && source.mapped
}

function sourceCategoryIntentKey(stageKey: SourceStageKey, category: LeadgenSourceCategoryKey) {
    return `${stageKey}:${category}` as LeadgenSourceCategoryIntentKey
}

function sourceStageAnchorId(stageKey: SourceStageKey | "seed") {
    return stageKey === "seed" ? "leadgen-sources-seed" : `leadgen-sources-${stageKey.replace(/_/g, "-")}`
}

function sourceStageKeyFromHash(hash: string) {
    const value = hash.replace(/^#leadgen-sources-/, "")
    if (value === "seed") return "seed"
    const stageKey = value.replace(/-/g, "_")
    return SOURCE_STAGE_CARDS.some((stage) => stage.key === stageKey) ? stageKey as SourceStageKey : null
}

function categoryChecked(sources: SourceSettingsItem[], enabledValues: Set<LeadgenSourceKey>) {
    const runnableSources = sources.filter(runnable)
    return runnableSources.length > 0 && runnableSources.every((source) => enabledValues.has(source.value))
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
    if (source.envVars.length) return `${source.envVars.join(", ")} ${source.envVars.length === 1 ? "is" : "are"} not set for this environment.`
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

function CategoryToggle({ sources, enabledValues, checked, onToggle }: { sources: SourceSettingsItem[]; enabledValues: Set<LeadgenSourceKey>; checked: boolean; onToggle: (checked: boolean) => void }) {
    const runnableSources = sources.filter(runnable)
    const enabledCount = runnableSources.filter((source) => enabledValues.has(source.value)).length
    const mixed = !checked && enabledCount > 0
    const disabled = runnableSources.length === 0 && !checked

    return <button
        type="button"
        role="checkbox"
        aria-checked={mixed ? "mixed" : checked}
        disabled={disabled}
        onClick={() => onToggle(!checked)}
        data-settings-control="true"
        className="inline-flex h-8 w-[64px] items-center justify-start gap-2 rounded-lg text-xs font-medium text-neutral-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-45 sm:w-[82px]"
        aria-label="Toggle runnable sources in this category"
    >
        <ToggleBox state={checked ? "on" : mixed ? "mixed" : "off"} />
        <span className="w-7 text-left sm:hidden">{checked ? "On" : mixed ? "Some" : "Off"}</span>
        <span className="hidden w-12 text-left sm:inline">{checked ? "All on" : mixed ? "Some" : "Off"}</span>
    </button>
}

function StatusSummary({ counts }: { counts: Record<SourceStatus, number> }) {
    return <div className="flex flex-wrap gap-x-2.5 gap-y-1">
        <StatusStat value={counts.enabled} label="Enabled" tone="green" />
        <StatusStat value={counts.disabled} label="Disabled" tone="grey" />
        <StatusStat value={counts.not_mapped} label="Not mapped" tone="yellow" />
        <StatusStat value={counts.not_configured} label="No config" tone="red" />
    </div>
}

function statusLine(source: SourceSettingsItem, status: SourceStatus, enabled: boolean) {
    const config = !source.implemented
        ? "Adapter is not implemented yet."
        : !source.apiKeyConfigured && source.envVars.length
            ? `${source.envVars.join(", ")} ${source.envVars.length === 1 ? "is" : "are"} missing.`
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

function sourceConfigDirty(source: SourceSettingsItem, section: HTMLElement | null) {
    if (!section) return false
    const controls = [...section.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name^="sourceConfig:${source.value}:"]`)]
    const controlFor = (suffix: keyof SourceSettings) => controls.find((control) => control.name === `sourceConfig:${source.value}:${suffix}`)
    const valueChanged = (suffix: keyof SourceSettings, initialValue: string | number) => {
        const control = controlFor(suffix)
        return control ? control.value !== String(initialValue) : false
    }
    const respectRobots = controls.find((control): control is HTMLInputElement => control instanceof HTMLInputElement && control.type === "checkbox" && control.name === `sourceConfig:${source.value}:respectRobots`)
    return valueChanged("limit", source.settings.limit)
        || valueChanged("radiusMeters", source.settings.radiusMeters)
        || valueChanged("crawlDepth", source.settings.crawlDepth)
        || valueChanged("timeoutSeconds", source.settings.timeoutSeconds)
        || valueChanged("release", source.settings.release)
        || valueChanged("notes", source.settings.notes)
        || (respectRobots ? respectRobots.checked !== source.settings.respectRobots : false)
}

function dirtyCountFor(sources: SourceSettingsItem[], enabledValues: Set<LeadgenSourceKey>, initialEnabledValues: Set<LeadgenSourceKey>, section: HTMLElement | null) {
    return sources.filter((source) => {
        const enabledChanged = runnable(source) && enabledValues.has(source.value) !== initialEnabledValues.has(source.value)
        return enabledChanged || sourceConfigDirty(source, section)
    }).length
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

function SourceRow({ source, enabled, expanded, nested = false, showConfig = true, onToggle, onExpand }: { source: SourceSettingsItem; enabled: boolean; expanded: boolean; nested?: boolean; showConfig?: boolean; onToggle: (source: SourceSettingsItem, checked: boolean) => void; onExpand: (source: SourceSettingsItem) => void }) {
    const status = statusFor(source, new Set(enabled ? [source.value] : []))
    const showRadius = source.kind === "seed"
    const showRelease = source.value === "overture" || source.value === "alltheplaces"
    const maxLimit = source.value === "overture" ? 500 : source.value === "sam_gov" ? 1 : source.kind === "seed" ? 25 : 80
    const detailLines = statusLine(source, status, enabled)

    return <div className={`border-b border-neutral-900 transition last:border-b-0 ${enabled ? "bg-emerald-300/[0.035]" : nested ? "bg-black hover:bg-neutral-950" : "bg-neutral-950 hover:bg-black"}`}>
        {!expanded && showConfig && <HiddenSourceSettings source={source} />}
        <div className="grid min-h-10 grid-cols-[64px_minmax(0,1fr)_auto_30px] items-center gap-2 px-3 py-1.5 sm:min-h-12 sm:grid-cols-[minmax(0,1fr)_150px_36px] sm:gap-3 sm:px-4 sm:py-2">
            <div className="contents sm:flex sm:min-w-0 sm:items-center sm:gap-3">
                <SourceToggle source={source} enabled={enabled} onToggle={onToggle} />
                <p className="min-w-0 truncate text-sm font-medium leading-5 text-white">{source.label}</p>
            </div>
            <span className={`inline-flex items-center justify-end gap-1.5 whitespace-nowrap text-xs sm:gap-2 sm:text-sm ${statusTone(status)}`}><BetelgezeStatusMark className={statusMarkClass(status)} />{statusText(status)}</span>
            <button
                type="button"
                onClick={() => onExpand(source)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-900 hover:text-white sm:h-9 sm:w-9"
                aria-expanded={expanded}
                aria-label={`Toggle ${source.label} details`}
            >
                <span className={`text-lg leading-none transition ${expanded ? "rotate-90" : ""}`}>›</span>
            </button>
        </div>
        {expanded && <div className="border-t border-neutral-900 bg-neutral-950/65 px-2.5 py-2.5 sm:px-4 sm:py-3">
            <div className="grid gap-2.5 lg:grid-cols-[1fr_1fr]">
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
            {showConfig ? <div className="mt-2.5 grid gap-2.5 rounded-lg border border-neutral-800 bg-black p-3 sm:grid-cols-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 sm:col-span-2">Source-specific options</p>
                <label className="block text-xs text-neutral-400">Max records per mapped task<input name={`sourceConfig:${source.value}:limit`} type="number" min={1} max={maxLimit} defaultValue={source.settings.limit} className="mt-1.5 h-9 w-full rounded-lg border border-neutral-800 bg-black px-3 text-sm text-white" /></label>
                {showRelease && <label className="block text-xs text-neutral-400">Release / version<input name={`sourceConfig:${source.value}:release`} type="text" defaultValue={source.settings.release} placeholder={source.value === "alltheplaces" ? "latest" : undefined} className="mt-1.5 h-9 w-full rounded-lg border border-neutral-800 bg-black px-3 text-sm text-white placeholder:text-neutral-600" /></label>}
                {source.value === "website" && <>
                    <label className="block text-xs text-neutral-400">Crawl depth<input name="sourceConfig:website:crawlDepth" type="number" min={1} max={5} defaultValue={source.settings.crawlDepth} className="mt-1.5 h-9 w-full rounded-lg border border-neutral-800 bg-black px-3 text-sm text-white" /></label>
                    <label className="block text-xs text-neutral-400">Timeout seconds<input name="sourceConfig:website:timeoutSeconds" type="number" min={3} max={30} defaultValue={source.settings.timeoutSeconds} className="mt-1.5 h-9 w-full rounded-lg border border-neutral-800 bg-black px-3 text-sm text-white" /></label>
                    <label className="flex items-center gap-2 text-xs text-neutral-300 sm:col-span-2"><input type="hidden" name="sourceConfig:website:respectRobots" value="off" /><input name="sourceConfig:website:respectRobots" type="checkbox" defaultChecked={source.settings.respectRobots} className="h-4 w-4 accent-white" />Respect robots controls</label>
                </>}
                {showRadius && <label className="block text-xs text-neutral-400">Radius (metres)<input name={`sourceConfig:${source.value}:radiusMeters`} type="number" min={1000} max={40000} defaultValue={source.settings.radiusMeters} className="mt-1.5 h-9 w-full rounded-lg border border-neutral-800 bg-black px-3 text-sm text-white" /></label>}
                <label className="block text-xs text-neutral-400 sm:col-span-2">Notes<textarea name={`sourceConfig:${source.value}:notes`} defaultValue={source.settings.notes} rows={2} placeholder={source.notesPlaceholder} className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm text-white placeholder:text-neutral-600" /></label>
            </div> : <p className="mt-2.5 rounded-lg border border-neutral-800 bg-black p-3 text-xs leading-5 text-neutral-500">Source-specific options are shared across stages and can be edited from the source primary stage row.</p>}
        </div>}
    </div>
}

export function SourceSettingsCard({ sources, sourceCategoryIntents = {}, catalogueStats }: { sources: SourceSettingsItem[]; sourceCategoryIntents?: Partial<Record<LeadgenSourceCategoryIntentKey, boolean>>; catalogueStats?: SourceCatalogueStats }) {
    const seedSectionRef = useRef<HTMLElement>(null)
    const stageSectionRefs = useRef<Record<string, HTMLElement | null>>({})
    const seedSources = useMemo(() => sources.filter((source) => source.kind === "seed"), [sources])
    const sourceStageCards = useMemo(() => SOURCE_STAGE_CARDS.map((stage) => {
        const stageSources = sources.filter((source) => source.kind !== "seed" && source.stageKeys.includes(stage.key))
        return {
            ...stage,
            sources: stageSources,
            categories: SOURCE_CATEGORIES.map((category) => ({
                ...category,
                sources: stageSources.filter((source) => source.category === category.key),
            })).filter((category) => category.sources.length > 0),
        }
    }), [sources])
    const initialEnabledValues = useMemo(() => new Set(sources.filter((source) => source.enabled && runnable(source)).map((source) => source.value)), [sources])
    const savedCategoryIntentValues = useMemo(() => new Set(Object.entries(sourceCategoryIntents)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key as LeadgenSourceCategoryIntentKey)), [sourceCategoryIntents])
    const initialCategoryIntentValues = useMemo(() => {
        const next = new Set(savedCategoryIntentValues)
        for (const stage of sourceStageCards) {
            for (const category of stage.categories) {
                if (categoryChecked(category.sources, initialEnabledValues)) next.add(sourceCategoryIntentKey(stage.key, category.key))
            }
        }
        return next
    }, [initialEnabledValues, savedCategoryIntentValues, sourceStageCards])
    const [enabledValues, setEnabledValues] = useState<Set<LeadgenSourceKey>>(() => new Set(initialEnabledValues))
    const [enabledCategoryIntents, setEnabledCategoryIntents] = useState<Set<LeadgenSourceCategoryIntentKey>>(() => new Set(initialCategoryIntentValues))
    const [expandedValues, setExpandedValues] = useState<Set<LeadgenSourceKey>>(() => new Set())
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set())
    const sectionSourceEntries = useMemo(() => [
        ["seed-sources", seedSources] as const,
        ...sourceStageCards.map((stage) => [`source-stage-${stage.key}`, stage.sources] as const),
    ], [seedSources, sourceStageCards])
    const sectionSourcesByKey = useMemo(() => new Map<string, SourceSettingsItem[]>(sectionSourceEntries), [sectionSourceEntries])
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
        if (!checked) {
            setEnabledCategoryIntents((current) => {
                const next = new Set(current)
                for (const stageKey of source.stageKeys) next.delete(sourceCategoryIntentKey(stageKey, source.category))
                return next
            })
        }
    }

    function toggleCategory(stageKey: SourceStageKey, category: LeadgenSourceCategoryKey, categorySources: SourceSettingsItem[], checked: boolean) {
        const intentKey = sourceCategoryIntentKey(stageKey, category)
        setEnabledCategoryIntents((current) => {
            const next = new Set(current)
            if (checked) next.add(intentKey)
            else next.delete(intentKey)
            return next
        })
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

    function toggleCategoryExpanded(category: string) {
        setExpandedCategories((current) => {
            const next = new Set(current)
            if (next.has(category)) next.delete(category)
            else next.add(category)
            return next
        })
    }

    const seedCounts = groupCounts(seedSources)
    const seedStatusCounts = statusCountsFor(seedSources)
    const seedKeys = useMemo(() => new Set(seedSources.map((source) => source.value)), [seedSources])
    const categoryIntentActive = useCallback((stageKey: SourceStageKey, category: LeadgenSourceCategoryKey, categorySources: SourceSettingsItem[]) => {
        return enabledCategoryIntents.has(sourceCategoryIntentKey(stageKey, category)) || categoryChecked(categorySources, enabledValues)
    }, [enabledCategoryIntents, enabledValues])

    const categoryIntentDirtyCount = useCallback((stage: (typeof sourceStageCards)[number]) => {
        return stage.categories.filter((category) => {
            const intentKey = sourceCategoryIntentKey(stage.key, category.key)
            return categoryIntentActive(stage.key, category.key, category.sources) !== initialCategoryIntentValues.has(intentKey)
        }).length
    }, [categoryIntentActive, initialCategoryIntentValues])

    function publishSourceDirty() {
        const seedDirtyCount = dirtyCountFor(seedSources, enabledValues, initialEnabledValues, seedSectionRef.current)
        window.dispatchEvent(new CustomEvent("betelgeze:settings-section-dirty", { detail: { section: "seed-sources", count: seedDirtyCount } }))
        for (const stage of sourceStageCards) {
            const section = `source-stage-${stage.key}`
            const dirtyCount = dirtyCountFor(stage.sources, enabledValues, initialEnabledValues, stageSectionRefs.current[section] ?? null) + categoryIntentDirtyCount(stage)
            window.dispatchEvent(new CustomEvent("betelgeze:settings-section-dirty", { detail: { section, count: dirtyCount } }))
        }
    }

    function scheduleSourceDirtyCheck() {
        window.setTimeout(publishSourceDirty, 0)
    }

    useEffect(() => {
        const seedDirtyCount = dirtyCountFor(seedSources, enabledValues, initialEnabledValues, seedSectionRef.current)
        window.dispatchEvent(new CustomEvent("betelgeze:settings-section-dirty", { detail: { section: "seed-sources", count: seedDirtyCount } }))
        for (const stage of sourceStageCards) {
            const section = `source-stage-${stage.key}`
            const dirtyCount = dirtyCountFor(stage.sources, enabledValues, initialEnabledValues, stageSectionRefs.current[section] ?? null) + categoryIntentDirtyCount(stage)
            window.dispatchEvent(new CustomEvent("betelgeze:settings-section-dirty", { detail: { section, count: dirtyCount } }))
        }
    }, [categoryIntentDirtyCount, enabledValues, enabledCategoryIntents, initialCategoryIntentValues, initialEnabledValues, seedSources, sourceStageCards])

    useEffect(() => {
        const reset = (event: Event) => {
            const section = (event as CustomEvent<string>).detail
            const relevantSources = sectionSourcesByKey.get(section) ?? []
            if (relevantSources.length === 0) return
            const relevantKeys = new Set(relevantSources.map((source) => source.value))
            const relevantStage = sourceStageCards.find((stage) => `source-stage-${stage.key}` === section)
            setEnabledValues((current) => {
                const next = new Set(current)
                for (const key of relevantKeys) {
                    if (initialEnabledValues.has(key)) next.add(key)
                    else next.delete(key)
                }
                return next
            })
            if (relevantStage) {
                setEnabledCategoryIntents((current) => {
                    const next = new Set(current)
                    for (const category of relevantStage.categories) {
                        const intentKey = sourceCategoryIntentKey(relevantStage.key, category.key)
                        if (initialCategoryIntentValues.has(intentKey)) next.add(intentKey)
                        else next.delete(intentKey)
                    }
                    return next
                })
            }
        }
        window.addEventListener("betelgeze:settings-section-revert", reset)
        return () => window.removeEventListener("betelgeze:settings-section-revert", reset)
    }, [initialCategoryIntentValues, initialEnabledValues, sectionSourcesByKey, sourceStageCards])

    useEffect(() => {
        const handleSourceStageHash = () => {
            const stageKey = sourceStageKeyFromHash(window.location.hash)
            if (!stageKey) return
            window.setTimeout(() => {
                document.querySelector(`[data-source-stage-anchor="${sourceStageAnchorId(stageKey)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" })
            }, 0)
        }
        handleSourceStageHash()
        window.addEventListener("hashchange", handleSourceStageHash)
        return () => window.removeEventListener("hashchange", handleSourceStageHash)
    }, [])

    return <div className="space-y-3 sm:space-y-4">
        <section ref={seedSectionRef} data-settings-section="seed-sources" data-source-stage-anchor={sourceStageAnchorId("seed")} onChange={scheduleSourceDirtyCheck} onInput={scheduleSourceDirtyCheck} className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
            {[...enabledValues].filter((value) => seedKeys.has(value)).map((value) => <input key={value} type="hidden" name="sources" value={value} />)}
            <div className="border-b border-neutral-800 bg-neutral-900 px-3 py-3 sm:px-5 sm:py-4">
                <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-start">
                    <div>
                        <h2 className="text-base font-semibold leading-6 sm:text-lg">Seed sources</h2>
                        <p className="mt-1 text-sm leading-5 text-neutral-400">Candidate creation sources required before staged validation and owner discovery can run.</p>
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

        {sourceStageCards.map((stage) => {
            const section = `source-stage-${stage.key}`
            const stageKeys = new Set(stage.sources.map((source) => source.value))
            const statusCounts = statusCountsFor(stage.sources)
            const counts = groupCounts(stage.sources)
            return <section
                key={stage.key}
                ref={(node) => { stageSectionRefs.current[section] = node }}
                data-settings-section={section}
                data-source-stage-anchor={sourceStageAnchorId(stage.key)}
                onChange={scheduleSourceDirtyCheck}
                onInput={scheduleSourceDirtyCheck}
                className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900"
            >
                {[...enabledValues].filter((value) => stageKeys.has(value)).map((value) => <input key={value} type="hidden" name="sources" value={value} />)}
                {stage.categories
                    .filter((category) => categoryIntentActive(stage.key, category.key, category.sources))
                    .map((category) => <input key={category.key} type="hidden" name="sourceCategoryIntent" value={sourceCategoryIntentKey(stage.key, category.key)} />)}
                <div className="border-b border-neutral-800 bg-neutral-900 px-3 py-3 sm:px-5 sm:py-4">
                    <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-start">
                        <div>
                            <h2 className="text-base font-semibold leading-6 sm:text-lg">{stage.title}</h2>
                            <p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-400">{stage.detail}</p>
                            {stage.key === "business_validation" && catalogueStats ? <p className="mt-2 text-xs text-neutral-500">Catalog: {catalogueStats.active} active, {catalogueStats.validationOnly} validation only, {catalogueStats.needsWork} needs work, {catalogueStats.blocked} blocked.</p> : null}
                        </div>
                        {stage.sources.length ? <div className="space-y-1.5 xl:text-right">
                            <StatusSummary counts={statusCounts} />
                            <p className="text-xs leading-4 text-neutral-500">{counts.runnable}/{counts.total} runnable</p>
                        </div> : null}
                    </div>
                </div>
                {stage.sources.length ? <div className="divide-y divide-neutral-800">
                    {stage.categories.map((category) => {
                        const categoryKey = `${stage.key}:${category.key}`
                        const expanded = expandedCategories.has(categoryKey)
                        const categoryCounts = groupCounts(category.sources)
                        const categoryOn = categoryIntentActive(stage.key, category.key, category.sources)
                        return <div key={category.key} className="bg-neutral-950/40">
                            <div className="grid grid-cols-[64px_minmax(0,1fr)_32px] items-center gap-x-2 bg-neutral-950/60 px-3 py-1.5 sm:grid-cols-[84px_minmax(0,1fr)_auto_36px] sm:gap-3 sm:px-5 sm:py-3">
                                <CategoryToggle sources={category.sources} enabledValues={enabledValues} checked={categoryOn} onToggle={(checked) => toggleCategory(stage.key, category.key, category.sources, checked)} />
                                <div className="min-w-0 self-center">
                                    <h4 className="truncate text-sm font-semibold leading-4 text-white sm:leading-5">{category.title}</h4>
                                    <p className="mt-0.5 hidden text-xs leading-5 text-neutral-500 sm:block">{category.detail}</p>
                                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0 text-[11px] leading-3 text-neutral-400 sm:hidden">
                                        <span>{categoryCounts.enabled} on</span>
                                        <span>{categoryCounts.runnable}/{categoryCounts.total} runnable</span>
                                    </div>
                                </div>
                                <div className="hidden flex-wrap gap-x-2.5 gap-y-0.5 text-xs leading-4 text-neutral-400 sm:flex sm:justify-self-end">
                                    <span>{categoryCounts.enabled} on</span>
                                    <span>{categoryCounts.runnable}/{categoryCounts.total} runnable</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => toggleCategoryExpanded(categoryKey)}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-950 hover:text-white sm:h-9 sm:w-9"
                                    aria-expanded={expanded}
                                    aria-label={`Toggle ${category.title} sources`}
                                >
                                    <span className={`text-lg leading-none transition ${expanded ? "rotate-90" : ""}`}>›</span>
                                </button>
                            </div>
                            {expanded && <div className="border-t border-neutral-800 bg-black/70 py-1 pl-3 sm:pl-8">
                                <div className="overflow-hidden border-l border-neutral-800">
                                    {category.sources.map((source) => <SourceRow key={source.value} source={source} enabled={enabledValues.has(source.value)} expanded={expandedValues.has(source.value)} nested showConfig={source.sourceStage === stage.key} onToggle={toggleSource} onExpand={toggleExpanded} />)}
                                </div>
                            </div>}
                        </div>
                    })}
                </div> : <p className="px-4 py-4 text-sm text-neutral-500 sm:px-5">{stage.empty}</p>}
                {stage.sources.length ? <div className="border-t border-neutral-800 px-4 pb-4 sm:px-5">
                    <SettingsSectionActions section={section} label={stage.title.toLowerCase()} />
                </div> : null}
            </section>
        })}
    </div>
}
