export type LeadgenSourceCatalogRow = {
    source_key: string
    label: string
    family: string
    source_points: number | null
    owner_identity_points: number | null
    owner_phone_points: number | null
    business_support_points: number | null
    access_method: string | null
    free_status: string | null
    implementation_status: string | null
    run_stage: string | null
    stage_capabilities?: unknown
    enabled: boolean | null
    rate_limit_ms: number | null
    coverage: unknown
    metadata: unknown
}

export type LeadgenSourceHealthRow = {
    source_key: string
    status: string | null
    last_success_at: string | null
    last_failure_at: string | null
    last_error: string | null
    metadata: unknown
}

export const leadgenSourceFamilyLabels: Record<string, string> = {
    seed: "Seed",
    web: "Web",
    licensing: "Licensing",
    permits: "Permits",
    registries: "Registries",
    procurement: "Procurement",
    safety: "Safety",
    transport: "Transport",
    regulated: "Regulated",
    directories: "Directories",
}

export const leadgenSourceFamilyOrder = [
    "seed",
    "web",
    "licensing",
    "permits",
    "registries",
    "procurement",
    "safety",
    "transport",
    "regulated",
    "directories",
]

export function sourceCatalogMap(sources: LeadgenSourceCatalogRow[]) {
    return new Map(sources.map((source) => [source.source_key, source]))
}

export function sourceHealthMap(health: LeadgenSourceHealthRow[]) {
    return new Map(health.map((row) => [row.source_key, row]))
}

function metadataObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readableStatus(value: string | null | undefined) {
    return String(value ?? "unknown").replace(/_/g, " ")
}

export function sourceStatusMeta(source: LeadgenSourceCatalogRow, health?: LeadgenSourceHealthRow | null) {
    const implementation = source.implementation_status ?? "planned"
    const stage = source.run_stage ?? "candidate_investigation"
    const enabled = source.enabled === true
    const healthStatus = health?.status ?? null

    if (healthStatus === "blocked" || implementation === "blocked" || stage === "blocked") {
        return {
            key: "blocked",
            label: "Blocked",
            detail: "Not pullable or not compliant enough for polling right now.",
            mark: "bg-red-300",
            text: "text-red-200",
            border: "border-red-400/20",
            muted: false,
        }
    }

    if (implementation === "validation_only" || stage === "validation") {
        return {
            key: "validation",
            label: "Validation only",
            detail: "Kept out of bulk polling; useful later for checking top-ranked finalists.",
            mark: "bg-sky-300",
            text: "text-sky-200",
            border: "border-sky-400/20",
            muted: false,
        }
    }

    if (stage === "bulk_refresh") {
        return {
            key: "bulk",
            label: "Bulk refresh",
            detail: "Needs a scheduled dataset refresh/index before it should run inside polls.",
            mark: "bg-violet-300",
            text: "text-violet-200",
            border: "border-violet-400/20",
            muted: false,
        }
    }

    if (stage === "source_specific_configuration") {
        return {
            key: "config",
            label: "Needs endpoint",
            detail: "Real source family, but it needs specific public endpoints/datasets before activation.",
            mark: "bg-amber-300",
            text: "text-amber-200",
            border: "border-amber-400/20",
            muted: false,
        }
    }

    if (implementation === "active" && enabled && stage === "seed") {
        return {
            key: "seed",
            label: "Seed source",
            detail: "Creates candidate businesses before investigation fan-out.",
            mark: "bg-emerald-300",
            text: "text-emerald-200",
            border: "border-emerald-400/20",
            muted: false,
        }
    }

    if (implementation === "active" && enabled && stage === "candidate_investigation") {
        return {
            key: "poll_time",
            label: "Poll-time",
            detail: "Runs against candidates during the investigation fan-out.",
            mark: "bg-emerald-300",
            text: "text-emerald-200",
            border: "border-emerald-400/20",
            muted: false,
        }
    }

    if (implementation === "active" && !enabled) {
        return {
            key: "off",
            label: "Available, off",
            detail: "Adapter exists, but the catalogue currently has it disabled.",
            mark: "bg-neutral-500",
            text: "text-neutral-400",
            border: "border-neutral-800",
            muted: true,
        }
    }

    if (implementation === "planned") {
        return {
            key: "planned",
            label: "Planned",
            detail: "Catalogued for the roadmap, but not honest to run yet.",
            mark: "bg-neutral-500",
            text: "text-neutral-500",
            border: "border-neutral-800",
            muted: true,
        }
    }

    return {
        key: "unknown",
        label: readableStatus(implementation),
        detail: readableStatus(stage),
        mark: "bg-neutral-500",
        text: "text-neutral-400",
        border: "border-neutral-800",
        muted: true,
    }
}

export function sourcePointSummary(source: LeadgenSourceCatalogRow) {
    const signals = [
        (source.owner_identity_points ?? 0) > 0 ? "owner" : null,
        (source.owner_phone_points ?? 0) > 0 ? "owner phone" : null,
        (source.business_support_points ?? 0) > 0 ? "business" : null,
    ].filter((signal): signal is string => Boolean(signal))
    return signals.length ? signals.join(" + ") : "support only"
}

export function sourceHumanLabel(sourceKey: string, sources: Map<string, LeadgenSourceCatalogRow>, fallback?: (key: string) => string) {
    return sources.get(sourceKey)?.label ?? fallback?.(sourceKey) ?? sourceKey.replace(/[._]/g, " ")
}

export function sourceMetadataNote(source: LeadgenSourceCatalogRow, health?: LeadgenSourceHealthRow | null) {
    const metadata = metadataObject(source.metadata)
    const note = metadata.reason ?? metadata.phone_note ?? metadata.note ?? metadata.quota ?? metadata.priority
    if (typeof note === "string" && note.trim()) return note.trim()
    if (health?.last_error) return health.last_error
    return sourceStatusMeta(source, health).detail
}

export function activePollTimeSources(sources: LeadgenSourceCatalogRow[]) {
    return sources.filter((source) => source.enabled && source.implementation_status === "active" && ["seed", "candidate_investigation"].includes(source.run_stage ?? ""))
}
