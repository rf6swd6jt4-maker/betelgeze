import { createHash } from "crypto"
import { gunzipSync } from "node:zlib"

import { identityPayloadForCompany, identityProfileFromOfficialRecord, mergeIdentityForCompany } from "@/lib/leadgen/company-identity-resolution"
import { recordEvidenceClaim, updateInvestigationTask } from "@/lib/leadgen/evidence-scoring"
import {
    assessOfficialRecordMatch,
    buildOfficialRecordSearchTerms,
    candidateDomain,
    officialRecordMatchesCandidate,
    sharedTokenScore,
    strongBusinessNameMatch,
    summarizeOfficialRecordRejections,
} from "@/lib/leadgen/official-record-matching"
import { candidatePrimaryCity, candidatePrimaryPostcode, candidatePrimaryState } from "@/lib/leadgen/location-resolution"
import {
    isLikelyPublicRecordPersonName,
    publicRecordPersonCandidates,
} from "@/lib/leadgen/public-record-person-extraction"
import { refreshLeadgenPollCounts, setLeadgenPollStatus } from "@/lib/leadgen/osm-worker"
import {
    classifyPublicRecordFailure,
    looksLikeGuardedOrAppShell,
    publicRecordPollUnsafeReason,
    type PublicRecordFailureClassification,
    type PublicRecordSourceHealthStatus,
} from "@/lib/leadgen/public-record-source-safety"
import { normaliseSunbizIndexSearchText } from "@/lib/leadgen/sunbiz-bulk-index"
import {
    filterSunbizShardRecords,
    parseSunbizShardJsonl,
    SUNBIZ_DEFAULT_SHARD_PREFIX_LENGTH,
    SUNBIZ_SHARD_VERSION,
    sunbizShardKeysForName,
    sunbizShardUrl,
    type SunbizShardRecord,
} from "@/lib/leadgen/sunbiz-shards"
import type { PollStageKey } from "@/lib/leadgen/staged-poll"
import { groupByKey, runWithConcurrency } from "@/lib/leadgen/task-execution"
import { supabaseAdmin } from "@/lib/supabase/admin"

type SourceCatalog = {
    source_key: string
    label: string
    family: string
    owner_identity_points: number
    owner_phone_points: number
    business_support_points: number
    rate_limit_ms: number
    metadata: Record<string, unknown> | null
}

type InvestigationTask = {
    id: string
    company_id: string
    source_key: string
    stage_key: Exclude<PollStageKey, "seed">
}

type CompanyCandidate = {
    id: string
    display_name: string
    canonical_name: string | null
    legal_name: string | null
    dba_name: string | null
    entity_number: string | null
    filing_id: string | null
    registered_address: Record<string, unknown> | null
    known_aliases: string[] | null
    identity_resolution: Record<string, unknown> | null
    identity_source_key: string | null
    identity_confidence: number | null
    identity_resolved_at: string | null
    phone: string | null
    website_domain: string | null
    website_url: string | null
    profile_url: string | null
    source_record_id: string | null
    address: Record<string, unknown> | null
    latitude: number | null
    longitude: number | null
    industry_value: string | null
    location_value: string | null
}

type SocrataRecord = Record<string, unknown>

type MatchResult = {
    row: SocrataRecord
    businessName: string | null
    personName: string | null
    phone: string | null
    permitNumber: string | null
    status: string | null
    recordType: string | null
    address: Record<string, unknown>
    latitude: number | null
    longitude: number | null
    confidence: number
    matchReasons: string[]
    matchSignals: Record<string, unknown>
    personRole: string | null
    personSourceField: string | null
    personConfidence: number | null
    personCandidates: Array<Record<string, unknown>>
}

type TaskProcessOutcome = {
    sourceTouched: boolean
    matched: boolean
    returnedRows?: number
}

const EXECUTABLE_PUBLIC_RECORD_SOURCES = new Set([
    "permits.tx.dallas",
    "permits.tx.austin",
    "permits.fl.orlando",
    "permits.ca.los_angeles",
    "permits.az.phoenix",
    "registry.tx.comptroller",
    "state_license.tx.tda_pest",
    "regulated.tx.tceq_waste",
    "registry.fl.sunbiz",
    "registry.fl.fictitious_names",
    "state_license.fl.fdacs_pest",
    "state_license.fl.fdacs_auto_repair",
    "registry.fl.miami_dade_lbt",
    "registry.fl.tampa_btr",
    "registry.fl.jacksonville_btr",
    "registry.fl.orlando_btr",
    "state_license.ca.cslb",
    "state_license.ca.bar_auto_repair",
    "state_license.ca.pest_control",
    "registry.ca.bizfile",
    "registry.ca.los_angeles_fbn",
    "registry.ca.san_francisco_business_locations",
    "regulated.ca.calrecycle_waste",
    "state_license.az.roc",
    "state_license.az.pest_management",
    "registry.az.corp_commission",
    "safety.osha",
    "transport.fmcsa_safer",
    "transport.fmcsa_census",
    "regulated.epa_echo",
    "regulated.nppes",
    "procurement.usaspending",
    "web.rdap_whois",
    "web.certificate_transparency",
])

const PUBLIC_RECORD_FETCH_TIMEOUT_MS = 18_000
const CSV_CACHE = new Map<string, Promise<string>>()
const SUNBIZ_SHARD_CACHE = new Map<string, Promise<SunbizShardRecord[]>>()

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

const PUBLIC_RECORD_SOURCE_CONCURRENCY: Record<Exclude<PollStageKey, "seed">, number> = {
    business_validation: 3,
    owner_identity: 5,
    owner_phone: 4,
    phone_validation: 1,
}

function publicRecordSourceDelay(source: SourceCatalog) {
    return Math.min(5000, Math.max(0, source.rate_limit_ms ?? 1000))
}

function publicRecordSourcePriority(source: SourceCatalog | undefined, stageKey: Exclude<PollStageKey, "seed"> | undefined) {
    if (!source) return -1000
    const identityPoints = Number(source.owner_identity_points) || 0
    const phonePoints = Number(source.owner_phone_points) || 0
    const supportPoints = Number(source.business_support_points) || 0
    const delayPenalty = publicRecordSourceDelay(source) / 1000
    if (stageKey === "owner_phone") return phonePoints * 120 + identityPoints * 30 + supportPoints * 8 - delayPenalty
    if (stageKey === "owner_identity") return identityPoints * 120 + phonePoints * 45 + supportPoints * 8 - delayPenalty
    return supportPoints * 100 + identityPoints * 25 + phonePoints * 15 - delayPenalty
}

function compactErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "Public-record source task failed."
    return message.length > 900 ? `${message.slice(0, 900)}…` : message
}

function compactSkipReason(value: string) {
    return value.length > 700 ? `${value.slice(0, 700)}…` : value
}

function isRetryablePublicRecordFetchError(error: unknown) {
    return ["timeout", "rate_limited", "server_error", "network"].includes(classifyPublicRecordFailure(error).kind)
}

async function recordPublicRecordSourceHealth({
    sourceKey,
    status,
    pollId,
    stageKey,
    lastError,
    classification,
    sourceTouched,
}: {
    sourceKey: string
    status: PublicRecordSourceHealthStatus
    pollId: string
    stageKey: Exclude<PollStageKey, "seed"> | undefined
    lastError?: string | null
    classification?: PublicRecordFailureClassification
    sourceTouched?: boolean
}) {
    const now = new Date().toISOString()
    try {
        const existingResult = await supabaseAdmin
            .from("leadgen_source_health")
            .select("metadata")
            .eq("source_key", sourceKey)
            .maybeSingle()
        const metadata = {
            ...asRecord(existingResult.data?.metadata),
            worker: "public_records",
            last_poll_id: pollId,
            last_stage_key: stageKey ?? null,
            last_checked_at: now,
            last_source_touched: Boolean(sourceTouched),
            ...(classification ? {
                last_failure_kind: classification.kind,
                last_failure_source_scoped: classification.sourceScoped,
                last_failure_skipped_remaining_tasks: classification.skipRemainingTasks,
            } : {
                last_failure_kind: null,
                last_failure_source_scoped: null,
                last_failure_skipped_remaining_tasks: null,
            }),
        }
        const payload: Record<string, unknown> = {
            source_key: sourceKey,
            status,
            last_error: lastError ?? null,
            metadata,
            updated_at: now,
        }
        if (status === "healthy") payload.last_success_at = now
        else payload.last_failure_at = now
        const { error } = await supabaseAdmin
            .from("leadgen_source_health")
            .upsert(payload, { onConflict: "source_key" })
        if (error) console.warn(`Could not update leadgen source health for ${sourceKey}: ${error.message}`)
    } catch (error) {
        console.warn(`Could not update leadgen source health for ${sourceKey}: ${compactErrorMessage(error)}`)
    }
}

function sourceScopedSkipReason(source: SourceCatalog, classification: PublicRecordFailureClassification, errorMessage: string) {
    const label = classification.healthStatus === "blocked" ? "blocked" : "degraded"
    return compactSkipReason(`${source.label} was marked ${label} for this poll after a ${classification.kind.replace(/_/g, " ")} response. Remaining tasks were skipped instead of repeating the same source-level failure. Last error: ${errorMessage}`)
}

function missingIdentityColumn(error: { code?: string; message?: string } | null) {
    return error?.code === "42703" || /legal_name|dba_name|entity_number|identity_resolution|known_aliases/i.test(error?.message ?? "")
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function asStringArray(value: unknown) {
    return Array.isArray(value) ? value.map(asString).filter((item): item is string => Boolean(item)) : []
}

function cleanText(value: string | null | undefined) {
    return (value ?? "").replace(/\s+/g, " ").trim()
}

function normalisePhone(value: string | null | undefined) {
    const digits = value?.replace(/\D/g, "") ?? ""
    if (digits.length === 10) return `+1${digits}`
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
    return digits.length >= 7 ? `+${digits}` : null
}

function decodeHtml(value: string) {
    return value
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
}

function stripHtml(value: string) {
    return cleanText(decodeHtml(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")))
}

function candidateCity(candidate: CompanyCandidate) {
    return candidatePrimaryCity(candidate)
}

function candidatePostcode(candidate: CompanyCandidate) {
    return candidatePrimaryPostcode(candidate)
}

function parseCsvLine(line: string) {
    const cells: string[] = []
    let current = ""
    let quoted = false
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index]
        const next = line[index + 1]
        if (char === "\"" && quoted && next === "\"") {
            current += "\""
            index += 1
            continue
        }
        if (char === "\"") {
            quoted = !quoted
            continue
        }
        if (char === "," && !quoted) {
            cells.push(cleanText(current))
            current = ""
            continue
        }
        current += char
    }
    cells.push(cleanText(current))
    return cells
}

function csvRowsWithHeaders(csv: string) {
    const lines = csv.split(/\r?\n/).filter((line) => line.trim())
    const headerIndex = lines.findIndex((line) => {
        const lower = line.toLowerCase()
        return lower.includes("business") || lower.includes("contractor") || lower.includes("license") || lower.includes("owner") || lower.includes("type,number")
    })
    const [headerLine, ...dataLines] = lines.slice(Math.max(0, headerIndex))
    const headers = parseCsvLine(headerLine ?? "").map((header) => header.trim())
    return dataLines.map((line) => {
        const cells = parseCsvLine(line)
        return Object.fromEntries(headers.map((header, index) => [header, cleanText(cells[index])]))
    })
}

async function fetchCachedCsv(url: string) {
    const cached = CSV_CACHE.get(url)
    if (cached) return cached
    const promise = fetchTextWithTimeout(url, { headers: { Accept: "text/csv,text/plain,*/*" } })
    CSV_CACHE.set(url, promise)
    return promise
}

function dateParts(date: Date) {
    return {
        month: String(date.getUTCMonth() + 1).padStart(2, "0"),
        day: String(date.getUTCDate()).padStart(2, "0"),
        year: String(date.getUTCFullYear()),
    }
}

function usDate(date: Date) {
    const parts = dateParts(date)
    return `${parts.month}/${parts.day}/${parts.year}`
}

function assertNotChallenge(sourceLabel: string, text: string) {
    if (looksLikeGuardedOrAppShell(text)) throw new Error(`${sourceLabel} returned an anti-bot, captcha, app shell, or geo-block challenge instead of public records.`)
}

function looksLikePersonName(value: string | null | undefined) {
    return isLikelyPublicRecordPersonName(value)
}

function personFromContractorField(value: string | null | undefined) {
    const clean = cleanText(value ?? "")
    if (!clean) return null
    const beforeParentheses = clean.replace(/\([^)]*\)/g, " ").trim()
    if (looksLikePersonName(beforeParentheses)) return beforeParentheses
    return looksLikePersonName(clean) ? clean : null
}

