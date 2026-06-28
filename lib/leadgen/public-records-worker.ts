import { createHash } from "crypto"

import { recordEvidenceClaim, updateInvestigationTask } from "@/lib/leadgen/evidence-scoring"
import { refreshLeadgenPollCounts, setLeadgenPollStatus } from "@/lib/leadgen/osm-worker"
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
}

type CompanyCandidate = {
    id: string
    display_name: string
    phone: string | null
    address: Record<string, unknown> | null
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
}

const EXECUTABLE_PUBLIC_RECORD_SOURCES = new Set([
    "permits.tx.dallas",
    "permits.tx.austin",
    "permits.fl.orlando",
    "permits.ca.los_angeles",
    "registry.fl.orlando_btr",
])

const PUBLIC_RECORD_FETCH_TIMEOUT_MS = 18_000

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function compactErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "Public-record source task failed."
    return message.length > 900 ? `${message.slice(0, 900)}…` : message
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

function stripLegalSuffixes(value: string | null | undefined) {
    return cleanText(value ?? "")
        .replace(/\b(d\/b\/a|dba|llc|l\.l\.c\.|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|pa|systems|services)\b\.?/gi, " ")
        .replace(/\b(the|and|&)\b/gi, " ")
        .replace(/[^a-z0-9]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
}

function nameTokens(value: string | null | undefined) {
    return stripLegalSuffixes(value)
        .split(" ")
        .filter((token) => token.length >= 3)
}

function sharedTokenScore(left: string | null | undefined, right: string | null | undefined) {
    const leftTokens = new Set(nameTokens(left))
    const rightTokens = new Set(nameTokens(right))
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0
    const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length
    return shared / Math.max(leftTokens.size, rightTokens.size)
}

function strongBusinessNameMatch(candidateName: string, ...recordNames: Array<string | null | undefined>) {
    const candidateCanonical = stripLegalSuffixes(candidateName)
    if (!candidateCanonical) return false
    return recordNames.some((recordName) => {
        const recordCanonical = stripLegalSuffixes(recordName)
        if (!recordCanonical) return false
        return recordCanonical.includes(candidateCanonical)
            || candidateCanonical.includes(recordCanonical)
            || sharedTokenScore(candidateCanonical, recordCanonical) >= 0.62
    })
}

function firstSearchTerm(candidateName: string) {
    const tokens = nameTokens(candidateName)
    return tokens.slice(0, Math.min(4, Math.max(1, tokens.length))).join(" ")
}

function looksLikePersonName(value: string | null | undefined) {
    const clean = cleanText(value ?? "")
    if (!clean || /\b(LLC|INC|CORP|COMPANY|CONSTRUCTION|SERVICES|SYSTEMS|CONTRACTORS?|HOMES?|ROOFING|PLUMBING|ELECTRIC|HVAC)\b/i.test(clean)) return false
    const parts = clean.split(/\s+/).filter(Boolean)
    return parts.length >= 2 && parts.length <= 5 && parts.every((part) => /^[A-Za-z.'-]+$/.test(part))
}

function buildOwnerName(row: SocrataRecord, fields: string[]) {
    const direct = pickString(row, fields)
    if (direct) return direct
    const first = pickString(row, ["principal_first_name", "applicant_first_name", "owner_first_name"])
    const middle = pickString(row, ["principal_middle_name", "owner_middle_name"])
    const last = pickString(row, ["principal_last_name", "applicant_last_name", "owner_last_name"])
    return [first, middle, last].map((part) => cleanText(part ?? "")).filter(Boolean).join(" ") || null
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
    const configured = asString(metadata.provenance_url)
    if (configured) return configured
    const domain = asString(metadata.domain)
    const datasetId = asString(metadata.dataset_id)
    if (!domain || !datasetId) return null
    const marker = encodeURIComponent(result.permitNumber ?? result.businessName ?? result.personName ?? "")
    return marker ? `https://${domain}/d/${datasetId}?row=${marker}` : `https://${domain}/d/${datasetId}`
}

async function fetchSocrataRows(metadata: Record<string, unknown>, searchTerm: string) {
    const domain = asString(metadata.domain)
    const datasetId = asString(metadata.dataset_id)
    if (!domain || !datasetId) throw new Error("Socrata source is missing domain or dataset_id metadata.")
    if (!searchTerm) return []
    const limit = Math.min(50, Math.max(1, Number(metadata.query_limit) || 15))
    const params = new URLSearchParams({ "$limit": String(limit), "$q": searchTerm })
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

function rowToMatch(row: SocrataRecord, candidate: CompanyCandidate, metadata: Record<string, unknown>): MatchResult | null {
    const fieldMap = asRecord(metadata.field_map)
    const businessName = pickString(row, asStringArray(fieldMap.business_name))
    const contractorName = pickString(row, asStringArray(fieldMap.contractor_name))
    const ownerName = buildOwnerName(row, asStringArray(fieldMap.owner_name))
    const applicantName = buildOwnerName(row, asStringArray(fieldMap.applicant_name))
    const personName = ownerName ?? applicantName ?? personFromContractorField(contractorName)
    const phone = normalisePhone(pickString(row, asStringArray(fieldMap.phone)))
    const permitNumber = pickString(row, asStringArray(fieldMap.record_id))
    const status = pickString(row, asStringArray(fieldMap.status))
    const recordType = pickString(row, asStringArray(fieldMap.record_type))
    const recordNames = [businessName, contractorName, ownerName, applicantName, pickString(row, asStringArray(fieldMap.additional_match_name))]
    if (!strongBusinessNameMatch(candidate.display_name, ...recordNames)) return null
    const { latitude, longitude } = extractPoint(row, asStringArray(fieldMap.geopoint))
    return {
        row,
        businessName: businessName ?? contractorName ?? candidate.display_name,
        personName,
        phone,
        permitNumber,
        status,
        recordType,
        address: addressFromRow(row, metadata),
        latitude,
        longitude,
        confidence: sharedTokenScore(candidate.display_name, businessName ?? contractorName) >= 0.8 ? 86 : 72,
    }
}

function chooseBestMatch(matches: MatchResult[]) {
    return matches
        .sort((left, right) => {
            const rightHasOwnerPhone = Number(Boolean(right.personName && right.phone))
            const leftHasOwnerPhone = Number(Boolean(left.personName && left.phone))
            if (rightHasOwnerPhone !== leftHasOwnerPhone) return rightHasOwnerPhone - leftHasOwnerPhone
            return right.confidence - left.confidence
        })[0] ?? null
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
    const ownerPhonePoints = result.phone ? Math.min(3, Math.max(0, Number(metadata.owner_phone_points_on_match) || 0)) : 0
    const businessSupportPoints = Math.min(3, Math.max(0, Number(metadata.business_support_points_on_match) || source.business_support_points || 1))
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
        const identityClaimKind = asString(metadata.identity_claim_kind) === "owner_identity"
            ? "owner_identity"
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
            claimValue: { owner_name: result.personName, role: asString(metadata.person_role) ?? "public_record_principal" },
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
    }
    if (profileUrl) updatePayload.profile_url = profileUrl
    if (result.phone) updatePayload.phone = result.phone
    if (result.personName && ownerIdentityPoints > 0) {
        updatePayload.owner_name = result.personName
        updatePayload.owner_source_key = source.source_key
        updatePayload.owner_confidence = result.confidence
        if (result.phone && ownerPhonePoints > 0) updatePayload.owner_phone = result.phone
    }
    const { error } = await supabaseAdmin
        .from("leadgen_companies")
        .update(updatePayload)
        .eq("workspace_id", workspaceId)
        .eq("id", company.id)
    if (error) throw error
    return { ownerIdentityPoints, ownerPhonePoints, businessSupportPoints, rawPayload }
}

async function processTask({ workspaceId, pollId, task, company, source }: { workspaceId: string; pollId: string; task: InvestigationTask; company: CompanyCandidate; source: SourceCatalog }) {
    await updateInvestigationTask({ workspaceId, pollId, companyId: company.id, sourceKey: task.source_key, status: "running" })
    const searchTerm = firstSearchTerm(company.display_name)
    if (!searchTerm) {
        await updateInvestigationTask({
            workspaceId,
            pollId,
            companyId: company.id,
            sourceKey: task.source_key,
            status: "completed",
            matched: false,
            skipReason: "Could not build a useful business-name search term for this public-record source.",
        })
        return
    }
    const rows = await fetchSocrataRows(source.metadata ?? {}, searchTerm)
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
            status: "completed",
            matched: false,
            skipReason: `${source.label} returned ${rows.length} public row${rows.length === 1 ? "" : "s"}, but none matched this candidate strongly enough.`,
            rawPayload: { search_term: searchTerm, returned_rows: rows.length },
        })
        return
    }
    const evidence = await insertEvidence({ workspaceId, pollId, company, source, result })
    await updateInvestigationTask({
        workspaceId,
        pollId,
        companyId: company.id,
        sourceKey: task.source_key,
        status: "completed",
        matched: true,
        ownerIdentityPoints: evidence.ownerIdentityPoints,
        ownerPhonePoints: evidence.ownerPhonePoints,
        businessSupportPoints: evidence.businessSupportPoints,
        rawPayload: evidence.rawPayload,
    })
}

