import { createHash } from "crypto"

import { recordEvidenceClaim, updateInvestigationTask } from "@/lib/leadgen/evidence-scoring"
import { refreshLeadgenPollCounts, setLeadgenPollStatus } from "@/lib/leadgen/osm-worker"
import type { PollStageKey } from "@/lib/leadgen/staged-poll"
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
    phone: string | null
    website_domain: string | null
    website_url: string | null
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
    "safety.osha",
    "transport.fmcsa_safer",
    "regulated.epa_echo",
    "regulated.nppes",
    "procurement.usaspending",
    "web.rdap_whois",
    "web.certificate_transparency",
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

function domainFromUrl(value: string | null | undefined) {
    if (!value) return null
    try {
        return new URL(value.startsWith("http") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "") || null
    } catch {
        return null
    }
}

function candidateDomain(candidate: CompanyCandidate) {
    return domainFromUrl(candidate.website_domain) ?? domainFromUrl(candidate.website_url)
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

function candidateState(candidate: CompanyCandidate) {
    const address = candidate.address ?? {}
    const direct = asString(address.state) ?? asString(address.region) ?? asString(address.state_code) ?? asString(address.region_code)
    return direct && /^[A-Z]{2}$/i.test(direct) ? direct.toUpperCase() : null
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
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PUBLIC_RECORD_FETCH_TIMEOUT_MS)
    try {
        const response = await fetch(url, {
            ...init,
            headers: {
                Accept: "text/html,application/json,*/*",
                "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)",
                ...(init?.headers ?? {}),
            },
            cache: "no-store",
            signal: controller.signal,
        })
        const text = await response.text()
        if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${stripHtml(text).slice(0, 280)}`)
        return text
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error(`${url} timed out after ${Math.round(PUBLIC_RECORD_FETCH_TIMEOUT_MS / 1000)} seconds.`)
        throw error
    } finally {
        clearTimeout(timeout)
    }
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
    if (adapter === "fmcsa_safer_snapshot") return fetchFmcsaRows(searchTerm)
    if (adapter === "osha_establishment_search") return fetchOshaRows(searchTerm, company)
    if (adapter === "epa_echo_cwa_facility_info") return fetchEpaEchoRows(searchTerm, company)
    if (adapter === "nppes_registry") return fetchNppesRows(searchTerm, company)
    if (adapter === "usaspending_awards") return fetchUsaspendingRows(searchTerm)
    if (adapter === "rdap_domain") return fetchRdapRows(company)
    if (adapter === "certificate_transparency") return fetchCertificateTransparencyRows(company)
    return fetchSocrataRows(source.metadata ?? {}, searchTerm)
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
    const directLatitude = Number(pickString(row, ["latitude"]))
    const directLongitude = Number(pickString(row, ["longitude"]))
    return {
        row,
        businessName: businessName ?? contractorName ?? candidate.display_name,
        personName,
        phone,
        permitNumber,
        status,
        recordType,
        address: addressFromRow(row, metadata),
        latitude: latitude ?? (Number.isFinite(directLatitude) ? directLatitude : null),
        longitude: longitude ?? (Number.isFinite(directLongitude) ? directLongitude : null),
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
    const ownerPhonePoints = result.personName && result.phone ? Math.min(3, Math.max(0, Number(metadata.owner_phone_points_on_match) || 0)) : 0
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
    await updateInvestigationTask({ workspaceId, pollId, companyId: company.id, sourceKey: task.source_key, stageKey: task.stage_key, status: "running" })
    const searchTerm = firstSearchTerm(company.display_name)
    if (!searchTerm) {
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
        return
    }
    const rows = await fetchRowsForSource(source, searchTerm, company)
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
        stageKey: task.stage_key,
        status: "completed",
        matched: true,
        ownerIdentityPoints: evidence.ownerIdentityPoints,
        ownerPhonePoints: evidence.ownerPhonePoints,
        businessSupportPoints: evidence.businessSupportPoints,
        rawPayload: evidence.rawPayload,
    })
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
            .select("id, display_name, phone, website_domain, website_url, address, industry_value, location_value")
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
                stageKey: task.stage_key,
                status: "failed",
                error: compactErrorMessage(error),
            })
        }
        await sleep(Math.min(5000, Math.max(0, source.rate_limit_ms ?? 1000)))
    }
    await refreshLeadgenPollCounts(pollId, workspaceId)
    if (options.finalize !== false) await refreshLeadgenPollCounts(pollId, workspaceId)
}