function hashRecord(value: unknown) {
    return createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 20)
}

function pickString(row: SocrataRecord, fields: string[]) {
    for (const field of fields) {
        const value = asString(row[field])
        if (value) return value
    }
    return null
}

function candidateState(candidate: CompanyCandidate) {
    return candidatePrimaryState(candidate)
}

function extractPoint(row: SocrataRecord, fields: string[]) {
    for (const field of fields) {
        const value = row[field]
        if (value && typeof value === "object") {
            const coordinates = (value as { coordinates?: unknown }).coordinates
            if (Array.isArray(coordinates) && coordinates.length >= 2) {
                const longitude = Number(coordinates[0])
                const latitude = Number(coordinates[1])
                if (Number.isFinite(latitude) && Number.isFinite(longitude)) return { latitude, longitude }
            }
        }
    }
    const latitude = Number(pickString(row, ["lat", "latitude"]))
    const longitude = Number(pickString(row, ["lon", "lng", "longitude"]))
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : { latitude: null, longitude: null }
}

function addressFromRow(row: SocrataRecord, metadata: Record<string, unknown>) {
    const fieldMap = asRecord(metadata.field_map)
    const addressFields = asStringArray(fieldMap.address)
    const cityFields = asStringArray(fieldMap.city)
    const stateFields = asStringArray(fieldMap.state)
    const postcodeFields = asStringArray(fieldMap.postcode)
    const configuredState = asString(asRecord(metadata.default_address).state)
    const configuredCity = asString(asRecord(metadata.default_address).city)
    const state = pickString(row, stateFields) ?? configuredState
    return {
        street: pickString(row, addressFields),
        city: pickString(row, cityFields) ?? configuredCity,
        state,
        postcode: pickString(row, postcodeFields),
        country: "US",
    }
}

function sourceProfileUrl(sourceKey: string, metadata: Record<string, unknown>, result: MatchResult) {
    const rowUrl = asString(result.row.source_url)
    if (rowUrl) return rowUrl
    const configured = asString(metadata.provenance_url)
    if (configured) return configured
    const domain = asString(metadata.domain)
    const datasetId = asString(metadata.dataset_id)
    if (!domain || !datasetId) return null
    const marker = encodeURIComponent(result.permitNumber ?? result.businessName ?? result.personName ?? "")
    return marker ? `https://${domain}/d/${datasetId}?row=${marker}` : `https://${domain}/d/${datasetId}`
}

async function fetchTextWithTimeout(url: string, init?: RequestInit) {
    const attempts = 2
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), PUBLIC_RECORD_FETCH_TIMEOUT_MS)
        try {
            const response = await fetch(url, {
                ...init,
                headers: {
                    Accept: "text/html,application/json,*/*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)",
                    ...(init?.headers ?? {}),
                },
                cache: "no-store",
                signal: controller.signal,
            })
            const text = await response.text()
            if (!response.ok) {
                const error = new Error(`${url} returned HTTP ${response.status}: ${stripHtml(text).slice(0, 280)}`)
                if (attempt < attempts && isRetryablePublicRecordFetchError(error)) {
                    await sleep(350 * attempt)
                    continue
                }
                throw error
            }
            return text
        } catch (error) {
            const wrappedError = error instanceof Error && error.name === "AbortError"
                ? new Error(`${url} timed out after ${Math.round(PUBLIC_RECORD_FETCH_TIMEOUT_MS / 1000)} seconds.`)
                : error
            if (attempt < attempts && isRetryablePublicRecordFetchError(wrappedError)) {
                await sleep(350 * attempt)
                continue
            }
            throw wrappedError
        } finally {
            clearTimeout(timeout)
        }
    }
    throw new Error(`${url} failed after ${attempts} attempts.`)
}

async function fetchSocrataRows(metadata: Record<string, unknown>, searchTerm: string) {
    const domain = asString(metadata.domain)
    const datasetId = asString(metadata.dataset_id)
    if (!domain || !datasetId) throw new Error("Socrata source is missing domain or dataset_id metadata.")
    if (!searchTerm) return []
    const limit = Math.min(50, Math.max(1, Number(metadata.query_limit) || 15))
    const params = new URLSearchParams({ "$limit": String(limit), "$q": searchTerm })
    const whereClause = asString(metadata.where_clause)
    if (whereClause) params.set("$where", whereClause)
    const url = `https://${domain}/resource/${datasetId}.json?${params.toString()}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PUBLIC_RECORD_FETCH_TIMEOUT_MS)
    try {
        const response = await fetch(url, {
            headers: {
                Accept: "application/json",
                "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)",
            },
            cache: "no-store",
            signal: controller.signal,
        })
        const text = await response.text()
        if (!response.ok) throw new Error(`${domain}/${datasetId} returned HTTP ${response.status}: ${text.slice(0, 280)}`)
        const rows = JSON.parse(text) as unknown
        return Array.isArray(rows) ? rows.filter((row): row is SocrataRecord => Boolean(row && typeof row === "object" && !Array.isArray(row))) : []
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error(`${domain}/${datasetId} timed out after ${Math.round(PUBLIC_RECORD_FETCH_TIMEOUT_MS / 1000)} seconds.`)
        throw error
    } finally {
        clearTimeout(timeout)
    }
}

async function fetchSunbizOwnerIndexRows(source: SourceCatalog, searchTerm: string) {
    const searchText = normaliseSunbizIndexSearchText(searchTerm)
    if (!searchText) return []
    const limit = Math.min(50, Math.max(1, Number(source.metadata?.query_limit) || 15))
    const { data, error } = await supabaseAdmin
        .from("leadgen_sunbiz_owner_index")
        .select("record_id, business_name, status, record_type, person_name, person_role, person_source_field, person_type, address, raw_payload")
        .eq("source_key", source.source_key)
        .ilike("search_text", `%${searchText}%`)
        .limit(limit)
    if (error) throw new Error(`Could not query Sunbiz owner index: ${error.message}`)
    return (data ?? []).map((row) => {
        const address = asRecord(row.address)
        return {
            business_name: asString(row.business_name),
            owner_name: asString(row.person_name),
            person_name: asString(row.person_name),
            person_role: asString(row.person_role),
            person_source_field: asString(row.person_source_field),
            person_type: asString(row.person_type),
            record_id: asString(row.record_id),
            status: asString(row.status),
            record_type: asString(row.record_type),
            address: asString(address.street),
            city: asString(address.city),
            state: asString(address.state),
            postcode: asString(address.postcode),
            raw_payload: asRecord(row.raw_payload),
        }
    })
}

function isSunbizShardSourceKey(sourceKey: string): sourceKey is "registry.fl.sunbiz" | "registry.fl.fictitious_names" {
    return sourceKey === "registry.fl.sunbiz" || sourceKey === "registry.fl.fictitious_names"
}

function sunbizShardBaseUrl(metadata: Record<string, unknown>) {
    return asString(metadata.shard_base_url) ?? process.env.SUNBIZ_SHARD_BASE_URL?.trim() ?? null
}

async function fetchSunbizShardRecords(url: string) {
    const cached = SUNBIZ_SHARD_CACHE.get(url)
    if (cached) return cached
    const promise = (async () => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), PUBLIC_RECORD_FETCH_TIMEOUT_MS)
        try {
            const response = await fetch(url, {
                headers: {
                    Accept: "application/x-ndjson,application/json,text/plain,*/*",
                    "Accept-Encoding": "gzip",
                    "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)",
                },
                cache: "force-cache",
                signal: controller.signal,
            })
            if (response.status === 404) return []
            const bytes = Buffer.from(await response.arrayBuffer())
            if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${bytes.toString("utf8").slice(0, 280)}`)
            let text: string
            try {
                text = gunzipSync(bytes).toString("utf8")
            } catch {
                text = bytes.toString("utf8")
            }
            return parseSunbizShardJsonl(text)
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") throw new Error(`${url} timed out after ${Math.round(PUBLIC_RECORD_FETCH_TIMEOUT_MS / 1000)} seconds.`)
            throw error
        } finally {
            clearTimeout(timeout)
        }
    })()
    SUNBIZ_SHARD_CACHE.set(url, promise)
    return promise
}

async function fetchSunbizShardLookupRows(source: SourceCatalog, searchTerm: string) {
    if (!isSunbizShardSourceKey(source.source_key)) throw new Error(`${source.label} is not a supported Sunbiz shard source.`)
    const sourceKey = source.source_key
    const metadata = source.metadata ?? {}
    const baseUrl = sunbizShardBaseUrl(metadata)
    if (!baseUrl) throw new Error(`${source.label} requires SUNBIZ_SHARD_BASE_URL before poll-time activation.`)
    const prefixLength = Math.min(5, Math.max(1, Number(metadata.shard_prefix_length) || SUNBIZ_DEFAULT_SHARD_PREFIX_LENGTH))
    const shardKeys = sunbizShardKeysForName(searchTerm, prefixLength)
    if (shardKeys.length === 0) return []
    const version = asString(metadata.shard_version) ?? process.env.SUNBIZ_SHARD_VERSION?.trim() ?? SUNBIZ_SHARD_VERSION
    const limit = Math.min(50, Math.max(1, Number(metadata.query_limit) || 20))
    const records = (await Promise.all(shardKeys.map(async (shardKey) => {
        const url = sunbizShardUrl({ baseUrl, sourceKey, shardKey, version })
        return fetchSunbizShardRecords(url)
    }))).flat()
    const seenRecords = new Set<string>()
    const uniqueRecords = records.filter((record) => {
        const key = `${record.s}:${record.r}:${record.p}`
        if (seenRecords.has(key)) return false
        seenRecords.add(key)
        return true
    })
    return filterSunbizShardRecords(uniqueRecords, searchTerm, limit).map((record) => ({
        business_name: record.b,
        owner_name: record.p,
        person_name: record.p,
        person_role: record.role,
        person_source_field: record.field,
        record_id: record.r,
        status: record.status,
        record_type: record.rt,
        city: record.city,
        state: record.state,
        postcode: record.zip,
        raw_payload: {
            shard_keys: shardKeys,
            normalized_business_name: record.n,
            source_key: record.s,
        },
    }))
}

