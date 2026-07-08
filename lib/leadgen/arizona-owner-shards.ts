import { createHash } from "node:crypto"

import { maybeNormaliseLastNameFirstPersonName, normalisePersonName } from "./person-name-normalizer.js"

export type ArizonaOwnerShardSourceKey = "registry.az.corp_commission" | "registry.az.trade_names"

export type ArizonaOwnerIndexRow = {
    source_key: ArizonaOwnerShardSourceKey
    record_id: string
    business_name: string
    status: string | null
    record_type: string | null
    person_name: string
    person_role: string
    person_source_field: string
    person_type: string | null
    address: Record<string, unknown>
    search_text: string
    raw_payload: Record<string, unknown>
}

export type ArizonaOwnerShardRecord = {
    v: 1
    s: ArizonaOwnerShardSourceKey
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
    raw: Record<string, unknown>
}

export const ARIZONA_OWNER_SHARD_VERSION = "v1"
export const ARIZONA_OWNER_DEFAULT_SHARD_PREFIX_LENGTH = 3

const ARIZONA_SHARD_PREFIX_STOP_TOKENS = new Set([
    "a",
    "an",
    "az",
    "arizona",
    "best",
    "desert",
    "first",
    "phoenix",
    "premier",
    "premium",
    "quality",
    "the",
    "top",
    "tucson",
])

const BUSINESS_SUFFIX_PATTERN = /\b(?:llc|l\.l\.c\.?|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|p\.a\.|pa|pc|dba|d\/b\/a|aka|trade\s+name)\b/g

type FieldSpec = {
    fields: string[]
    role: string
    personType?: string
}

const ACC_PERSON_FIELDS: FieldSpec[] = [
    { fields: ["person_name", "owner_name", "principal_name", "principal", "individual_name"], role: "principal" },
    { fields: ["member_name", "manager_name", "managing_member_name"], role: "member_or_manager" },
    { fields: ["officer_name", "director_name", "president_name", "secretary_name", "treasurer_name"], role: "officer_or_director" },
    { fields: ["statutory_agent_name", "registered_agent_name", "agent_name"], role: "statutory_agent" },
]

const TRADE_NAME_PERSON_FIELDS: FieldSpec[] = [
    { fields: ["person_name", "owner_name", "registrant_name", "applicant_name", "holder_name", "proprietor_name"], role: "trade_name_registrant" },
]

const BUSINESS_FIELDS = [
    "business_name",
    "entity_name",
    "entityname",
    "organization_name",
    "company_name",
    "legal_name",
    "trade_name",
    "tradename",
    "name",
]

const RECORD_ID_FIELDS = [
    "record_id",
    "entity_id",
    "entity_number",
    "file_number",
    "filing_id",
    "sos_file_number",
    "trade_name_id",
    "registration_number",
]

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function compact(value: string | null | undefined) {
    return (value ?? "").replace(/\s+/g, " ").trim()
}