export async function processPublicRecordsPoll(pollId: string, workspaceId: string, options: { finalize?: boolean } = {}) {
    await setLeadgenPollStatus(pollId, workspaceId, "running")
    const tasksResult = await supabaseAdmin
        .from("leadgen_investigation_tasks")
        .select("id, company_id, source_key")
        .eq("poll_id", pollId)
        .eq("workspace_id", workspaceId)
        .eq("status", "queued")
        .in("source_key", [...EXECUTABLE_PUBLIC_RECORD_SOURCES])
        .order("created_at", { ascending: true })
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
            .select("id, display_name, phone, address, industry_value, location_value")
            .eq("workspace_id", workspaceId)
            .in("id", companyIds),
    ])
    if (sourcesResult.error) throw new Error(`Could not load public-record source catalog: ${sourcesResult.error.message}`)
    if (companiesResult.error) throw new Error(`Could not load public-record candidate companies: ${companiesResult.error.message}`)
    const sources = new Map(((sourcesResult.data ?? []) as SourceCatalog[]).map((source) => [source.source_key, source]))
    const companies = new Map(((companiesResult.data ?? []) as CompanyCandidate[]).map((company) => [company.id, company]))
    for (const task of tasks) {
        const source = sources.get(task.source_key)
        const company = companies.get(task.company_id)
        if (!source || !company) continue
        try {
            await processTask({ workspaceId, pollId, task, company, source })
        } catch (error) {
            await updateInvestigationTask({
                workspaceId,
                pollId,
                companyId: task.company_id,
                sourceKey: task.source_key,
                status: "failed",
                error: compactErrorMessage(error),
            })
        }
        await sleep(Math.min(5000, Math.max(0, source.rate_limit_ms ?? 1000)))
    }
    await refreshLeadgenPollCounts(pollId, workspaceId)
    if (options.finalize !== false) await refreshLeadgenPollCounts(pollId, workspaceId)
}
