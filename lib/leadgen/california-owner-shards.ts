export const CALIFORNIA_OWNER_SHARD_VERSION = "v1"
export const CALIFORNIA_OWNER_DEFAULT_SHARD_PREFIX_LENGTH = 3

export const californiaOwnerShardSourceKeys = [
    "registry.ca.los_angeles_fbn",
    "registry.ca.san_francisco_business_locations",
    "regulated.ca.calrecycle_waste",
] as const

const CALIFORNIA_OWNER_SHARD_PREFIX_STOP_TOKENS = new Set([
    "a",
    "an",
    "best",
    "cal",
    "cali",
    "california",
    "golden",
    "goldenstate",
    "new",
    "premier",
    "premium",
    "quality",
    "the",
    "top",
])

export type CaliforniaOwnerShardSourceKey = (typeof californiaOwnerShardSourceKeys)[number]

export type CaliforniaOwnerIndexRow = {
    source_key: CaliforniaOwnerShardSourceKey
    business_name: string
    record_id: string
    person_name: string
    person_role: string
    person_source_field: string
    status: string | null
    record_type: string | null
    address?: {
        street?: string | null
        city?: string | null
        state?: string | null
        postcode?: string | null
    } | null
    source_url?: string | null
    raw_payload?: Record<string, unknown> | null
}

export type CaliforniaOwnerShardRecord = {
    v: 1
    s: CaliforniaOwnerShardSourceKey
    n: string
    b: string
    r: string
    p: string
    role: string
    field: string
    status: string | null
    rt: string | null
    street: string | null
    city: string | null
    state: string | null
    zip: string | null
    url: string | null
}

export function isCaliforniaOwnerShardSourceKey(value: string | null | undefined): value is CaliforniaOwnerShardSourceKey {
    return californiaOwnerShardSourceKeys.includes(value as CaliforniaOwnerShardSourceKey)
}

export function normaliseCaliforniaOwnerShardSearchText(value: string | null | undefined) {
    return (value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
        .replace(/\b(?:d\/b\/a|dba|doing business as|llc|l\.l\.c\.?|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|p\.a\.|pa|pc)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

export function californiaOwnerShardSourcePath(sourceKey: CaliforniaOwnerShardSourceKey) {
    if (sourceKey === "registry.ca.los_angeles_fbn") return "los_angeles_fbn"
    if (sourceKey === "registry.ca.san_francisco_business_locations") return "san_francisco_business_locations"
    return "calrecycle_waste"
}

export function californiaOwnerShardKeyForName(value: string | null | undefined, prefixLength = CALIFORNIA_OWNER_DEFAULT_SHARD_PREFIX_LENGTH) {
    const compact = normaliseCaliforniaOwnerShardSearchText(value).replace(/[^a-z0-9]/g, "")
    if (!compact) return "misc"
    return compact.slice(0, prefixLength).padEnd(prefixLength, "_")
}

export function californiaOwnerShardKeysForName(value: string | null | undefined, prefixLength = CALIFORNIA_OWNER_DEFAULT_SHARD_PREFIX_LENGTH) {
    const normalised = normaliseCaliforniaOwnerShardSearchText(value)
    const keys = new Set([californiaOwnerShardKeyForName(normalised, prefixLength)])
    const tokens = normalised.split(/\s+/).filter(Boolean)
    while (tokens.length > 1 && CALIFORNIA_OWNER_SHARD_PREFIX_STOP_TOKENS.has(tokens[0])) tokens.shift()
    const withoutPrefix = tokens.join(" ")
    if (withoutPrefix && withoutPrefix !== normalised) keys.add(californiaOwnerShardKeyForName(withoutPrefix, prefixLength))
    keys.delete("misc")
    return [...keys]
}

export function californiaOwnerShardRelativePath({
    sourceKey,
    shardKey,
    version = CALIFORNIA_OWNER_SHARD_VERSION,
}: {
    sourceKey: CaliforniaOwnerShardSourceKey
    shardKey: string
    version?: string
}) {
    return `${version}/${californiaOwnerShardSourcePath(sourceKey)}/${shardKey}.jsonl.gz`
}

export function californiaOwnerShardUrl({
    baseUrl,
    sourceKey,
    shardKey,
    version = CALIFORNIA_OWNER_SHARD_VERSION,
}: {
    baseUrl: string
    sourceKey: CaliforniaOwnerShardSourceKey
    shardKey: string
    version?: string
}) {
    return `${baseUrl.replace(/\/+$/g, "")}/${californiaOwnerShardRelativePath({ sourceKey, shardKey, version })}`
}

export function californiaOwnerShardRecordFromRow(row: CaliforniaOwnerIndexRow): CaliforniaOwnerShardRecord | null {
    const normalisedBusinessName = normaliseCaliforniaOwnerShardSearchText(row.business_name)
    if (!normalisedBusinessName || !row.person_name.trim() || !row.record_id.trim()) return null
    const address = row.address ?? {}
    return {
        v: 1,
        s: row.source_key,
        n: normalisedBusinessName,
        b: row.business_name,
        r: row.record_id,
        p: row.person_name,
        role: row.person_role,
        field: row.person_source_field,
        status: row.status,
        rt: row.record_type,
        street: typeof address.street === "string" ? address.street : null,
        city: typeof address.city === "string" ? address.city : null,
        state: typeof address.state === "string" ? address.state : null,
        zip: typeof address.postcode === "string" ? address.postcode : null,
        url: row.source_url ?? null,
    }
}

export function parseCaliforniaOwnerShardJsonl(text: string) {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
            try {
                const record = JSON.parse(line) as Partial<CaliforniaOwnerShardRecord>
                if (
                    record.v !== 1 ||
                    !isCaliforniaOwnerShardSourceKey(record.s) ||
                    !record.n ||
                    !record.b ||
                    !record.r ||
                    !record.p
                ) return []
                return [record as CaliforniaOwnerShardRecord]
            } catch {
                return []
            }
        })
}

function tokenSet(value: string) {
    return new Set(normaliseCaliforniaOwnerShardSearchText(value).split(/\s+/).filter((token) => token.length >= 2))
}

function tokenOverlapScore(left: string, right: string) {
    const leftTokens = tokenSet(left)
    const rightTokens = tokenSet(right)
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0
    let overlap = 0
    for (const token of leftTokens) {
        if (rightTokens.has(token)) overlap += 1
    }
    return overlap / Math.max(leftTokens.size, rightTokens.size)
}

export function filterCaliforniaOwnerShardRecords(records: CaliforniaOwnerShardRecord[], searchTerm: string, limit = 25) {
    const normalisedSearchTerm = normaliseCaliforniaOwnerShardSearchText(searchTerm)
    if (!normalisedSearchTerm) return []
    return records
        .map((record) => {
            const exact = record.n === normalisedSearchTerm
            const contains = record.n.includes(normalisedSearchTerm) || normalisedSearchTerm.includes(record.n)
            const score = exact ? 1 : contains ? 0.92 : tokenOverlapScore(record.n, normalisedSearchTerm)
            return { record, score }
        })
        .filter((item) => item.score >= 0.56)
        .sort((left, right) => right.score - left.score || left.record.b.localeCompare(right.record.b))
        .slice(0, limit)
        .map((item) => item.record)
}