function parseFmcsaLabel(html: string, label: string) {
    const expression = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:<\\/A><\\/TH>\\s*<TD[^>]*>([\\s\\S]*?)<\\/TD>`, "i")
    return stripHtml(html.match(expression)?.[1] ?? "") || null
}

function parseFmcsaPhysicalAddress(value: string | null) {
    const clean = cleanText(value ?? "")
    const match = clean.match(/^(.+?)\s+([A-Z][A-Za-z .'-]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/)
    return {
        street: match?.[1] ?? (clean || null),
        city: match?.[2] ?? null,
        state: match?.[3] ?? null,
        postcode: match?.[4] ?? null,
        country: "US",
    }
}

async function fetchFmcsaRows(searchTerm: string) {
    const body = new URLSearchParams({
        searchtype: "ANY",
        query_type: "queryCarrierSnapshot",
        query_param: "NAME",
        query_string: searchTerm,
    })
    const html = await fetchTextWithTimeout("https://safer.fmcsa.dot.gov/query.asp", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    })
    const usdotNumbers = [...html.matchAll(/query_param=USDOT[^"]*query_string=(\d+)/gi)].map((match) => match[1]).filter(Boolean)
    const directUsdot = parseFmcsaLabel(html, "USDOT Number")
    const numbers = [...new Set([directUsdot?.replace(/\D/g, ""), ...usdotNumbers].filter((value): value is string => Boolean(value)))].slice(0, 3)
    const rows: SocrataRecord[] = []
    for (const usdotNumber of numbers) {
        const sourceUrl = `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${encodeURIComponent(usdotNumber)}`
        const detailHtml = await fetchTextWithTimeout(sourceUrl)
        const legalName = parseFmcsaLabel(detailHtml, "Legal Name")
        const dbaName = parseFmcsaLabel(detailHtml, "DBA Name")
        const phone = parseFmcsaLabel(detailHtml, "Phone")
        const physicalAddress = parseFmcsaLabel(detailHtml, "Physical Address")
        const status = parseFmcsaLabel(detailHtml, "USDOT Status")
        if (!legalName && !dbaName) continue
        rows.push({
            legal_name: legalName,
            dba_name: dbaName,
            phone,
            physical_address: physicalAddress,
            usdot_number: usdotNumber,
            status,
            entity_type: parseFmcsaLabel(detailHtml, "Entity Type"),
            operating_authority_status: parseFmcsaLabel(detailHtml, "Operating Authority Status"),
            source_url: sourceUrl,
            ...parseFmcsaPhysicalAddress(physicalAddress),
        })
    }
    return rows
}

function fmcsaCensusStatus(value: string | null) {
    if (value === "A") return "Active"
    if (value === "I") return "Inactive"
    if (value === "P") return "Pending"
    return value
}

async function fetchFmcsaCensusRows(searchTerm: string, metadata: Record<string, unknown>, company: CompanyCandidate) {
    if (!searchTerm) return []
    const domain = asString(metadata.domain) ?? "data.transportation.gov"
    const datasetId = asString(metadata.dataset_id) ?? "az4n-8mr2"
    const limit = Math.min(25, Math.max(1, Number(metadata.query_limit) || 12))
    const params = new URLSearchParams({
        "$limit": String(limit),
        "$q": searchTerm,
        "$select": [
            "dot_number",
            "status_code",
            "legal_name",
            "dba_name",
            "phy_street",
            "phy_city",
            "phy_state",
            "phy_zip",
            "phy_cnty",
            "phone",
            "cell_phone",
            "email_address",
            "company_officer_1",
            "company_officer_2",
            "carrier_operation",
        ].join(","),
        status_code: "A",
    })
    const state = candidateState(company)
    if (state) params.set("phy_state", state)
    const text = await fetchTextWithTimeout(`https://${domain}/resource/${datasetId}.json?${params.toString()}`, { headers: { Accept: "application/json" } })
    const parsed = JSON.parse(text) as unknown
    const records = Array.isArray(parsed) ? parsed.map(asRecord) : []
    const rows: SocrataRecord[] = []
    for (const record of records) {
        const legalName = asString(record.legal_name)
        const dbaName = asString(record.dba_name)
        const dotNumber = asString(record.dot_number)
        const preliminaryRow = {
            business_name: dbaName ?? legalName,
            legal_name: legalName,
            dba_name: dbaName,
            dot_number: dotNumber,
            street: asString(record.phy_street),
            city: asString(record.phy_city),
            state: asString(record.phy_state),
            postcode: asString(record.phy_zip),
            county: asString(record.phy_cnty),
            status: fmcsaCensusStatus(asString(record.status_code)),
        }
        if (!officialRecordMatchesCandidate(preliminaryRow, company, metadata)) continue
        const phone = normalisePhone(asString(record.phone)) ?? normalisePhone(asString(record.cell_phone))
        const officers = [asString(record.company_officer_1), asString(record.company_officer_2)]
            .filter((officer): officer is string => Boolean(officer && looksLikePersonName(officer)))
        const sourceUrl = dotNumber
            ? `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${encodeURIComponent(dotNumber)}`
            : `https://${domain}/d/${datasetId}`
        if (officers.length === 0) {
            rows.push({
                ...preliminaryRow,
                phone,
                email: asString(record.email_address),
                carrier_operation: asString(record.carrier_operation),
                record_id: dotNumber,
                record_type: "FMCSA Company Census carrier record",
                source_url: sourceUrl,
            })
            continue
        }
        for (const officerName of officers) {
            rows.push({
                ...preliminaryRow,
                owner_name: officerName,
                officer_name: officerName,
                officer_title: "Company Officer",
                phone,
                email: asString(record.email_address),
                carrier_operation: asString(record.carrier_operation),
                record_id: dotNumber ? `${dotNumber}:${officerName}` : `${legalName ?? dbaName}:${officerName}`,
                record_type: "FMCSA Company Census officer",
                source_url: sourceUrl,
            })
        }
    }
    return rows
}

async function fetchOshaRows(searchTerm: string, company: CompanyCandidate) {
    const params = new URLSearchParams({
        p_logger: "1",
        establishment: searchTerm,
        State: candidateState(company) ?? "all",
        officetype: "all",
        Office: "all",
        sitezip: "",
        startmonth: "01",
        startday: "01",
        startyear: "2021",
        endmonth: "12",
        endday: "31",
        endyear: String(new Date().getUTCFullYear()),
    })
    const sourceUrl = `https://www.osha.gov/ords/imis/establishment.search?${params.toString()}`
    const html = await fetchTextWithTimeout(sourceUrl)
    const resultCount = Number(html.match(/Results\s+\d+\s+-\s+\d+\s+of\s+(\d+)/i)?.[1] ?? 0)
    if (!Number.isFinite(resultCount) || resultCount <= 0) return []
    const inspectionIds = [...html.matchAll(/establishment\.inspection_detail\?id=([0-9.]+)/gi)].map((match) => match[1]).slice(0, 5)
    return [{
        establishment_name: company.display_name,
        inspection_count: String(resultCount),
        inspection_ids: inspectionIds.join(", "),
        state: candidateState(company),
        source_url: sourceUrl,
        status: `${resultCount} OSHA inspection result${resultCount === 1 ? "" : "s"}`,
    }]
}

async function fetchEpaEchoRows(searchTerm: string, company: CompanyCandidate) {
    const params = new URLSearchParams({
        output: "JSON",
        p_fn: searchTerm,
        p_pageno: "1",
        p_pagesize: "10",
    })
    const state = candidateState(company)
    if (state) params.set("p_st", state)
    const text = await fetchTextWithTimeout(`https://echodata.epa.gov/echo/cwa_rest_services.get_facility_info?${params.toString()}`, { headers: { Accept: "application/json" } })
    const parsed = JSON.parse(text) as { Results?: { Facilities?: Array<Record<string, unknown>> } }
    return (parsed.Results?.Facilities ?? []).map((facility) => ({
        facility_name: asString(facility.CWPName),
        source_id: asString(facility.SourceID),
        permit_number: asString(facility.MasterExternalPermitNmbr) ?? asString(facility.SourceID),
        street: asString(facility.CWPStreet),
        city: asString(facility.CWPCity),
        state: asString(facility.CWPState),
        postcode: asString(facility.CWPZip),
        county: asString(facility.CWPCounty),
        statute: asString(facility.Statute),
        status: asString(facility.CWPStatus) ?? asString(facility.EPASystem),
        latitude: asString(facility.FacLat),
        longitude: asString(facility.FacLong),
        source_url: facility.SourceID ? `https://echo.epa.gov/detailed-facility-report?fid=${encodeURIComponent(String(facility.SourceID))}` : "https://echo.epa.gov/",
    }))
}

async function fetchNppesRows(searchTerm: string, company: CompanyCandidate) {
    const params = new URLSearchParams({
        version: "2.1",
        organization_name: searchTerm,
        limit: "10",
    })
    const state = candidateState(company)
    if (state) params.set("state", state)
    const text = await fetchTextWithTimeout(`https://npiregistry.cms.hhs.gov/api/?${params.toString()}`, { headers: { Accept: "application/json" } })
    const parsed = JSON.parse(text) as { results?: Array<Record<string, unknown>> }
    return (parsed.results ?? []).map((result) => {
        const basic = asRecord(result.basic)
        const addresses = Array.isArray(result.addresses) ? result.addresses.map(asRecord) : []
        const location = addresses.find((address) => asString(address.address_purpose) === "LOCATION") ?? addresses[0] ?? {}
        const officialName = [
            asString(basic.authorized_official_first_name),
            asString(basic.authorized_official_last_name),
        ].filter(Boolean).join(" ")
        const taxonomies = Array.isArray(result.taxonomies) ? result.taxonomies.map(asRecord).map((taxonomy) => asString(taxonomy.desc)).filter(Boolean).join(", ") : null
        return {
            organization_name: asString(basic.organization_name),
            authorized_official_name: officialName || null,
            authorized_official_phone: asString(basic.authorized_official_telephone_number),
            authorized_official_title: asString(basic.authorized_official_title_or_position),
            npi: asString(result.number),
            status: asString(basic.status),
            taxonomy: taxonomies,
            street: [asString(location.address_1), asString(location.address_2)].filter(Boolean).join(" ") || null,
            city: asString(location.city),
            state: asString(location.state),
            postcode: asString(location.postal_code),
            phone: asString(location.telephone_number) ?? asString(basic.authorized_official_telephone_number),
            source_url: result.number ? `https://npiregistry.cms.hhs.gov/provider-view/${encodeURIComponent(String(result.number))}` : "https://npiregistry.cms.hhs.gov/",
        }
    })
}

