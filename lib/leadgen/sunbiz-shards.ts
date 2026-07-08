import type { SunbizOwnerIndexRow } from "./sunbiz-bulk-index"
import { normaliseSunbizPersonName } from "./sunbiz-person-name.js"

export const SUNBIZ_SHARD_VERSION = "v1"
export const SUNBIZ_DEFAULT_SHARD_PREFIX_LENGTH = 3
const SUNBIZ_SHARD_PREFIX_STOP_TOKENS = new Set([
    "a",
    "an",
    "best",
    "first",
    "premier",
    "premium",
    "quality",
    "the",
    "top",
])

export type SunbizShardRecord = {
    v: 1
    s: SunbizOwnerIndexRow["source_key"]
    n: string
    b: string
    r: string
    p: string
    role: string
    field: string
    status: string | null
    rt: string | null
    city: string | null
    state: string | null
    zip: string | null
}

export function normaliseSunbizShardSearchText(value: string | null | undefined) {
    return (value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
        .replace(/\b(?:llc|l\.l\.c\.?|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|p\.a\.|pa|pc)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

export function sunbizShardSourcePath(sourceKey: SunbizOwnerIndexRow["source_key"]) {
    return sourceKey === "registry.fl.sunbiz" ? "sunbiz" : "fictitious_names"
}

export function sunbizShardKeyForName(value: string | null | undefined, prefixLength = SUNBIZ_DEFAULT_SHARD_PREFIX_LENGTH) {
    const normalised = normaliseSunbizShardSearchText(value)
    const compact = normalised.replace(/[^a-z0-9]/g, "")
    if (!compact) return "misc"
    return compact.slice(0, prefixLength).padEnd(prefixLength, "_")
}

export function sunbizShardKeysForName(value: string | null | undefined, prefixLength = SUNBIZ_DEFAULT_SHARD_PREFIX_LENGTH) {
    const normalised = normaliseSunbizShardSearchText(value)
    const keys = new Set([sunbizShardKeyForName(normalised, prefixLength)])
    const tokens = normalised.split(/\s+/).filter(Boolean)
    while (tokens.length > 1 && SUNBIZ_SHARD_PREFIX_STOP_TOKENS.has(tokens[0])) tokens.shift()
    const withoutPrefix = tokens.join(" ")
    if (withoutPrefix && withoutPrefix !== normalised) keys.add(sunbizShardKeyForName(withoutPrefix, prefixLength))
    keys.delete("misc")
    return [...keys]
}

export function sunbizShardRelativePath({
    sourceKey,
    shardKey,
    version = SUNBIZ_SHARD_VERSION,
}: {
    sourceKey: SunbizOwnerIndexRow["source_key"]
    shardKey: string
    version?: string
}) {
    return `${version}/${sunbizShardSourcePath(sourceKey)}/${shardKey}.jsonl.gz`
}

export function sunbizShardUrl({
    baseUrl,
    sourceKey,
    shardKey,
    version = SUNBIZ_SHARD_VERSION,
}: {
    baseUrl: string
    sourceKey: SunbizOwnerIndexRow["source_key"]
    shardKey: string
    version?: string
}) {
    return `${baseUrl.replace(/\/+$/g, "")}/${sunbizShardRelativePath({ sourceKey, shardKey, version })}`
}

export function sunbizShardRecordFromOwnerRow(row: SunbizOwnerIndexRow): SunbizShardRecord | null {
    const normalisedBusinessName = normaliseSunbizShardSearchText(row.business_name)
    if (!normalisedBusinessName || !row.person_name) return null
    const address = row.address ?? {}
    const personName = normaliseSunbizPersonName(row.person_name) ?? row.person_name
    return {
        v: 1,
        s: row.source_key,
        n: normalisedBusinessName,
        b: row.business_name,
        r: row.record_id,
        p: personName,
        role: row.person_role,
        field: row.person_source_field,
        status: row.status,
        rt: row.record_type,
        city: typeof address.city === "string" ? address.city : null,
        state: typeof address.state === "string" ? address.state : null,
        zip: typeof address.postcode === "string" ? address.postcode : null,
    }
}

export function parseSunbizShardJsonl(text: string) {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
            try {
                const record = JSON.parse(line) as Partial<SunbizShardRecord>
                if (record.v !== 1 || !record.s || !record.n || !record.b || !record.r || !record.p) return []
                return [record as SunbizShardRecord]
            } catch {
                return []
            }
        })
}

function tokenSet(value: string) {
    return new Set(normaliseSunbizShardSearchText(value).split(/\s+/).filter((token) => token.length >= 2))
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

export function filterSunbizShardRecords(records: SunbizShardRecord[], searchTerm: string, limit = 25) {
    const normalisedSearchTerm = normaliseSunbizShardSearchText(searchTerm)
    if (!normalisedSearchTerm) return []
    return records
        .map((record) => {
            const exact = record.n === normalisedSearchTerm
            const contains = record.n.includes(normalisedSearchTerm) || normalisedSearchTerm.includes(record.n)
            const score = exact ? 1 : contains ? 0.92 : tokenOverlapScore(record.n, normalisedSearchTerm)
            return { record, score }
        })
        .filter((item) => item.score >= 0.58)
        .sort((left, right) => right.score - left.score || left.record.b.localeCompare(right.record.b))
        .slice(0, limit)
        .map((item) => item.record)
}