function normaliseFieldKey(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function rowValue(row: Record<string, unknown>, fields: string[]) {
    for (const field of fields) {
        const direct = asString(row[field])
        if (direct) return direct
        const wanted = normaliseFieldKey(field)
        const matchingKey = Object.keys(row).find((key) => normaliseFieldKey(key) === wanted)
        if (matchingKey) {
            const value = asString(row[matchingKey])
            if (value) return value
        }
    }
    return null
}

function addressFromRow(row: Record<string, unknown>) {
    return {
        street: rowValue(row, ["street", "street_address", "address", "principal_address", "mailing_address"]),
        city: rowValue(row, ["city", "principal_city", "mailing_city"]),
        state: rowValue(row, ["state", "principal_state", "mailing_state"]) ?? "AZ",
        postcode: rowValue(row, ["postcode", "zip", "zip_code", "postal_code", "principal_zip", "mailing_zip"]),
        country: rowValue(row, ["country"]) ?? "US",
    }
}

function stableRecordId(sourceKey: ArizonaOwnerShardSourceKey, row: Record<string, unknown>, businessName: string, personName: string, role: string) {
    const explicit = rowValue(row, RECORD_ID_FIELDS)
    if (explicit) return explicit
    const digest = createHash("sha1")
        .update([sourceKey, businessName, personName, role].join("|").toLowerCase())
        .digest("hex")
        .slice(0, 16)
    return `${sourceKey}:${digest}`
}

function normaliseArizonaPersonName(value: string | null | undefined) {
    return maybeNormaliseLastNameFirstPersonName(value, { ownerContext: true, allowAllCaps: true })
        ?? normalisePersonName(value, { ownerContext: true, allowAllCaps: true })
}

function searchText(...values: Array<string | null | undefined>) {
    return [...new Set(values.map(normaliseArizonaOwnerShardSearchText).filter(Boolean))].join(" ")
}

function statusFromRow(row: Record<string, unknown>) {
    return rowValue(row, ["status", "entity_status", "registration_status", "standing"])
}

function recordTypeFromRow(sourceKey: ArizonaOwnerShardSourceKey, row: Record<string, unknown>) {
    return rowValue(row, ["record_type", "entity_type", "registration_type", "filing_type"])
        ?? (sourceKey === "registry.az.trade_names" ? "Arizona trade name registration" : "Arizona Corporation Commission entity record")
}

function personSpecs(sourceKey: ArizonaOwnerShardSourceKey) {
    return sourceKey === "registry.az.trade_names" ? TRADE_NAME_PERSON_FIELDS : ACC_PERSON_FIELDS
}

export function normaliseArizonaOwnerShardSearchText(value: string | null | undefined) {
    return compact(value)
        .toLowerCase()
        .replace(BUSINESS_SUFFIX_PATTERN, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

export function arizonaOwnerShardSourcePath(sourceKey: ArizonaOwnerShardSourceKey) {
    return sourceKey === "registry.az.trade_names" ? "trade_names" : "corp_commission"
}

export function arizonaOwnerShardKeyForName(value: string | null | undefined, prefixLength = ARIZONA_OWNER_DEFAULT_SHARD_PREFIX_LENGTH) {
    const normalised = normaliseArizonaOwnerShardSearchText(value)
    const compacted = normalised.replace(/[^a-z0-9]/g, "")
    if (!compacted) return "misc"
    return compacted.slice(0, prefixLength).padEnd(prefixLength, "_")
}

export function arizonaOwnerShardKeysForName(value: string | null | undefined, prefixLength = ARIZONA_OWNER_DEFAULT_SHARD_PREFIX_LENGTH) {
    const normalised = normaliseArizonaOwnerShardSearchText(value)
    const keys = new Set([arizonaOwnerShardKeyForName(normalised, prefixLength)])
    const tokens = normalised.split(/\s+/).filter(Boolean)
    while (tokens.length > 1 && ARIZONA_SHARD_PREFIX_STOP_TOKENS.has(tokens[0])) tokens.shift()
    const withoutPrefix = tokens.join(" ")
    if (withoutPrefix && withoutPrefix !== normalised) keys.add(arizonaOwnerShardKeyForName(withoutPrefix, prefixLength))
    keys.delete("misc")
    return [...keys]
}

export function arizonaOwnerShardRelativePath({
    sourceKey,
    shardKey,
    version = ARIZONA_OWNER_SHARD_VERSION,
}: {
    sourceKey: ArizonaOwnerShardSourceKey
    shardKey: string
    version?: string
}) {
    return `${version}/${arizonaOwnerShardSourcePath(sourceKey)}/${shardKey}.jsonl.gz`
}

export function arizonaOwnerShardUrl({
    baseUrl,
    sourceKey,
    shardKey,
    version = ARIZONA_OWNER_SHARD_VERSION,
}: {
    baseUrl: string
    sourceKey: ArizonaOwnerShardSourceKey
    shardKey: string
    version?: string
}) {
    return `${baseUrl.replace(/\/+$/g, "")}/${arizonaOwnerShardRelativePath({ sourceKey, shardKey, version })}`
}

export function arizonaOwnerIndexRowsFromRecord(sourceKey: ArizonaOwnerShardSourceKey, rowInput: Record<string, unknown>) {
    const row = asRecord(rowInput)
    const businessName = rowValue(row, BUSINESS_FIELDS)
    if (!businessName) return []
    const status = statusFromRow(row)
    const recordType = recordTypeFromRow(sourceKey, row)
    const address = addressFromRow(row)
    const rows: ArizonaOwnerIndexRow[] = []
    for (const spec of personSpecs(sourceKey)) {
        const rawName = rowValue(row, spec.fields)
        const personName = normaliseArizonaPersonName(rawName)
        if (!personName) continue
        const personSourceField = spec.fields.find((field) => rowValue(row, [field])) ?? spec.fields[0]
        const role = rowValue(row, ["person_role", "role", "title", "office"]) ?? spec.role
        const recordId = stableRecordId(sourceKey, row, businessName, personName, role)
        rows.push({
            source_key: sourceKey,
            record_id: `${recordId}:${normaliseFieldKey(personSourceField)}:${normaliseFieldKey(personName)}`,
            business_name: compact(businessName),
            status,
            record_type: recordType,
            person_name: personName,
            person_role: role,
            person_source_field: personSourceField,
            person_type: spec.personType ?? "Person",
            address,
            search_text: searchText(businessName, recordId, personName),
            raw_payload: row,
        })
    }
    return rows
}

export function arizonaOwnerShardRecordFromOwnerRow(row: ArizonaOwnerIndexRow): ArizonaOwnerShardRecord | null {
    const normalisedBusinessName = normaliseArizonaOwnerShardSearchText(row.business_name)
    if (!normalisedBusinessName || !row.person_name) return null
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
        city: typeof address.city === "string" ? address.city : null,
        state: typeof address.state === "string" ? address.state : null,
        zip: typeof address.postcode === "string" ? address.postcode : null,
        raw: row.raw_payload,
    }
}

export function parseArizonaOwnerShardJsonl(text: string) {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
            try {
                const record = JSON.parse(line) as Partial<ArizonaOwnerShardRecord>
                if (record.v !== 1 || !record.s || !record.n || !record.b || !record.r || !record.p) return []
                if (record.s !== "registry.az.corp_commission" && record.s !== "registry.az.trade_names") return []
                return [{
                    ...record,
                    raw: asRecord(record.raw),
                } as ArizonaOwnerShardRecord]
            } catch {
                return []
            }
        })
}

function tokenSet(value: string) {
    return new Set(normaliseArizonaOwnerShardSearchText(value).split(/\s+/).filter((token) => token.length >= 2))
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

export function filterArizonaOwnerShardRecords(records: ArizonaOwnerShardRecord[], searchTerm: string, limit = 25) {
    const normalisedSearchTerm = normaliseArizonaOwnerShardSearchText(searchTerm)
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