async function fetchUsaspendingRows(searchTerm: string) {
    const payload = {
        filters: {
            keywords: [searchTerm],
            award_type_codes: ["A", "B", "C", "D"],
        },
        fields: ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency", "Start Date", "End Date", "NAICS Code", "NAICS Description"],
        page: 1,
        limit: 10,
        sort: "Start Date",
        order: "desc",
        subawards: false,
    }
    const text = await fetchTextWithTimeout("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    })
    const parsed = JSON.parse(text) as { results?: Array<Record<string, unknown>> }
    return (parsed.results ?? []).map((award) => ({
        recipient_name: asString(award["Recipient Name"]),
        award_id: asString(award["Award ID"]),
        award_amount: asString(award["Award Amount"]),
        awarding_agency: asString(award["Awarding Agency"]),
        start_date: asString(award["Start Date"]),
        end_date: asString(award["End Date"]),
        naics_code: asString(award["NAICS Code"]),
        naics_description: asString(award["NAICS Description"]),
        source_url: award.generated_internal_id ? `https://www.usaspending.gov/award/${encodeURIComponent(String(award.generated_internal_id))}` : "https://www.usaspending.gov/search",
    }))
}

function texasComptrollerRowsFromDetail(detail: Record<string, unknown>, sourceUrl: string) {
    const taxpayerId = asString(detail.taxpayerId)
    const base = {
        name: asString(detail.name),
        dba_name: asString(detail.dbaName),
        taxpayer_id: taxpayerId,
        fei_number: asString(detail.feiNumber),
        sos_file_number: asString(detail.sosFileNumber),
        sos_registration_status: asString(detail.sosRegistrationStatus),
        right_to_transact_tx: asString(detail.rightToTransactTX),
        effective_sos_registration_date: asString(detail.effectiveSosRegistrationDate),
        report_year: asString(detail.reportYear),
        mailing_address_street: asString(detail.mailingAddressStreet),
        mailing_address_city: asString(detail.mailingAddressCity),
        mailing_address_state: asString(detail.mailingAddressState),
        mailing_address_zip: asString(detail.mailingAddressZip),
        source_url: sourceUrl,
    }
    const rows: SocrataRecord[] = []
    const seenPeople = new Set<string>()
    const registeredAgentName = asString(detail.registeredAgentName)
    if (registeredAgentName && !/^not on file$/i.test(registeredAgentName)) {
        seenPeople.add(`registered agent:${registeredAgentName.toLowerCase()}`)
        rows.push({
            ...base,
            registered_agent_name: registeredAgentName,
            officer_name: registeredAgentName,
            officer_title: "Registered Agent",
            record_id: taxpayerId ? `${taxpayerId}:registered-agent` : `registered-agent:${registeredAgentName}`,
            record_type: "Texas franchise tax registered agent",
            registered_office_address_street: asString(detail.registeredOfficeAddressStreet),
            registered_office_address_city: asString(detail.registeredOfficeAddressCity),
            registered_office_address_state: asString(detail.registeredOfficeAddressState),
            registered_office_address_zip: asString(detail.registeredOfficeAddressZip),
        })
    }
    const officerRows = Array.isArray(detail.officerInfo) ? detail.officerInfo.map(asRecord) : []
    for (const officer of officerRows) {
        const officerName = asString(officer.AGNT_NM)
        const officerTitle = asString(officer.AGNT_TITL_TX) ?? "Officer"
        if (!officerName) continue
        const key = `${officerTitle}:${officerName}`.toLowerCase()
        if (seenPeople.has(key)) continue
        seenPeople.add(key)
        rows.push({
            ...base,
            officer_name: officerName,
            officer_title: officerTitle,
            record_id: taxpayerId ? `${taxpayerId}:${officerTitle}:${officerName}` : `${officerTitle}:${officerName}`,
            record_type: "Texas franchise tax Public Information Report officer",
            officer_active_year: asString(officer.AGNT_ACTV_YR),
            officer_source: asString(officer.SOURCE),
            officer_address_street: asString(officer.AD_STR_POB_TX),
            officer_address_city: asString(officer.CITY_NM),
            officer_address_state: asString(officer.ST_CD),
            officer_address_zip: asString(officer.AD_ZP),
        })
    }
    if (rows.length === 0 && base.name) rows.push({ ...base, record_id: taxpayerId, record_type: "Texas franchise tax account status" })
    return rows
}

async function fetchTexasComptrollerRows(searchTerm: string, metadata: Record<string, unknown>) {
    if (!searchTerm) return []
    const limit = Math.min(8, Math.max(1, Number(metadata.query_limit) || 5))
    const searchParams = new URLSearchParams({ name: searchTerm })
    const searchUrl = `https://comptroller.texas.gov/data-search/franchise-tax?${searchParams.toString()}`
    const searchText = await fetchTextWithTimeout(searchUrl, { headers: { Accept: "application/json" } })
    const parsed = JSON.parse(searchText) as { data?: unknown }
    const summaries = Array.isArray(parsed.data) ? parsed.data.map(asRecord).slice(0, limit) : []
    const rows: SocrataRecord[] = []
    for (const summary of summaries) {
        const taxpayerId = asString(summary.taxpayerId)
        if (!taxpayerId) continue
        const detailApiUrl = `https://comptroller.texas.gov/data-search/franchise-tax/${encodeURIComponent(taxpayerId)}`
        const detailText = await fetchTextWithTimeout(detailApiUrl, { headers: { Accept: "application/json" } })
        const detailParsed = JSON.parse(detailText) as { data?: unknown }
        const detail = asRecord(detailParsed.data)
        const sourceUrl = `https://comptroller.texas.gov/taxes/franchise/account-status/search/${encodeURIComponent(taxpayerId)}`
        rows.push(...texasComptrollerRowsFromDetail(detail, sourceUrl))
        await sleep(120)
    }
    return rows
}

async function fetchTexasAgriculturePestRows(searchTerm: string, metadata: Record<string, unknown>, company: CompanyCandidate) {
    const urls = asStringArray(metadata.source_urls)
    const sourceUrls = urls.length ? urls : [
        "https://texasagriculture.gov/Portals/0/Reports/PIR/spcs_commercial_business.csv",
        "https://texasagriculture.gov/Portals/0/Reports/PIR/spcs_noncommercial_business.csv",
    ]
    const limit = Math.min(30, Math.max(1, Number(metadata.query_limit) || 15))
    const rows: SocrataRecord[] = []
    const state = candidateState(company)
    const county = asString(company.address?.county)
    for (const sourceUrl of sourceUrls) {
        const csv = await fetchCachedCsv(sourceUrl)
        for (const row of csvRowsWithHeaders(csv)) {
            const legalName = asString(row.LEGAL_BUSINESS_NAME)
            const dbaName = asString(row.DBA)
            const preliminaryRow = {
                ...row,
                business_name: dbaName ?? legalName ?? asString(row.BUSINESS_NAME),
                legal_business_name: legalName,
                dba_name: dbaName,
                state: "TX",
            }
            if (!officialRecordMatchesCandidate(preliminaryRow, company, metadata)) continue
            if (state && state !== "TX") continue
            if (county && asString(row.COUNTY) && sharedTokenScore(county, asString(row.COUNTY)) < 0.6 && !strongBusinessNameMatch(company.display_name, legalName, dbaName)) continue
            const responsibleApplicator = asString(row.RESPONSIBLE_APPLICATOR)
            const operator = asString(row.OPERATOR)
            rows.push({
                ...preliminaryRow,
                business_name: dbaName ?? legalName,
                legal_business_name: legalName,
                owner_name: looksLikePersonName(responsibleApplicator) ? responsibleApplicator : looksLikePersonName(operator) ? operator : null,
                applicator_name: responsibleApplicator,
                operator_name: operator,
                license_number: asString(row.TPCL) ?? asString(row.ACCOUNT),
                status: asString(row.LICENSE_EXPIRED) ? `Expires ${asString(row.LICENSE_EXPIRED)}` : null,
                record_type: asString(row.ACCOUNT_TYPE) ?? "Texas structural pest business license",
                county: asString(row.COUNTY),
                state: "TX",
                source_url: "https://texasagriculture.gov/Regulatory-Programs/Pesticides/Structural-Pest-Control-Service/Structural-Pest-Control-Reports-Current-Licenses",
            })
            if (rows.length >= limit) return rows
        }
    }
    return rows
}

function labelledHtmlValue(html: string, label: string) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const patterns = [
        new RegExp(`<(?:span|label|div)[^>]*>\\s*${escaped}\\s*:?[\\s\\S]*?<\\/[^>]+>\\s*([^<\\n][\\s\\S]*?)(?=<\\/p>|<p|<div|<span|<label|<br|$)`, "i"),
        new RegExp(`${escaped}\\s*:?\\s*(?:<br\\s*\\/?>)?\\s*([^<\\n][\\s\\S]*?)(?=<\\/p>|<p|<div|<span|<label|<br|$)`, "i"),
    ]
    for (const pattern of patterns) {
        const value = stripHtml(html.match(pattern)?.[1] ?? "")
        if (value && !new RegExp(`^${escaped}$`, "i").test(value)) return value
    }
    return null
}

function tableRows(html: string) {
    return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map((rowMatch) => [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)].map((cell) => stripHtml(cell[1])))
        .filter((cells) => cells.length > 0)
}

async function fetchTceqRows(searchTerm: string, metadata: Record<string, unknown>, company: CompanyCandidate) {
    const limit = Math.min(8, Math.max(1, Number(metadata.query_limit) || 5))
    const body = new URLSearchParams({
        fuseaction: "regent.validateRE",
        re_name_txt: searchTerm,
        pgm_area: asString(metadata.program_area) ?? "",
        addn_id_status_cd: "",
        city_name: candidateCity(company) ?? "",
        zip_cd: candidatePostcode(company)?.slice(0, 5) ?? "",
        cnty_name: asString(company.address?.county) ?? "",
    })
    const searchHtml = await fetchTextWithTimeout("https://www15.tceq.texas.gov/crpub/index.cfm", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: "https://www15.tceq.texas.gov/crpub/index.cfm?fuseaction=regent.RNSearch",
        },
        body,
    })
    assertNotChallenge("Texas TCEQ Central Registry", searchHtml)
    const links = [...searchHtml.matchAll(/href="([^"]*showSingleRN[^"]+)/gi)]
        .map((match) => match[1].replace(/&amp;/g, "&"))
        .slice(0, limit)
    const rows: SocrataRecord[] = []
    for (const link of links) {
        const sourceUrl = new URL(link, "https://www15.tceq.texas.gov/crpub/").toString()
        const detailHtml = await fetchTextWithTimeout(sourceUrl)
        const regulatedName = labelledHtmlValue(detailHtml, "Name")
        if (!regulatedName) continue
        const rnNumber = detailHtml.match(/RN\s*&nbsp;Number:[\s\S]*?(RN\d+)/i)?.[1] ?? detailHtml.match(/\b(RN\d{9})\b/i)?.[1] ?? null
        const primaryBusiness = labelledHtmlValue(detailHtml, "Primary Business")
        const county = labelledHtmlValue(detailHtml, "County")
        const city = labelledHtmlValue(detailHtml, "Nearest City")
        const zip = labelledHtmlValue(detailHtml, "Near ZIP Code")
        const physicalLocation = labelledHtmlValue(detailHtml, "Physical Location")
        const customerRows = tableRows(detailHtml).filter((cells) => cells.some((cell) => /^CN\d+/i.test(cell)))
        if (customerRows.length === 0) {
            const resultRow = {
                regulated_entity_name: regulatedName,
                business_name: regulatedName,
                rn_number: rnNumber,
                record_id: rnNumber,
                status: primaryBusiness,
                record_type: "TCEQ regulated entity",
                street: physicalLocation,
                city,
                county,
                state: "TX",
                postcode: zip,
                source_url: sourceUrl,
            }
            if (officialRecordMatchesCandidate(resultRow, company, metadata)) rows.push(resultRow)
        }
        for (const cells of customerRows.slice(0, 3)) {
            const cnNumber = cells.find((cell) => /^CN\d+/i.test(cell)) ?? null
            const customerName = cells.find((cell) => cell !== cnNumber && !/OWNER|OPERATOR|CUSTOMER|Details/i.test(cell)) ?? null
            const role = cells.find((cell) => /OWNER|OPERATOR|RESPONSIBLE|CUSTOMER/i.test(cell)) ?? "Affiliated customer"
            const resultRow = {
                regulated_entity_name: regulatedName,
                business_name: regulatedName,
                owner_name: looksLikePersonName(customerName) ? customerName : null,
                affiliated_customer_name: customerName,
                customer_role: role,
                rn_number: rnNumber,
                cn_number: cnNumber,
                record_id: cnNumber ?? rnNumber,
                status: primaryBusiness,
                record_type: role,
                street: physicalLocation,
                city,
                county,
                state: "TX",
                postcode: zip,
                source_url: sourceUrl,
                additional_match_name: customerName,
            }
            if (officialRecordMatchesCandidate(resultRow, company, metadata)) rows.push(resultRow)
        }
        await sleep(160)
    }
    return rows
}

function htmlFormValue(html: string, name: string) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return decodeHtml(html.match(new RegExp(`name="${escaped}"[^>]*value="([^"]*)"`, "i"))?.[1] ?? "")
}

function responseCookies(response: Response) {
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
    const cookies = getSetCookie?.() ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie") as string] : [])
    return cookies.map((cookie) => cookie.split(";")[0]).filter(Boolean).join("; ")
}

function cslbRowsFromSearch(html: string) {
    return html
        .split(/<tr>\s*<td(?:\s|>)/i)
        .slice(1)
        .map((chunk) => `<td${chunk}`)
        .map((rowHtml) => {
            const licenseNumber = rowHtml.match(/LicenseDetail\.aspx\?LicNum=(\d+)/i)?.[1] ?? null
            const fields: Record<string, string> = {}
            for (const fieldMatch of rowHtml.matchAll(/<span[^>]*lbl(?:CName|NameType|License|txtCity|Status)_\d+[^>]*>([\s\S]*?)<\/span>\s*<\/td>\s*<td>\s*(?:<a[^>]*>)?<span[^>]*>([\s\S]*?)<\/span>|<span[^>]*lbl(CName|Type|City|LicenseStatus)_\d+[^>]*>([\s\S]*?)<\/span>/gi)) {
                const label = stripHtml(fieldMatch[1] ?? fieldMatch[3] ?? "")
                const value = stripHtml(fieldMatch[2] ?? fieldMatch[4] ?? "")
                if (label && value) fields[label.toLowerCase()] = value
            }
            const businessName = fields["contractor name"] ?? stripHtml(rowHtml.match(/lblName_\d+[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "")
            const city = fields.city ?? stripHtml(rowHtml.match(/lblCity_\d+[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "")
            const status = fields.status ?? stripHtml(rowHtml.match(/lblLicenseStatus_\d+[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "")
            return licenseNumber && businessName ? { licenseNumber, businessName, city, status, rowHtml } : null
        })
        .filter((row): row is { licenseNumber: string; businessName: string; city: string; status: string; rowHtml: string } => Boolean(row))
}

function cslbBusinessInfo(detailHtml: string) {
    const block = detailHtml.match(/id="MainContent_BusInfo"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? ""
    const lines = block.split(/<br\s*\/?>/i).map(stripHtml).filter(Boolean)
    const phone = normalisePhone(block.match(/Business Phone Number:\s*([^<]+)/i)?.[1])
    const businessName = lines[0] ?? null
    const street = lines[1] ?? null
    const cityStateZip = lines.find((line) => /,\s*[A-Z]{2}\s+\d{5}/.test(line)) ?? null
    const cityStateZipMatch = cityStateZip?.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/)
    const qualifier = detailHtml.match(/qualifying individual\s+([A-Z][A-Z .'-]+?)\s+certified/i)?.[1] ?? null
    return {
        businessName,
        phone,
        street,
        city: cityStateZipMatch?.[1] ?? null,
        state: cityStateZipMatch?.[2] ?? "CA",
        postcode: cityStateZipMatch?.[3] ?? null,
        ownerName: looksLikePersonName(qualifier) ? cleanText(qualifier) : null,
        entity: stripHtml(detailHtml.match(/id="MainContent_Entity"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "") || null,
        issueDate: stripHtml(detailHtml.match(/id="MainContent_IssDt"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "") || null,
        expireDate: stripHtml(detailHtml.match(/id="MainContent_ExpDt"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "") || null,
        status: stripHtml(detailHtml.match(/id="MainContent_Status"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "") || null,
        classifications: stripHtml(detailHtml.match(/id="MainContent_ClassCellTable"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "") || null,
    }
}

async function fetchCslbRows(searchTerm: string, metadata: Record<string, unknown>, company: CompanyCandidate) {
    const firstResponse = await fetch("https://www.cslb.ca.gov/onlineservices/checklicenseII/checklicense.aspx", {
        headers: { "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)" },
        cache: "no-store",
    })
    const firstHtml = await firstResponse.text()
    if (!firstResponse.ok) throw new Error(`CSLB search form returned HTTP ${firstResponse.status}: ${stripHtml(firstHtml).slice(0, 280)}`)
    const firstCookie = responseCookies(firstResponse)
    const body = new URLSearchParams({
        __VIEWSTATE: htmlFormValue(firstHtml, "__VIEWSTATE"),
        __VIEWSTATEGENERATOR: htmlFormValue(firstHtml, "__VIEWSTATEGENERATOR"),
        __EVENTVALIDATION: htmlFormValue(firstHtml, "__EVENTVALIDATION"),
        "ctl00$MainContent$LicNo": "",
        "ctl00$MainContent$NextName": searchTerm,
        "ctl00$MainContent$LName": "",
        "ctl00$MainContent$FName": "",
        "ctl00$MainContent$HIS_LicNo": "",
        "ctl00$MainContent$LicLmfPre": "SP",
        "ctl00$MainContent$HIS_LName": "",
        "ctl00$MainContent$HIS_FName": "",
        "ctl00$MainContent$Contractor_Business_Name_Button": " ",
    })
    const searchResponse = await fetch("https://www.cslb.ca.gov/onlineservices/checklicenseII/checklicense.aspx", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)",
            Referer: "https://www.cslb.ca.gov/onlineservices/checklicenseII/checklicense.aspx",
            ...(firstCookie ? { Cookie: firstCookie } : {}),
        },
        body,
        cache: "no-store",
    })
    const searchHtml = await searchResponse.text()
    if (!searchResponse.ok) throw new Error(`CSLB search returned HTTP ${searchResponse.status}: ${stripHtml(searchHtml).slice(0, 280)}`)
    assertNotChallenge("California CSLB", searchHtml)
    const cookie = [firstCookie, responseCookies(searchResponse)].filter(Boolean).join("; ")
    const rows: SocrataRecord[] = []
    const limit = Math.min(8, Math.max(1, Number(metadata.query_limit) || 5))
    for (const result of cslbRowsFromSearch(searchHtml).slice(0, limit)) {
        const preliminaryRow = {
            business_name: result.businessName,
            contractor_name: result.businessName,
            license_number: result.licenseNumber,
            city: result.city,
            state: "CA",
            status: result.status,
        }
        const preliminaryAssessment = assessOfficialRecordMatch(preliminaryRow, company, metadata)
        if (!preliminaryAssessment.matched && Number(preliminaryAssessment.signals.name_score) < 0.28 && Number(preliminaryAssessment.signals.address_score) < 0.34) continue
        const sourceUrl = `https://www.cslb.ca.gov/OnlineServices/checklicenseII/LicenseDetail.aspx?LicNum=${encodeURIComponent(result.licenseNumber)}`
        let detail = cslbBusinessInfo("")
        try {
            const detailHtml = await fetchTextWithTimeout(sourceUrl, {
                headers: {
                    Referer: "https://www.cslb.ca.gov/onlineservices/checklicenseII/checklicense.aspx",
                    ...(cookie ? { Cookie: cookie } : {}),
                },
            })
            detail = cslbBusinessInfo(detailHtml)
        } catch {
            detail = cslbBusinessInfo("")
        }
        rows.push({
            business_name: detail.businessName ?? result.businessName,
            contractor_name: result.businessName,
            owner_name: detail.ownerName,
            phone: detail.phone,
            license_number: result.licenseNumber,
            status: detail.status ?? result.status,
            record_type: detail.classifications ?? "CSLB contractor license",
            street: detail.street,
            city: detail.city ?? result.city,
            state: detail.state ?? "CA",
            postcode: detail.postcode,
            entity: detail.entity,
            issue_date: detail.issueDate,
            expiration_date: detail.expireDate,
            source_url: sourceUrl,
        })
        await sleep(200)
    }
    return rows
}

function arcgisWhere(searchTerm: string, fields: string[]) {
    const escaped = searchTerm.toUpperCase().replace(/'/g, "''")
    return fields.map((field) => `UPPER(${field}) LIKE '%${escaped}%'`).join(" OR ")
}

async function fetchArcgisRows(metadata: Record<string, unknown>, searchTerm: string) {
    const serviceUrl = asString(metadata.service_url)
    if (!serviceUrl) throw new Error("ArcGIS source is missing service_url metadata.")
    const fields = asStringArray(metadata.search_fields)
    if (fields.length === 0) throw new Error("ArcGIS source is missing search_fields metadata.")
    const limit = Math.min(50, Math.max(1, Number(metadata.query_limit) || 15))
    const params = new URLSearchParams({
        f: "json",
        where: arcgisWhere(searchTerm, fields),
        outFields: "*",
        resultRecordCount: String(limit),
    })
    const text = await fetchTextWithTimeout(`${serviceUrl.replace(/\/$/, "")}/query?${params.toString()}`, { headers: { Accept: "application/json" } })
    const parsed = JSON.parse(text) as { features?: Array<{ attributes?: SocrataRecord; geometry?: { x?: number; y?: number } }>; error?: { message?: string; details?: string[] } }
    if (parsed.error) throw new Error(`ArcGIS query failed: ${parsed.error.message ?? "unknown error"} ${(parsed.error.details ?? []).join(" ")}`.trim())
    return (parsed.features ?? []).map((feature) => ({
        ...(feature.attributes ?? {}),
        longitude: feature.attributes?.Longitude ?? feature.attributes?.longitude ?? feature.geometry?.x,
        latitude: feature.attributes?.Latitude ?? feature.attributes?.latitude ?? feature.geometry?.y,
    }))
}

async function fetchPhoenixPermitRows(searchTerm: string, metadata: Record<string, unknown>, company: CompanyCandidate) {
    const permitType = asString(metadata.permit_type) ?? "PERS"
    const structureClass = asString(metadata.structure_class) ?? ""
    const end = new Date()
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - 365)
    const url = `https://apps-secure.phoenix.gov/PDD/Search/IssuedPermit/ExportToCSV?${new URLSearchParams({
        PermitType: permitType,
        StructureClass: structureClass,
        StartDate: usDate(start),
        EndDate: usDate(end),
        SortBy: "PER_ISSUE_DATE",
    }).toString()}`
    const csv = await fetchCachedCsv(url)
    return csvRowsWithHeaders(csv)
        .map((row) => ({
            ...row,
            business_name: asString(row.Contractor),
            contractor_name: asString(row.Contractor),
            phone: asString(row["Cont Phone"]),
            property_owner_name: asString(row.Owner),
            permit_number: asString(row.Number),
            status: asString(row.Status),
            record_type: [asString(row.Type), asString(row["Struct Class"]), asString(row.Use)].filter(Boolean).join(" / ") || "Phoenix issued permit",
            street: asString(row.Address),
            city: "Phoenix",
            state: "AZ",
            source_url: "https://apps-secure.phoenix.gov/PDD/Search/IssuedPermit",
            additional_match_name: asString(row.Contractor),
        }))
        .filter((row) => officialRecordMatchesCandidate(row, company, metadata))
        .slice(0, Math.min(20, Math.max(1, Number(metadata.query_limit) || 10)))
}

async function fetchDcaRows(searchTerm: string, metadata: Record<string, unknown>) {
    const appId = process.env.DCA_SEARCH_APP_ID
    const appKey = process.env.DCA_SEARCH_APP_KEY
    if (!appId || !appKey) throw new Error("California DCA Search API requires DCA_SEARCH_APP_ID and DCA_SEARCH_APP_KEY.")
    const clientCodeId = asStringArray(metadata.dca_client_code_ids).map(Number).filter(Number.isFinite)
    if (clientCodeId.length === 0) throw new Error("DCA source is missing dca_client_code_ids metadata.")
    const payload = {
        searchMethod: "SNDX",
        name: searchTerm,
        clientCodeId,
    }
    const text = await fetchTextWithTimeout("https://iservices.dca.ca.gov/api/search/v1/licenseSearchService/getPublicLicenseSearch", {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            APP_ID: appId,
            APP_KEY: appKey,
        },
        body: JSON.stringify(payload),
    })
    const parsed = JSON.parse(text) as { results?: Array<Record<string, unknown>> }
    return (parsed.results ?? []).map((result) => ({
        business_name: asString(result.name),
        owner_name: looksLikePersonName(asString(result.name)) ? asString(result.name) : null,
        license_number: asString(result.licenseNumber),
        board_code: asString(result.boardCode),
        license_type: asString(result.licenseType),
        license_rank: asString(result.licenseTypeRank),
        city: asString(result.city),
        county: asString(result.county),
        state: asString(result.state) ?? "CA",
        postcode: asString(result.zip),
        status: asString(result.primaryStatusCode),
        record_type: asString(result.licenseType),
        source_url: result.licenseNumber ? `https://search.dca.ca.gov/details/${encodeURIComponent(String(result.boardCode ?? ""))}/${encodeURIComponent(String(result.licenseNumber))}` : "https://search.dca.ca.gov/",
    }))
}

async function fetchGuardedHtmlRows(source: SourceCatalog, searchTerm: string, metadata: Record<string, unknown>, company: CompanyCandidate) {
    const searchUrlTemplate = asString(metadata.search_url)
    const label = source.label
    const unsafeReason = publicRecordPollUnsafeReason(source.source_key, label, metadata)
    if (unsafeReason) throw new Error(unsafeReason)
    if (!searchUrlTemplate) throw new Error(`${label} is missing search_url metadata.`)
    const searchUrl = searchUrlTemplate.replace("{query}", encodeURIComponent(searchTerm))
    const html = await fetchTextWithTimeout(searchUrl)
    assertNotChallenge(label, html)
    const rows = tableRows(html)
    const mappedRows = rows.slice(0, Math.min(20, Math.max(1, Number(metadata.query_limit) || 10))).flatMap((cells) => {
        const joined = cells.join(" ")
        const phoneCell = cells.find((cell) => Boolean(normalisePhone(cell)))
        const mappedRow = {
            business_name: cells.find((cell) => strongBusinessNameMatch(searchTerm, cell)) ?? joined,
            owner_name: cells.find((cell) => looksLikePersonName(cell)) ?? null,
            phone: normalisePhone(phoneCell),
            record_id: cells.find((cell) => /[A-Z0-9-]{5,}/i.test(cell)) ?? hashRecord(cells),
            status: cells.find((cell) => /active|current|registered|open/i.test(cell)) ?? null,
            record_type: asString(metadata.default_record_type) ?? label,
            source_url: searchUrl,
            raw_cells: cells,
        }
        return officialRecordMatchesCandidate(mappedRow, company, metadata) ? [mappedRow] : []
    })
    return mappedRows
}

function rdapUrlForDomain(domain: string) {
    const lower = domain.toLowerCase()
    if (lower.endsWith(".com")) return `https://rdap.verisign.com/com/v1/domain/${encodeURIComponent(lower.toUpperCase())}`
    if (lower.endsWith(".net")) return `https://rdap.verisign.com/net/v1/domain/${encodeURIComponent(lower.toUpperCase())}`
    return null
}

function rdapRegistrar(payload: Record<string, unknown>) {
    const entities = Array.isArray(payload.entities) ? payload.entities.map(asRecord) : []
    const registrar = entities.find((entity) => Array.isArray(entity.roles) && entity.roles.map(String).includes("registrar"))
    const vcard = Array.isArray(registrar?.vcardArray) ? registrar.vcardArray : []
    const entries = Array.isArray(vcard[1]) ? vcard[1] as unknown[] : []
    for (const entry of entries) {
        if (!Array.isArray(entry) || entry[0] !== "fn") continue
        const name = asString(entry[3])
        if (name) return name
    }
    return asString(registrar?.handle)
}

async function fetchRdapRows(company: CompanyCandidate) {
    const domain = candidateDomain(company)
    if (!domain) return []
    const sourceUrl = rdapUrlForDomain(domain)
    if (!sourceUrl) return []
    const text = await fetchTextWithTimeout(sourceUrl, { headers: { Accept: "application/rdap+json,application/json" } })
    const payload = JSON.parse(text) as Record<string, unknown>
    const events = Array.isArray(payload.events) ? payload.events.map(asRecord) : []
    const registrationEvent = events.find((event) => asString(event.eventAction) === "registration")
    const expirationEvent = events.find((event) => asString(event.eventAction) === "expiration")
    return [{
        candidate_display_name: company.display_name,
        domain,
        rdap_handle: asString(payload.handle),
        registrar: rdapRegistrar(payload),
        status: Array.isArray(payload.status) ? payload.status.map(String).join(", ") : null,
        registered_at: asString(registrationEvent?.eventDate),
        expires_at: asString(expirationEvent?.eventDate),
        source_url: sourceUrl,
    }]
}

async function fetchCertificateTransparencyRows(company: CompanyCandidate) {
    const domain = candidateDomain(company)
    if (!domain) return []
    const sourceUrl = `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`
    const text = await fetchTextWithTimeout(sourceUrl, { headers: { Accept: "application/json" } })
    const parsed = JSON.parse(text) as Array<Record<string, unknown>>
    const seen = new Set<string>()
    return parsed.slice(0, 30).flatMap((certificate) => {
        const commonName = asString(certificate.common_name) ?? domain
        const id = asString(certificate.id) ?? asString(certificate.serial_number) ?? commonName
        if (seen.has(id)) return []
        seen.add(id)
        return [{
            candidate_display_name: company.display_name,
            domain,
            common_name: commonName,
            certificate_id: id,
            issuer_name: asString(certificate.issuer_name),
            not_before: asString(certificate.not_before),
            not_after: asString(certificate.not_after),
            entry_timestamp: asString(certificate.entry_timestamp),
            source_url: `https://crt.sh/?id=${encodeURIComponent(id)}`,
        }]
    }).slice(0, 5)
}

async function fetchRowsForSource(source: SourceCatalog, searchTerm: string, company: CompanyCandidate) {
    const adapter = asString(source.metadata?.adapter) ?? "socrata_public_records"
    const unsafeReason = publicRecordPollUnsafeReason(source.source_key, source.label, source.metadata)
    if (unsafeReason) throw new Error(unsafeReason)
    if (adapter === "fmcsa_safer_snapshot") return fetchFmcsaRows(searchTerm)
    if (adapter === "osha_establishment_search") return fetchOshaRows(searchTerm, company)
    if (adapter === "epa_echo_cwa_facility_info") return fetchEpaEchoRows(searchTerm, company)
    if (adapter === "nppes_registry") return fetchNppesRows(searchTerm, company)
    if (adapter === "usaspending_awards") return fetchUsaspendingRows(searchTerm)
    if (adapter === "texas_comptroller_franchise_tax") return fetchTexasComptrollerRows(searchTerm, source.metadata ?? {})
    if (adapter === "sunbiz_owner_index") return fetchSunbizOwnerIndexRows(source, searchTerm)
    if (adapter === "sunbiz_shard_lookup") return fetchSunbizShardLookupRows(source, searchTerm)
    if (adapter === "fmcsa_company_census") return fetchFmcsaCensusRows(searchTerm, source.metadata ?? {}, company)
    if (adapter === "texas_agriculture_spcs_csv") return fetchTexasAgriculturePestRows(searchTerm, source.metadata ?? {}, company)
    if (adapter === "tceq_central_registry") return fetchTceqRows(searchTerm, source.metadata ?? {}, company)
    if (adapter === "cslb_license_search") return fetchCslbRows(searchTerm, source.metadata ?? {}, company)
    if (adapter === "arcgis_feature_service") return fetchArcgisRows(source.metadata ?? {}, searchTerm)
    if (adapter === "phoenix_issued_permit_csv") return fetchPhoenixPermitRows(searchTerm, source.metadata ?? {}, company)
    if (adapter === "dca_search_api") return fetchDcaRows(searchTerm, source.metadata ?? {})
    if (adapter === "guarded_html_search") return fetchGuardedHtmlRows(source, searchTerm, source.metadata ?? {}, company)
    if (adapter === "rdap_domain") return fetchRdapRows(company)
    if (adapter === "certificate_transparency") return fetchCertificateTransparencyRows(company)
    return fetchSocrataRows(source.metadata ?? {}, searchTerm)
}

function rowToMatch(row: SocrataRecord, candidate: CompanyCandidate, metadata: Record<string, unknown>): MatchResult | null {
    const fieldMap = asRecord(metadata.field_map)
    const businessName = pickString(row, asStringArray(fieldMap.business_name))
    const contractorName = pickString(row, asStringArray(fieldMap.contractor_name))
    const personCandidates = publicRecordPersonCandidates(row, metadata)
    const bestPerson = personCandidates[0] ?? null
    const contractorPerson = !bestPerson ? personFromContractorField(contractorName) : null
    const personName = bestPerson?.name ?? contractorPerson
    const phone = normalisePhone(pickString(row, [...asStringArray(fieldMap.phone), "phone", "business_phone", "telephone", "telephone_number", "contact_phone", "Cont Phone"]))
    const permitNumber = pickString(row, [...asStringArray(fieldMap.record_id), "record_id", "license_number", "permit_number", "registration_number", "taxpayer_id", "sos_file_number", "npi", "usdot_number"])
    const status = pickString(row, [...asStringArray(fieldMap.status), "status", "license_status", "primary_status", "sos_registration_status"])
    const recordType = pickString(row, [...asStringArray(fieldMap.record_type), "record_type", "license_type", "entity_type", "permit_type"])
    const assessment = assessOfficialRecordMatch(row, candidate, metadata)
    if (!assessment.matched) return null
    const { latitude, longitude } = extractPoint(row, asStringArray(fieldMap.geopoint))
    const directLatitude = Number(pickString(row, ["latitude"]))
    const directLongitude = Number(pickString(row, ["longitude"]))
    return {
        row,
        businessName: businessName ?? contractorName ?? assessment.bestRecordName ?? candidate.display_name,
        personName,
        phone,
        permitNumber,
        status,
        recordType,
        address: addressFromRow(row, metadata),
        latitude: latitude ?? (Number.isFinite(directLatitude) ? directLatitude : null),
        longitude: longitude ?? (Number.isFinite(directLongitude) ? directLongitude : null),
        confidence: assessment.confidence,
        matchReasons: assessment.reasons,
        matchSignals: assessment.signals,
        personRole: bestPerson?.role ?? (contractorPerson ? "contractor_person_name" : null),
        personSourceField: bestPerson?.sourceField ?? (contractorPerson ? "contractor_name" : null),
        personConfidence: bestPerson?.confidence ?? (contractorPerson ? 58 : null),
        personCandidates: personCandidates.map((person) => ({
            name: person.name,
            role: person.role,
            source_field: person.sourceField,
            confidence: person.confidence,
            reason: person.reason,
        })),
    }
}

function chooseBestMatch(matches: MatchResult[]) {
    return matches
        .sort((left, right) => {
            const rightHasOwnerPhone = Number(Boolean(right.personName && right.phone))
            const leftHasOwnerPhone = Number(Boolean(left.personName && left.phone))
            if (rightHasOwnerPhone !== leftHasOwnerPhone) return rightHasOwnerPhone - leftHasOwnerPhone
            const rightHasPerson = Number(Boolean(right.personName))
            const leftHasPerson = Number(Boolean(left.personName))
            if (rightHasPerson !== leftHasPerson) return rightHasPerson - leftHasPerson
            if ((right.personConfidence ?? 0) !== (left.personConfidence ?? 0)) return (right.personConfidence ?? 0) - (left.personConfidence ?? 0)
            return right.confidence - left.confidence
        })[0] ?? null
}

const SEARCH_TERM_INSENSITIVE_ADAPTERS = new Set([
    "texas_agriculture_spcs_csv",
    "phoenix_issued_permit_csv",
    "rdap_domain",
    "certificate_transparency",
])

const BROAD_TEXT_SEARCH_ADAPTERS = new Set([
    "socrata_public_records",
    "arcgis_feature_service",
    "guarded_html_search",
    "sunbiz_owner_index",
])

function sourceAdapter(source: SourceCatalog) {
    return asString(source.metadata?.adapter) ?? "socrata_public_records"
}

function searchTermsForSource(source: SourceCatalog, company: CompanyCandidate) {
    const adapter = sourceAdapter(source)
    const guardedHtml = adapter === "guarded_html_search"
    const includeNonNameSignals = BROAD_TEXT_SEARCH_ADAPTERS.has(adapter) && !guardedHtml
    const maxTerms = Math.min(10, Math.max(1, Number(source.metadata?.search_term_limit) || (guardedHtml ? 4 : includeNonNameSignals ? 7 : 5)))
    const terms = buildOfficialRecordSearchTerms(company, { includeNonNameSignals, maxTerms })
    if (SEARCH_TERM_INSENSITIVE_ADAPTERS.has(adapter)) return terms.slice(0, 1)
    return terms
}

function isFatalSearchError(error: unknown) {
    return classifyPublicRecordFailure(error).sourceScoped
}

async function fetchRowsForSearchTerms(source: SourceCatalog, searchTerms: string[], company: CompanyCandidate) {
    const rows: SocrataRecord[] = []
    const seen = new Set<string>()
    const attempts: Array<Record<string, unknown>> = []
    const maxRows = Math.min(200, Math.max(20, Number(source.metadata?.max_rows_to_match) || 100))
    const errors: string[] = []
    for (const searchTerm of searchTerms) {
        try {
            const termRows = await fetchRowsForSource(source, searchTerm, company)
            let added = 0
            for (const row of termRows) {
                const key = hashRecord(row)
                if (seen.has(key)) continue
                seen.add(key)
                rows.push(row)
                added += 1
                if (rows.length >= maxRows) break
            }
            attempts.push({ search_term: searchTerm, returned_rows: termRows.length, new_rows: added })
            if (rows.length >= maxRows) break
        } catch (error) {
            const message = compactErrorMessage(error)
            attempts.push({ search_term: searchTerm, error: message })
            errors.push(message)
            if (isFatalSearchError(error)) throw error
        }
    }
    if (rows.length === 0 && errors.length === searchTerms.length) {
        throw new Error(errors[0] ?? "Public-record source search failed for every search term.")
    }
    return { rows, attempts }
}

async function insertEvidence({
    workspaceId,
    pollId,
    company,
    source,
    result,
}: {
    workspaceId: string
    pollId: string
    company: CompanyCandidate
    source: SourceCatalog
    result: MatchResult
}) {
    const metadata = source.metadata ?? {}
    const claimProfile = asString(metadata.claim_profile) ?? "public_record_support"
    const profileUrl = sourceProfileUrl(source.source_key, metadata, result)
    const sourceRecordId = `${source.source_key}:${result.permitNumber ?? hashRecord(result.row)}`
    const ownerIdentityPoints = Math.min(3, Math.max(0, Number(metadata.owner_identity_points_on_match) || 0))
    const ownerPhonePoints = result.personName && result.phone ? Math.min(3, Math.max(0, Number(metadata.owner_phone_points_on_match) || 0)) : 0
    const businessSupportPoints = Math.min(3, Math.max(0, Number(metadata.business_support_points_on_match) || source.business_support_points || 1))
    const identityProfile = identityProfileFromOfficialRecord(result.row, {
        sourceKey: source.source_key,
        sourceLabel: source.label,
        confidence: result.confidence,
        seedDisplayName: company.display_name,
    })
    const mergedIdentity = identityProfile ? mergeIdentityForCompany(company, [identityProfile]) : null
    const identityPayload = mergedIdentity ? identityPayloadForCompany(mergedIdentity) : {}
    if (mergedIdentity) Object.assign(company, identityPayload)
    const rawPayload = {
        source_key: source.source_key,
        source_label: source.label,
        claim_profile: claimProfile,
        business_name: result.businessName,
        person_name: result.personName,
        phone: result.phone,
        record_id: result.permitNumber,
        status: result.status,
        record_type: result.recordType,
        source_url: profileUrl,
        match_reasons: result.matchReasons,
        match_signals: result.matchSignals,
        extracted_person_role: result.personRole,
        extracted_person_source_field: result.personSourceField,
        extracted_person_confidence: result.personConfidence,
        extracted_person_candidates: result.personCandidates,
        identity_profile: identityProfile ? {
            legal_name: identityProfile.legalName,
            dba_name: identityProfile.dbaName,
            entity_number: identityProfile.entityNumber,
            filing_id: identityProfile.filingId,
            registered_address: identityProfile.registeredAddress,
            known_aliases: identityProfile.knownAliases,
            confidence: identityProfile.confidence,
        } : null,
        row: result.row,
    }
    const { error: sourceRecordError } = await supabaseAdmin.from("leadgen_source_records").upsert({
        workspace_id: workspaceId,
        poll_id: pollId,
        task_id: null,
        source_key: source.source_key,
        source_record_id: sourceRecordId,
        company_name: result.businessName ?? company.display_name,
        phone: result.phone,
        website_url: null,
        profile_url: profileUrl,
        address: result.address,
        latitude: result.latitude,
        longitude: result.longitude,
        categories: [
            { key: "source_family", value: source.family },
            { key: "source_label", value: source.label },
            ...(result.recordType ? [{ key: "record_type", value: result.recordType }] : []),
            ...(result.status ? [{ key: "status", value: result.status }] : []),
        ],
        rating: null,
        review_count: null,
        raw_payload: rawPayload,
    }, { onConflict: "workspace_id,source_key,source_record_id" })
    if (sourceRecordError) throw sourceRecordError
    const { error: evidenceError } = await supabaseAdmin.from("leadgen_evidence").insert({
        workspace_id: workspaceId,
        poll_id: pollId,
        company_id: company.id,
        source_key: source.source_key,
        evidence_kind: claimProfile,
        confidence: result.confidence,
        value: {
            business_name: result.businessName,
            person_name: result.personName,
            phone: result.phone,
            record_id: result.permitNumber,
            status: result.status,
            source_url: profileUrl,
        },
        raw_payload: rawPayload,
    })
    if (evidenceError) throw evidenceError
    if (source.family === "permits") {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId: company.id,
            sourceKey: source.source_key,
            claimKind: "permit_activity",
            pointsAwarded: businessSupportPoints,
            confidence: result.confidence,
            provenanceUrl: profileUrl,
            claimValue: { record_id: result.permitNumber, status: result.status, record_type: result.recordType },
            rawPayload,
        })
    } else {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId: company.id,
            sourceKey: source.source_key,
            claimKind: "business_support",
            pointsAwarded: businessSupportPoints,
            confidence: result.confidence,
            provenanceUrl: profileUrl,
            claimValue: { record_id: result.permitNumber, status: result.status, record_type: result.recordType },
            rawPayload,
        })
    }
    if (result.personName && ownerIdentityPoints > 0) {
        const configuredIdentityClaimKind = asString(metadata.identity_claim_kind)
        const identityClaimKind = configuredIdentityClaimKind === "owner_identity" || configuredIdentityClaimKind === "officer_identity"
            ? configuredIdentityClaimKind
            : source.family === "registries" ? "officer_identity" : "owner_identity"
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId: company.id,
            sourceKey: source.source_key,
            claimKind: identityClaimKind,
            pointsAwarded: ownerIdentityPoints,
            confidence: result.confidence,
            provenanceUrl: profileUrl,
            claimValue: { owner_name: result.personName, role: result.personRole ?? asString(metadata.person_role) ?? "public_record_principal", source_field: result.personSourceField },
            rawPayload,
        })
    }
    if (result.personName && result.phone && ownerPhonePoints > 0) {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId: company.id,
            sourceKey: source.source_key,
            claimKind: "owner_phone",
            pointsAwarded: ownerPhonePoints,
            confidence: result.confidence,
            provenanceUrl: profileUrl,
            claimValue: { owner_name: result.personName, owner_phone: result.phone, phone_source: claimProfile },
            rawPayload,
        })
    } else if (result.phone) {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId: company.id,
            sourceKey: source.source_key,
            claimKind: "business_phone",
            pointsAwarded: Math.min(2, businessSupportPoints),
            confidence: result.confidence,
            provenanceUrl: profileUrl,
            claimValue: { phone: result.phone, phone_source: claimProfile },
            rawPayload,
        })
    }
    const updatePayload: Record<string, unknown> = {
        last_seen_at: new Date().toISOString(),
        owner_evidence: rawPayload,
        ...identityPayload,
    }
    if (profileUrl) updatePayload.profile_url = profileUrl
    if (result.phone) updatePayload.phone = result.phone
    if (result.personName && ownerIdentityPoints > 0) {
        updatePayload.owner_name = result.personName
        updatePayload.owner_source_key = source.source_key
        updatePayload.owner_confidence = result.confidence
        if (result.phone && ownerPhonePoints > 0) updatePayload.owner_phone = result.phone
    }
    const updateResult = await supabaseAdmin
        .from("leadgen_companies")
        .update(updatePayload)
        .eq("workspace_id", workspaceId)
        .eq("id", company.id)
    if (updateResult.error && missingIdentityColumn(updateResult.error) && Object.keys(identityPayload).length) {
        for (const key of Object.keys(identityPayload)) delete updatePayload[key]
        const retryResult = await supabaseAdmin
            .from("leadgen_companies")
            .update(updatePayload)
            .eq("workspace_id", workspaceId)
            .eq("id", company.id)
        if (retryResult.error) throw retryResult.error
    } else if (updateResult.error) {
        throw updateResult.error
    }
    return { ownerIdentityPoints, ownerPhonePoints, businessSupportPoints, rawPayload }
}

async function processTask({ workspaceId, pollId, task, company, source }: { workspaceId: string; pollId: string; task: InvestigationTask; company: CompanyCandidate; source: SourceCatalog }) {
    await updateInvestigationTask({ workspaceId, pollId, companyId: company.id, sourceKey: task.source_key, stageKey: task.stage_key, status: "running" })
    const searchTerms = searchTermsForSource(source, company)
    if (searchTerms.length === 0) {
        await updateInvestigationTask({
            workspaceId,
            pollId,
            companyId: company.id,
            sourceKey: task.source_key,
            stageKey: task.stage_key,
            status: "completed",
            matched: false,
            skipReason: "Could not build a useful business-name search term for this public-record source.",
        })
        return { sourceTouched: false, matched: false } satisfies TaskProcessOutcome
    }
    const { rows, attempts } = await fetchRowsForSearchTerms(source, searchTerms, company)
    const matches = rows
        .map((row) => rowToMatch(row, company, source.metadata ?? {}))
        .filter((match): match is MatchResult => Boolean(match))
    const result = chooseBestMatch(matches)
    if (!result) {
        await updateInvestigationTask({
            workspaceId,
            pollId,
            companyId: company.id,
            sourceKey: task.source_key,
            stageKey: task.stage_key,
            status: "completed",
            matched: false,
            skipReason: `${source.label} returned ${rows.length} public row${rows.length === 1 ? "" : "s"}, but none matched this candidate strongly enough.`,
            rawPayload: {
                search_terms: searchTerms,
                search_attempts: attempts,
                returned_rows: rows.length,
                closest_rejected_rows: summarizeOfficialRecordRejections(rows, company, source.metadata ?? {}),
            },
        })
        return { sourceTouched: true, matched: false, returnedRows: rows.length } satisfies TaskProcessOutcome
    }
    const evidence = await insertEvidence({ workspaceId, pollId, company, source, result })
    await updateInvestigationTask({
        workspaceId,
        pollId,
        companyId: company.id,
        sourceKey: task.source_key,
        stageKey: task.stage_key,
        status: "completed",
        matched: true,
        ownerIdentityPoints: evidence.ownerIdentityPoints,
        ownerPhonePoints: evidence.ownerPhonePoints,
        businessSupportPoints: evidence.businessSupportPoints,
        rawPayload: evidence.rawPayload,
    })
    return { sourceTouched: true, matched: true, returnedRows: rows.length } satisfies TaskProcessOutcome
}

export async function processPublicRecordsPoll(pollId: string, workspaceId: string, options: { finalize?: boolean; stageKey?: Exclude<PollStageKey, "seed"> } = {}) {
    await setLeadgenPollStatus(pollId, workspaceId, "running")
    let tasksQuery = supabaseAdmin
        .from("leadgen_investigation_tasks")
        .select("id, company_id, source_key, stage_key")
        .eq("poll_id", pollId)
        .eq("workspace_id", workspaceId)
        .eq("status", "queued")
        .in("source_key", [...EXECUTABLE_PUBLIC_RECORD_SOURCES])
        .order("created_at", { ascending: true })
    if (options.stageKey) tasksQuery = tasksQuery.eq("stage_key", options.stageKey)
    const tasksResult = await tasksQuery
    if (tasksResult.error) throw new Error(`Could not load public-record investigation tasks: ${tasksResult.error.message}`)
    const tasks = (tasksResult.data ?? []) as InvestigationTask[]
    if (tasks.length === 0) return
    const sourceKeys = [...new Set(tasks.map((task) => task.source_key))]
    const companyIds = [...new Set(tasks.map((task) => task.company_id))]
    const [sourcesResult, companiesResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_source_catalog")
            .select("source_key, label, family, owner_identity_points, owner_phone_points, business_support_points, rate_limit_ms, metadata")
            .in("source_key", sourceKeys),
        supabaseAdmin
            .from("leadgen_companies")
            .select("id, canonical_name, display_name, legal_name, dba_name, entity_number, filing_id, registered_address, known_aliases, identity_resolution, identity_source_key, identity_confidence, identity_resolved_at, phone, website_domain, website_url, profile_url, source_record_id, address, latitude, longitude, industry_value, location_value")
            .eq("workspace_id", workspaceId)
            .in("id", companyIds),
    ])
    if (sourcesResult.error) throw new Error(`Could not load public-record source catalog: ${sourcesResult.error.message}`)
    if (companiesResult.error) throw new Error(`Could not load public-record candidate companies: ${companiesResult.error.message}`)
    const sources = new Map(((sourcesResult.data ?? []) as SourceCatalog[]).map((source) => [source.source_key, source]))
    const companies = new Map(((companiesResult.data ?? []) as CompanyCandidate[]).map((company) => [company.id, company]))
    const sourceGroups = [...groupByKey(tasks, (task) => task.source_key)]
        .map(([sourceKey, sourceTasks]) => ({ sourceKey, source: sources.get(sourceKey), tasks: sourceTasks }))
        .sort((left, right) => publicRecordSourcePriority(right.source, options.stageKey) - publicRecordSourcePriority(left.source, options.stageKey))
    await runWithConcurrency(sourceGroups, PUBLIC_RECORD_SOURCE_CONCURRENCY[options.stageKey ?? "business_validation"], async (group) => {
        if (!group.source) {
            await Promise.all(group.tasks.map((task) => updateInvestigationTask({
                workspaceId,
                pollId,
                companyId: task.company_id,
                sourceKey: task.source_key,
                stageKey: task.stage_key,
                status: "failed",
                error: "Public-record source metadata was unavailable when this task was processed.",
            })))
            return
        }
        let sourceTouched = false
        let sourceScopedFailure: { classification: PublicRecordFailureClassification; errorMessage: string } | null = null
        for (const [index, task] of group.tasks.entries()) {
            if (sourceScopedFailure) {
                await updateInvestigationTask({
                    workspaceId,
                    pollId,
                    companyId: task.company_id,
                    sourceKey: task.source_key,
                    stageKey: task.stage_key,
                    status: "skipped",
                    skipReason: sourceScopedSkipReason(group.source, sourceScopedFailure.classification, sourceScopedFailure.errorMessage),
                    rawPayload: {
                        skipped_after_source_failure: true,
                        source_failure_kind: sourceScopedFailure.classification.kind,
                    },
                })
                continue
            }
            const company = companies.get(task.company_id)
            if (!company) {
                await updateInvestigationTask({
                    workspaceId,
                    pollId,
                    companyId: task.company_id,
                    sourceKey: task.source_key,
                    stageKey: task.stage_key,
                    status: "skipped",
                    skipReason: "Candidate company was no longer available when this public-record task was processed.",
                })
                continue
            }
            try {
                const outcome = await processTask({ workspaceId, pollId, task, company: { ...company }, source: group.source })
                sourceTouched ||= outcome.sourceTouched
            } catch (error) {
                const errorMessage = compactErrorMessage(error)
                const classification = classifyPublicRecordFailure(error)
                await updateInvestigationTask({
                    workspaceId,
                    pollId,
                    companyId: task.company_id,
                    sourceKey: task.source_key,
                    stageKey: task.stage_key,
                    status: "failed",
                    error: errorMessage,
                    rawPayload: {
                        source_failure_kind: classification.kind,
                        source_failure_source_scoped: classification.sourceScoped,
                    },
                })
                await recordPublicRecordSourceHealth({
                    sourceKey: group.source.source_key,
                    status: classification.healthStatus,
                    pollId,
                    stageKey: task.stage_key,
                    lastError: errorMessage,
                    classification,
                    sourceTouched,
                })
                if (classification.skipRemainingTasks) sourceScopedFailure = { classification, errorMessage }
            }
            if (!sourceScopedFailure && index < group.tasks.length - 1) await sleep(publicRecordSourceDelay(group.source))
        }
        if (sourceTouched && !sourceScopedFailure) {
            await recordPublicRecordSourceHealth({
                sourceKey: group.source.source_key,
                status: "healthy",
                pollId,
                stageKey: options.stageKey,
                sourceTouched: true,
            })
        }
    })
    await refreshLeadgenPollCounts(pollId, workspaceId)
    if (options.finalize !== false) await refreshLeadgenPollCounts(pollId, workspaceId)
}
