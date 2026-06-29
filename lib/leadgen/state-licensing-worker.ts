import { supabaseAdmin } from "@/lib/supabase/admin"
import type { LeadgenSourcePlanItem } from "@/lib/leadgen/sources"
import { refreshLeadgenPollCounts, setLeadgenPollStatus } from "@/lib/leadgen/osm-worker"
import { recordEvidenceClaim, updateInvestigationTask } from "@/lib/leadgen/evidence-scoring"

type SourceOption = {
    value: string
    label: string
    metadata: Record<string, unknown> | null
}

type SourceIndustryMapping = {
    icp_industry_value: string
    native_values: string[] | null
}

type SourceLocationMapping = {
    icp_location_value: string
    native_values: string[] | null
}

type CompanyCandidate = {
    id: string
    display_name: string
    phone: string | null
    address: Record<string, unknown> | null
    industry_value: string | null
    location_value: string | null
}

type LicensingTask = {
    id: string
    source_key: string
    industry_value: string | null
    location_value: string | null
    source_query: Record<string, unknown> | null
}

type TdlrResult = {
    licenseNumber: string
    expirationDate: string | null
    name: string
    city: string | null
    zip: string | null
    county: string | null
    phone: string | null
    profileUrl: string | null
    expired: boolean
    rawHtml: string
}

type DbprLicenseResult = {
    licenseNumber: string
    licenseType: string
    ownerName: string | null
    businessName: string | null
    status: string | null
    expirationDate: string | null
    address: Record<string, unknown>
    phone: string | null
    profileUrl: string
    row: string[]
}

type NcLicenseResult = {
    licenseNumber: string
    ownerName: string | null
    phone: string | null
    status: string | null
    classifications: string[]
    active: boolean
    detailUrl: string
    rawSearchRow: string
    rawDetailHtml: string
}

const TDLR_SEARCH_URL = "https://www.tdlr.texas.gov/LicenseSearch/SearchResultsListBrowse.asp?from=search"
const TDLR_DETAIL_BASE_URL = "https://www.tdlr.texas.gov/LicenseSearch/"
const DBPR_ELECTRICAL_CSV_URL = "https://www2.myfloridalicense.com/sto/file_download/extracts/lic08el.csv"
const DBPR_LICENSE_BASE_URL = "https://www.myfloridalicense.com/LicenseDetail.asp"
const NC_GENERAL_SEARCH_URL = "https://portal.nclbgc.org/Public/_Search/"
const NC_GENERAL_DETAIL_URL = "https://portal.nclbgc.org/Public/_ShowAccountDetails/"
const TDLR_FETCH_TIMEOUT_MS = 22000
const STATE_LICENSING_REQUEST_DELAY_MS = 900

const DBPR_ELECTRICAL_INDUSTRIES = new Set([
    "electricians",
    "solar_installers",
    "pool_builders",
    "hvac_contractors",
    "general_contractors",
])

const NC_CLASSIFICATIONS_BY_INDUSTRY: Record<string, string[]> = {
    concrete_contractors: ["42"],
    deck_builders: ["27", "28"],
    fencing_contractors: ["50"],
    general_contractors: ["27", "28", "26"],
    hardscaping_contractors: ["42"],
    home_builders: ["27", "28"],
    insulation_contractors: ["43"],
    kitchen_remodelling: ["27", "28", "44"],
    masonry_contractors: ["46"],
    patio_contractors: ["27", "42"],
    pool_builders: ["51"],
    remodellers: ["27", "28", "44"],
    restoration_companies: ["27", "28", "26"],
    roofers: ["49"],
    siding_contractors: ["27", "44"],
    window_and_door_contractors: ["27", "44"],
}

const STATE_LICENSE_SOURCE_KEYS = ["state_licensing", "state_license.tx.tdlr", "state_license.fl.electrical", "state_license.nc.general_contractors"]
const TDLR_SOURCE_KEY = "state_license.tx.tdlr"
const FL_DBPR_ELECTRICAL_SOURCE_KEY = "state_license.fl.electrical"
const NC_GENERAL_CONTRACTORS_SOURCE_KEY = "state_license.nc.general_contractors"

const csvTextCache = new Map<string, Promise<string>>()

const FALLBACK_TDLR_MAPPINGS: Record<string, { status: string; endorsement?: string }> = {
    a_c_contractor: { status: "AIRREF" },
    a_c_technician: { status: "ACTECH" },
    appliance_installation_contractor: { status: "ELCTRC", endorsement: "RAIC" },
    appliance_installer: { status: "ELCTRC", endorsement: "RAI" },
    boiler_authorized_inspection_agency: { status: "BLRAGY" },
    boiler_inspectors: { status: "BLRINS" },
    electrical_apprentice: { status: "ELCTRC", endorsement: "AE" },
    electrical_contractor: { status: "ELCTRC", endorsement: "EC" },
    electrical_sign_contractor: { status: "ELCTRC", endorsement: "SC" },
    journeyman_electrician: { status: "ELCTRC", endorsement: "JE" },
    master_electrician: { status: "ELCTRC", endorsement: "ME" },
    water_well_driller: { status: "WWDPMP", endorsement: "W" },
    water_well_pump_installer: { status: "WWDPMP", endorsement: "I" },
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function cleanText(value: string | null | undefined) {
    return decodeHtml(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
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
    return cleanText(value.replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, "").replace(/<[^>]*>/g, " "))
}

function normalisePhone(value: string | null | undefined) {
    const digits = value?.replace(/\D/g, "") ?? ""
    if (digits.length === 10) return `+1${digits}`
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
    return digits ? `+${digits}` : null
}

function canonicalName(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function companyNameFromTdlrName(value: string) {
    const matches = [...value.matchAll(/\(([^()]+)\)/g)].map((match) => cleanText(match[1]))
    const parentheticalBusiness = matches.reverse().find((match) => match.length > 2)
    return parentheticalBusiness || value
}

function ownerNameFromTdlrName(value: string) {
    if (!/\([^()]+\)/.test(value)) return null
    const ownerCandidate = cleanText(value.replace(/\([^()]+\)/g, " "))
    if (!ownerCandidate || ownerCandidate.length < 3) return null
    if (/\b(LLC|INC|CORP|COMPANY|CO\.?|LTD|LP|LLP|DBA)\b/i.test(ownerCandidate)) return null
    const words = ownerCandidate.split(/\s+/).filter(Boolean)
    return words.length >= 2 ? ownerCandidate : null
}

function compactErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "State licensing task failed."
    return message.length > 900 ? `${message.slice(0, 900)}…` : message
}

function asString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function candidateState(candidate: CompanyCandidate) {
    const address = candidate.address ?? {}
    const direct = asString(address.state) ?? asString(address.region) ?? asString(address.state_code) ?? asString(address.region_code)
    if (direct && /^[A-Z]{2}$/i.test(direct)) return direct.toUpperCase()
    const freeform = [address.freeform, address.locality, address.postcode, address.country].map(asString).filter(Boolean).join(" ")
    const match = freeform.match(/\b([A-Z]{2})\b/)
    return match ? match[1].toUpperCase() : null
}

function candidateCity(candidate: CompanyCandidate) {
    const address = candidate.address ?? {}
    return asString(address.city) ?? asString(address.locality) ?? asString(address.town) ?? asString(address.municipality)
}

function candidatePostcode(candidate: CompanyCandidate) {
    const address = candidate.address ?? {}
    const value = asString(address.postcode) ?? asString(address.postal_code) ?? asString(address.zip)
    return value?.slice(0, 10) ?? null
}

function stripLegalSuffixes(value: string) {
    return value
        .replace(/\b(d\/b\/a|dba|llc|l\.l\.c\.|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|pa)\b\.?/gi, " ")
        .replace(/\b(the|and|&)\b/gi, " ")
        .replace(/[^a-z0-9]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
}

function nameTokens(value: string | null | undefined) {
    return stripLegalSuffixes(value ?? "")
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
        const recordCanonical = stripLegalSuffixes(recordName ?? "")
        if (!recordCanonical) return false
        return recordCanonical.includes(candidateCanonical)
            || candidateCanonical.includes(recordCanonical)
            || sharedTokenScore(candidateCanonical, recordCanonical) >= 0.58
    })
}

function firstSearchTerm(candidateName: string) {
    const clean = stripLegalSuffixes(candidateName)
    const tokens = clean.split(" ").filter(Boolean)
    return tokens.slice(0, Math.min(4, Math.max(1, tokens.length))).join(" ")
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

async function fetchTextWithTimeout(url: string, timeoutMs: number) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await fetch(url, {
            headers: { Accept: "text/csv,text/html,application/xhtml+xml", "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)" },
            cache: "no-store",
            signal: controller.signal,
        })
        const text = await response.text()
        if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${stripHtml(text).slice(0, 300)}`)
        return text
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error(`${url} timed out after ${Math.round(timeoutMs / 1000)} seconds.`)
        throw error
    } finally {
        clearTimeout(timeout)
    }
}

async function fetchCachedCsv(url: string) {
    const cached = csvTextCache.get(url)
    if (cached) return cached
    const promise = fetchTextWithTimeout(url, 28_000)
    csvTextCache.set(url, promise)
    return promise
}

function dbprName(value: string | null | undefined) {
    if (!value) return null
    const parts = value.split(",").map((part) => cleanText(part)).filter(Boolean)
    if (parts.length >= 2) return `${parts.slice(1).join(" ")} ${parts[0]}`.replace(/\s+/g, " ").trim()
    return cleanText(value)
}

function parseDbprElectricalRows(csv: string, candidate: CompanyCandidate, limit: number) {
    const matches: DbprLicenseResult[] = []
    const state = candidateState(candidate)
    const zip = candidatePostcode(candidate)?.slice(0, 5)
    const city = candidateCity(candidate)
    for (const line of csv.split(/\r?\n/)) {
        if (!line.trim()) continue
        const row = parseCsvLine(line)
        if (row.length < 21) continue
        const ownerName = dbprName(row[2])
        const businessName = cleanText(row[3]) || null
        const rowState = cleanText(row[9]).toUpperCase()
        const rowZip = cleanText(row[10]).slice(0, 5)
        if (state && rowState && rowState !== state) continue
        if (zip && rowZip && zip !== rowZip && !strongBusinessNameMatch(candidate.display_name, businessName)) continue
        if (!strongBusinessNameMatch(candidate.display_name, businessName, ownerName)) continue
        const status = cleanText(row[14]) || null
        if (status && status !== "A") continue
        const licenseNumber = cleanText(row[20]) || [row[1], row[12]].filter(Boolean).join("")
        matches.push({
            licenseNumber,
            licenseType: cleanText(row[1]) || "Electrical contractor",
            ownerName,
            businessName,
            status,
            expirationDate: cleanText(row[17]) || null,
            address: {
                street: [row[5], row[6], row[7]].map(cleanText).filter(Boolean).join(" ") || null,
                city: cleanText(row[8]) || city,
                state: rowState || state,
                postcode: cleanText(row[10]) || null,
                country: "US",
            },
            phone: null,
            profileUrl: `${DBPR_LICENSE_BASE_URL}?SID=&id=${encodeURIComponent(licenseNumber)}`,
            row,
        })
        if (matches.length >= limit) break
    }
    return matches
}

function parseNcSearchRows(html: string, limit: number) {
    return html
        .split(/<tr>/i)
        .slice(1)
        .map((rowHtml) => {
            const key = rowHtml.match(/ShowAccountDetails\(\s*'([^']+)'/i)?.[1]
            const licenseNumber = stripHtml(rowHtml.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "")
            const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)(?=<td\b|<\/tr>|$)/gi)].map((match) => stripHtml(match[1]))
            const ownerName = cells[2] || null
            const active = !/License Not Active|License Not Valid|Archived/i.test(rowHtml)
            return key && licenseNumber ? { key, licenseNumber, ownerName, active, rawSearchRow: rowHtml.slice(0, 2500) } : null
        })
        .filter((row): row is { key: string; licenseNumber: string; ownerName: string | null; active: boolean; rawSearchRow: string } => Boolean(row))
        .filter((row) => row.active)
        .slice(0, limit)
}

function extractNcDisplayFields(html: string) {
    const fields: Record<string, string> = {}
    const matches = [...html.matchAll(/<div class="display-label">([\s\S]*?)<\/div>\s*<div class="display-field">([\s\S]*?)<\/div>/gi)]
    for (const match of matches) fields[stripHtml(match[1]).toLowerCase()] = stripHtml(match[2])
    return fields
}

function extractNcClassifications(html: string) {
    const classificationBlock = html.match(/<legend>Active Classifications<\/legend>([\s\S]*?)<\/fieldset>/i)?.[1] ?? ""
    return [...classificationBlock.matchAll(/<div class="display-field">([\s\S]*?)<\/div>/gi)]
        .map((match) => stripHtml(match[1]))
        .filter(Boolean)
}

async function fetchNcGeneralSearch({ companyName, classificationId }: { companyName: string; classificationId?: string | null }) {
    const body = new URLSearchParams({
        CompanyName: companyName,
        ClassificationDefinitionIdnt: classificationId ?? "",
    })
    const response = await fetch(NC_GENERAL_SEARCH_URL, {
        method: "POST",
        headers: {
            Accept: "text/html,application/xhtml+xml",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)",
        },
        body,
        cache: "no-store",
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`NC licensing search returned HTTP ${response.status}: ${stripHtml(text).slice(0, 300)}`)
    return text
}

async function fetchNcGeneralDetail(key: string) {
    const url = `${NC_GENERAL_DETAIL_URL}?key=${key}&Source=Search`
    const html = await fetchTextWithTimeout(url, 18_000)
    const fields = extractNcDisplayFields(html)
    return {
        detailUrl: url,
        ownerName: fields.name || null,
        phone: normalisePhone(fields.phone),
        status: fields.status || null,
        licenseNumber: fields["license #"] || null,
        classifications: extractNcClassifications(html),
        active: !/License Not Valid|License Not Active|Archived/i.test(fields.status ?? html),
        rawDetailHtml: html.slice(0, 4000),
    }
}

function tdlrMapping(option: SourceOption) {
    const metadata = option.metadata ?? {}
    const status = typeof metadata.tdlr_status === "string" ? metadata.tdlr_status.trim() : FALLBACK_TDLR_MAPPINGS[option.value]?.status
    const endorsement = typeof metadata.tdlr_endorsement === "string" ? metadata.tdlr_endorsement.trim() : FALLBACK_TDLR_MAPPINGS[option.value]?.endorsement
    return status ? { status, endorsement: endorsement || undefined } : null
}

function tdlrCounty(option: SourceOption) {
    const metadata = option.metadata ?? {}
    const county = typeof metadata.tdlr_county === "string" ? metadata.tdlr_county : option.label
    return cleanText(county)
}

async function fetchTdlrSearch({ status, endorsement, county, name }: { status: string; endorsement?: string; county: string; name?: string | null }) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TDLR_FETCH_TIMEOUT_MS)
    const body = new URLSearchParams({
        tdlr_status: status,
        pht_lic: "",
        pht_expdt: "",
        pht_oth_name: name ?? "",
        phy_city: "-1",
        phy_cnty: county,
        phy_zip: "",
        B1: "Search",
    })
    if (endorsement) body.set("lic_endorsement", endorsement)
    try {
        const response = await fetch(TDLR_SEARCH_URL, {
            method: "POST",
            headers: {
                Accept: "text/html,application/xhtml+xml",
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)",
            },
            body,
            cache: "no-store",
            signal: controller.signal,
        })
        const text = await response.text()
        if (!response.ok) throw new Error(`TDLR returned HTTP ${response.status}: ${stripHtml(text).slice(0, 420)}`)
        return text
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error(`TDLR timed out after ${Math.round(TDLR_FETCH_TIMEOUT_MS / 1000)} seconds.`)
        }
        throw error
    } finally {
        clearTimeout(timeout)
    }
}

function parseTdlrRows(html: string, limit: number): TdlrResult[] {
    if (/No records found|0 records retrieved/i.test(html)) return []
    return html
        .split(/<tr><td/i)
        .slice(1)
        .map((chunk) => `<td${chunk}`)
        .map((rowHtml) => {
            const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)(?=<td\b|<tr\b|<\/tr>|$)/gi)].map((match) => match[1])
            if (cells.length < 7) return null
            const licenseLink = cells[0].match(/href="([^"]+)"/i)?.[1] ?? null
            const profileUrl = licenseLink ? new URL(licenseLink, TDLR_DETAIL_BASE_URL).toString() : null
            const licenseNumber = stripHtml(cells[0])
            const expirationDate = stripHtml(cells[1]) || null
            const name = stripHtml(cells[2])
            if (!licenseNumber || !name) return null
            return {
                licenseNumber,
                expirationDate,
                name,
                city: stripHtml(cells[3]) || null,
                zip: stripHtml(cells[4]) || null,
                county: stripHtml(cells[5]) || null,
                phone: normalisePhone(stripHtml(cells[6])),
                profileUrl,
                expired: /expired/i.test(cells[1]),
                rawHtml: rowHtml.slice(0, 4000),
            }
        })
        .filter((row): row is TdlrResult => Boolean(row && !row.expired))
        .slice(0, limit)
}

async function upsertTdlrRecord({
    workspaceId,
    pollId,
    taskId,
    industryValue,
    locationValue,
    industryLabel,
    countyLabel,
    result,
}: {
    workspaceId: string
    pollId: string
    taskId: string
    industryValue: string
    locationValue: string
    industryLabel: string
    countyLabel: string
    result: TdlrResult
}) {
    const displayName = companyNameFromTdlrName(result.name)
    const ownerName = ownerNameFromTdlrName(result.name)
    const sourceRecordId = result.profileUrl?.split("?")[1] || `${industryValue}:${locationValue}:${result.licenseNumber}`
    const { data: existingRecord, error: existingError } = await supabaseAdmin
        .from("leadgen_source_records")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("source_key", TDLR_SOURCE_KEY)
        .eq("source_record_id", sourceRecordId)
        .maybeSingle()
    if (existingError) throw existingError
    if (existingRecord) return false
    const address = {
        city: result.city,
        county: result.county || countyLabel,
        state: "TX",
        postcode: result.zip,
        country: "US",
    }
    const categories = [
        { key: "board", value: "Texas Department of Licensing and Regulation" },
        { key: "license_type", value: industryLabel },
        { key: "license_number", value: result.licenseNumber },
        ...(result.expirationDate ? [{ key: "expiration_date", value: result.expirationDate }] : []),
    ]
    const rawPayload = {
        source: "tdlr_license_search",
        license_number: result.licenseNumber,
        expiration_date: result.expirationDate,
        legal_name: result.name,
        parsed_company_name: displayName,
        parsed_owner_name: ownerName,
        city: result.city,
        county: result.county,
        zip: result.zip,
        phone: result.phone,
        profile_url: result.profileUrl,
        raw_html: result.rawHtml,
    }
    const { error: recordError } = await supabaseAdmin
        .from("leadgen_source_records")
        .insert({
            workspace_id: workspaceId,
            poll_id: pollId,
            task_id: taskId,
            source_key: TDLR_SOURCE_KEY,
            source_record_id: sourceRecordId,
            company_name: displayName,
            phone: result.phone,
            website_url: null,
            profile_url: result.profileUrl,
            address,
            latitude: null,
            longitude: null,
            categories,
            rating: null,
            review_count: null,
            raw_payload: rawPayload,
        })
    if (recordError) throw recordError
    const { data: company, error: companyError } = await supabaseAdmin
        .from("leadgen_companies")
        .upsert({
            workspace_id: workspaceId,
            canonical_name: canonicalName(displayName),
            display_name: displayName,
            phone: result.phone,
            website_domain: null,
            website_url: null,
            profile_url: result.profileUrl,
            source_key: TDLR_SOURCE_KEY,
            source_record_id: sourceRecordId,
            address,
            latitude: null,
            longitude: null,
            categories,
            rating: null,
            review_count: null,
            industry_value: industryValue,
            location_value: locationValue,
            owner_name: ownerName,
            owner_phone: ownerName ? result.phone : null,
            owner_source_key: ownerName ? TDLR_SOURCE_KEY : null,
            owner_confidence: ownerName && result.phone ? 78 : null,
            owner_evidence: ownerName ? {
                source: "tdlr_license_search",
                license_number: result.licenseNumber,
                legal_name: result.name,
                parsed_from: "tdlr_name_parenthetical",
                phone_source: result.phone ? "tdlr_license_phone" : null,
            } : {},
            first_seen_poll_id: pollId,
            last_seen_at: new Date().toISOString(),
        }, { onConflict: "workspace_id,source_key,source_record_id" })
        .select("id")
        .single()
    if (companyError) throw companyError
    if (company?.id) {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId: company.id,
            sourceKey: "state_license.tx.tdlr",
            claimKind: "licence_activity",
            pointsAwarded: 2,
            confidence: 80,
            provenanceUrl: result.profileUrl,
            claimValue: { license_number: result.licenseNumber, license_type: industryLabel, status: "active" },
            rawPayload,
        })
        if (ownerName) {
            await recordEvidenceClaim({
                workspaceId,
                pollId,
                companyId: company.id,
                sourceKey: "state_license.tx.tdlr",
                claimKind: "owner_identity",
                pointsAwarded: 3,
                confidence: result.phone ? 82 : 65,
                provenanceUrl: result.profileUrl,
                claimValue: { owner_name: ownerName, role: "license_holder", legal_name: result.name },
                rawPayload,
            })
        }
        if (ownerName && result.phone) {
            await recordEvidenceClaim({
                workspaceId,
                pollId,
                companyId: company.id,
                sourceKey: "state_license.tx.tdlr",
                claimKind: "owner_phone",
                pointsAwarded: 3,
                confidence: 82,
                provenanceUrl: result.profileUrl,
                claimValue: { owner_name: ownerName, owner_phone: result.phone, phone_source: "tdlr_license_phone" },
                rawPayload,
            })
        }
    }
    return true
}

async function applyTdlrEnrichmentToCompany({ workspaceId, pollId, companyId, result }: { workspaceId: string; pollId: string; companyId: string; result: TdlrResult }) {
    const ownerName = ownerNameFromTdlrName(result.name)
    const value = {
        source: "tdlr_license_search",
        license_number: result.licenseNumber,
        legal_name: result.name,
        parsed_owner_name: ownerName,
        phone: result.phone,
        profile_url: result.profileUrl,
    }
    const { error: evidenceError } = await supabaseAdmin.from("leadgen_evidence").insert({
            workspace_id: workspaceId,
            poll_id: pollId,
            company_id: companyId,
        source_key: TDLR_SOURCE_KEY,
        evidence_kind: "license_candidate_match",
        confidence: ownerName && result.phone ? 82 : result.phone ? 48 : 35,
        value,
        raw_payload: { ...value, raw_html: result.rawHtml },
    })
    if (evidenceError) throw evidenceError
    await recordEvidenceClaim({
        workspaceId,
        pollId,
        companyId,
        sourceKey: "state_license.tx.tdlr",
        claimKind: "licence_activity",
        pointsAwarded: 2,
        confidence: 80,
        provenanceUrl: result.profileUrl,
        claimValue: { license_number: result.licenseNumber, legal_name: result.name },
        rawPayload: { ...value, raw_html: result.rawHtml },
    })
    if (ownerName) {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId,
            sourceKey: "state_license.tx.tdlr",
            claimKind: "owner_identity",
            pointsAwarded: 3,
            confidence: result.phone ? 82 : 55,
            provenanceUrl: result.profileUrl,
            claimValue: { owner_name: ownerName, role: "license_holder", legal_name: result.name },
            rawPayload: { ...value, raw_html: result.rawHtml },
        })
    }
    if (ownerName && result.phone) {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId,
            sourceKey: "state_license.tx.tdlr",
            claimKind: "owner_phone",
            pointsAwarded: 3,
            confidence: 82,
            provenanceUrl: result.profileUrl,
            claimValue: { owner_name: ownerName, owner_phone: result.phone, phone_source: "tdlr_license_phone" },
            rawPayload: { ...value, raw_html: result.rawHtml },
        })
    }
    const updatePayload: Record<string, unknown> = {
        last_seen_at: new Date().toISOString(),
        profile_url: result.profileUrl,
    }
    if (result.phone) updatePayload.phone = result.phone
    if (ownerName) {
        updatePayload.owner_name = ownerName
        updatePayload.owner_source_key = TDLR_SOURCE_KEY
        updatePayload.owner_confidence = ownerName && result.phone ? 82 : 55
        updatePayload.owner_evidence = value
        if (result.phone) updatePayload.owner_phone = result.phone
    }
    const { error } = await supabaseAdmin.from("leadgen_companies").update(updatePayload).eq("id", companyId).eq("workspace_id", workspaceId)
    if (error) throw error
    await updateInvestigationTask({
        workspaceId,
        pollId,
        companyId,
        sourceKey: "state_license.tx.tdlr",
        status: "completed",
        matched: Boolean(ownerName || result.phone),
        ownerIdentityPoints: ownerName ? 3 : 0,
        ownerPhonePoints: ownerName && result.phone ? 3 : 0,
        businessSupportPoints: 2,
        rawPayload: { ...value, raw_html: result.rawHtml },
    })
    return Boolean(ownerName && result.phone)
}

async function applyDbprElectricalEnrichmentToCompany({ workspaceId, pollId, companyId, result }: { workspaceId: string; pollId: string; companyId: string; result: DbprLicenseResult }) {
    const rawPayload = {
        source: "fl_dbpr_electrical_public_records",
        license_number: result.licenseNumber,
        license_type: result.licenseType,
        owner_name: result.ownerName,
        business_name: result.businessName,
        status: result.status,
        expiration_date: result.expirationDate,
        address: result.address,
        profile_url: result.profileUrl,
        row: result.row,
    }
    await supabaseAdmin.from("leadgen_evidence").insert({
        workspace_id: workspaceId,
        poll_id: pollId,
        company_id: companyId,
        source_key: FL_DBPR_ELECTRICAL_SOURCE_KEY,
        evidence_kind: "license_candidate_match",
        confidence: result.ownerName ? 82 : 55,
        value: rawPayload,
        raw_payload: rawPayload,
    })
    await recordEvidenceClaim({
        workspaceId,
        pollId,
        companyId,
        sourceKey: "state_license.fl.electrical",
        claimKind: "licence_activity",
        pointsAwarded: 2,
        confidence: 82,
        provenanceUrl: result.profileUrl,
        claimValue: { license_number: result.licenseNumber, license_type: result.licenseType, status: result.status },
        rawPayload,
    })
    if (result.ownerName) {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId,
            sourceKey: "state_license.fl.electrical",
            claimKind: "owner_identity",
            pointsAwarded: 3,
            confidence: 82,
            provenanceUrl: result.profileUrl,
            claimValue: { owner_name: result.ownerName, role: "licensee", legal_name: result.businessName },
            rawPayload,
        })
    }
    if (result.ownerName && result.phone) {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId,
            sourceKey: "state_license.fl.electrical",
            claimKind: "owner_phone",
            pointsAwarded: 3,
            confidence: 82,
            provenanceUrl: result.profileUrl,
            claimValue: { owner_name: result.ownerName, owner_phone: result.phone, phone_source: "dbpr_license_phone" },
            rawPayload,
        })
    }
    const updatePayload: Record<string, unknown> = {
        last_seen_at: new Date().toISOString(),
        profile_url: result.profileUrl,
        owner_evidence: rawPayload,
    }
    if (result.ownerName) {
        updatePayload.owner_name = result.ownerName
        updatePayload.owner_source_key = FL_DBPR_ELECTRICAL_SOURCE_KEY
        updatePayload.owner_confidence = result.phone ? 82 : 72
    }
    if (result.phone) {
        updatePayload.phone = result.phone
        if (result.ownerName) updatePayload.owner_phone = result.phone
    }
    const { error } = await supabaseAdmin.from("leadgen_companies").update(updatePayload).eq("id", companyId).eq("workspace_id", workspaceId)
    if (error) throw error
    await updateInvestigationTask({
        workspaceId,
        pollId,
        companyId,
        sourceKey: "state_license.fl.electrical",
        status: "completed",
        matched: Boolean(result.ownerName || result.phone),
        ownerIdentityPoints: result.ownerName ? 3 : 0,
        ownerPhonePoints: result.ownerName && result.phone ? 3 : 0,
        businessSupportPoints: 2,
        rawPayload,
    })
    return Boolean(result.ownerName && result.phone)
}

async function applyNcGeneralEnrichmentToCompany({ workspaceId, pollId, companyId, result }: { workspaceId: string; pollId: string; companyId: string; result: NcLicenseResult }) {
    const rawPayload = {
        source: "nc_general_contractor_public_search",
        license_number: result.licenseNumber,
        owner_name: result.ownerName,
        phone: result.phone,
        status: result.status,
        classifications: result.classifications,
        detail_url: result.detailUrl,
        active: result.active,
        raw_search_row: result.rawSearchRow,
        raw_detail_html: result.rawDetailHtml,
    }
    await supabaseAdmin.from("leadgen_evidence").insert({
        workspace_id: workspaceId,
        poll_id: pollId,
        company_id: companyId,
        source_key: NC_GENERAL_CONTRACTORS_SOURCE_KEY,
        evidence_kind: "license_candidate_match",
        confidence: result.ownerName && result.phone ? 84 : result.ownerName ? 72 : 45,
        value: rawPayload,
        raw_payload: rawPayload,
    })
    await recordEvidenceClaim({
        workspaceId,
        pollId,
        companyId,
        sourceKey: "state_license.nc.general_contractors",
        claimKind: "licence_activity",
        pointsAwarded: 2,
        confidence: 82,
        provenanceUrl: result.detailUrl,
        claimValue: { license_number: result.licenseNumber, status: result.status, classifications: result.classifications },
        rawPayload,
    })
    if (result.ownerName) {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId,
            sourceKey: "state_license.nc.general_contractors",
            claimKind: "owner_identity",
            pointsAwarded: 3,
            confidence: result.phone ? 84 : 72,
            provenanceUrl: result.detailUrl,
            claimValue: { owner_name: result.ownerName, role: "licensee" },
            rawPayload,
        })
    }
    if (result.ownerName && result.phone) {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId,
            sourceKey: "state_license.nc.general_contractors",
            claimKind: "owner_phone",
            pointsAwarded: 3,
            confidence: 84,
            provenanceUrl: result.detailUrl,
            claimValue: { owner_name: result.ownerName, owner_phone: result.phone, phone_source: "nc_license_phone" },
            rawPayload,
        })
    }
    const updatePayload: Record<string, unknown> = {
        last_seen_at: new Date().toISOString(),
        profile_url: result.detailUrl,
        owner_evidence: rawPayload,
    }
    if (result.ownerName) {
        updatePayload.owner_name = result.ownerName
        updatePayload.owner_source_key = NC_GENERAL_CONTRACTORS_SOURCE_KEY
        updatePayload.owner_confidence = result.phone ? 84 : 72
    }
    if (result.phone) {
        updatePayload.phone = result.phone
        if (result.ownerName) updatePayload.owner_phone = result.phone
    }
    const { error } = await supabaseAdmin.from("leadgen_companies").update(updatePayload).eq("id", companyId).eq("workspace_id", workspaceId)
    if (error) throw error
    await updateInvestigationTask({
        workspaceId,
        pollId,
        companyId,
        sourceKey: "state_license.nc.general_contractors",
        status: "completed",
        matched: Boolean(result.ownerName || result.phone),
        ownerIdentityPoints: result.ownerName ? 3 : 0,
        ownerPhonePoints: result.ownerName && result.phone ? 3 : 0,
        businessSupportPoints: 2,
        rawPayload,
    })
    return Boolean(result.ownerName && result.phone)
}

export async function createStateLicensingTasksForPoll({ workspaceId, pollId, plan }: { workspaceId: string; pollId: string; plan: LeadgenSourcePlanItem }) {
    if (plan.key !== "state_licensing" && plan.key !== TDLR_SOURCE_KEY) return 0
    const mappingSourceKey = plan.key === "state_licensing" ? "state_licensing" : TDLR_SOURCE_KEY
    const [industryMappingsResult, locationMappingsResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_source_industry_mappings")
            .select("icp_industry_value, native_values")
            .eq("source_key", mappingSourceKey)
            .eq("enabled", true)
            .in("icp_industry_value", plan.industries),
        supabaseAdmin
            .from("leadgen_source_location_mappings")
            .select("icp_location_value, native_values")
            .eq("source_key", mappingSourceKey)
            .eq("enabled", true)
            .in("icp_location_value", plan.locations),
    ])
    if (industryMappingsResult.error) throw new Error(`Could not load state licensing industry mappings: ${industryMappingsResult.error.message}`)
    if (locationMappingsResult.error) throw new Error(`Could not load state licensing location mappings: ${locationMappingsResult.error.message}`)
    const industryMappings = (industryMappingsResult.data ?? []) as SourceIndustryMapping[]
    const locationMappings = (locationMappingsResult.data ?? []) as SourceLocationMapping[]
    const nativeIndustries = [...new Set(industryMappings.flatMap((mapping) => Array.isArray(mapping.native_values) ? mapping.native_values : []))]
    const nativeLocations = [...new Set(locationMappings.flatMap((mapping) => Array.isArray(mapping.native_values) ? mapping.native_values : []))]
    if (nativeIndustries.length === 0 || nativeLocations.length === 0) return 0
    const [industriesResult, locationsResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_source_options")
            .select("value, label, metadata")
            .eq("source_key", "state_licensing")
            .eq("option_kind", "industry")
            .eq("enabled", true)
            .in("value", nativeIndustries),
        supabaseAdmin
            .from("leadgen_source_options")
            .select("value, label, metadata")
            .eq("source_key", "state_licensing")
            .eq("option_kind", "location")
            .eq("enabled", true)
            .in("value", nativeLocations),
    ])
    if (industriesResult.error) throw new Error(`Could not load state licensing industries: ${industriesResult.error.message}`)
    if (locationsResult.error) throw new Error(`Could not load state licensing locations: ${locationsResult.error.message}`)
    const industries = (industriesResult.data ?? []) as SourceOption[]
    const locations = (locationsResult.data ?? []) as SourceOption[]
    const industryByValue = new Map(industries.map((industry) => [industry.value, industry]))
    const locationByValue = new Map(locations.map((location) => [location.value, location]))
    const limit = Math.min(25, Math.max(1, plan.limit ?? 15))
    const tasks = industryMappings.flatMap((industryMapping) => (industryMapping.native_values ?? []).flatMap((nativeIndustry) => {
        const industry = industryByValue.get(nativeIndustry)
        if (!industry) return []
        const mapping = tdlrMapping(industry)
        if (!mapping) return []
        return locationMappings.flatMap((locationMapping) => (locationMapping.native_values ?? []).flatMap((nativeLocation) => {
            const location = locationByValue.get(nativeLocation)
            if (!location) return []
            return [{
                poll_id: pollId,
                workspace_id: workspaceId,
                source_key: TDLR_SOURCE_KEY,
                industry_value: industryMapping.icp_industry_value,
                location_value: locationMapping.icp_location_value,
                status: "queued",
                source_query: {
                    board: "tdlr",
                    board_label: "Texas Department of Licensing and Regulation",
                    native_industry_value: industry.value,
                    native_location_value: location.value,
                    tdlr_status: mapping.status,
                    tdlr_endorsement: mapping.endorsement ?? null,
                    industry_label: industry.label,
                    county: tdlrCounty(location),
                    location_label: location.label,
                    limit,
                },
            }]
        }))
    }))
    if (tasks.length === 0) return 0
    const { error } = await supabaseAdmin.from("leadgen_poll_tasks").insert(tasks)
    if (error) throw error
    return tasks.length
}

export async function createStateLicensingEnrichmentTasksForPoll({ workspaceId, pollId, plan }: { workspaceId: string; pollId: string; plan: LeadgenSourcePlanItem }) {
    if (!STATE_LICENSE_SOURCE_KEYS.includes(plan.key)) return 0
    const sourceKey = plan.key === "state_licensing" ? TDLR_SOURCE_KEY : plan.key
    const candidatesResult = await supabaseAdmin
        .from("leadgen_companies")
        .select("id, display_name, phone, address, industry_value, location_value")
        .eq("workspace_id", workspaceId)
        .eq("first_seen_poll_id", pollId)
        .is("owner_phone", null)
        .limit(Math.min(80, Math.max(1, plan.limit ?? 30)))
    if (candidatesResult.error) throw new Error(`Could not load candidates for state licensing enrichment: ${candidatesResult.error.message}`)
    const candidates = (candidatesResult.data ?? []) as CompanyCandidate[]
    if (candidates.length === 0) return 0
    const [industryMappingsResult, locationMappingsResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_source_industry_mappings")
            .select("icp_industry_value, native_values")
            .eq("source_key", plan.key === "state_licensing" ? "state_licensing" : sourceKey)
            .eq("enabled", true)
            .in("icp_industry_value", plan.industries),
        supabaseAdmin
            .from("leadgen_source_location_mappings")
            .select("icp_location_value, native_values")
            .eq("source_key", plan.key === "state_licensing" ? "state_licensing" : sourceKey)
            .eq("enabled", true)
            .in("icp_location_value", plan.locations),
    ])
    if (industryMappingsResult.error) throw new Error(`Could not load state licensing enrichment industry mappings: ${industryMappingsResult.error.message}`)
    if (locationMappingsResult.error) throw new Error(`Could not load state licensing enrichment location mappings: ${locationMappingsResult.error.message}`)
    const industryMappings = (industryMappingsResult.data ?? []) as SourceIndustryMapping[]
    const locationMappings = (locationMappingsResult.data ?? []) as SourceLocationMapping[]
    const mappedIndustries = new Set(industryMappings.map((mapping) => mapping.icp_industry_value))
    const mappedLocations = new Set(locationMappings.map((mapping) => mapping.icp_location_value))
    const nativeIndustries = [...new Set(industryMappings.flatMap((mapping) => Array.isArray(mapping.native_values) ? mapping.native_values : []))]
    const nativeLocations = [...new Set(locationMappings.flatMap((mapping) => Array.isArray(mapping.native_values) ? mapping.native_values : []))]
    let industries: SourceOption[] = []
    let locations: SourceOption[] = []
    if (sourceKey === TDLR_SOURCE_KEY && nativeIndustries.length > 0 && nativeLocations.length > 0) {
        const [industriesResult, locationsResult] = await Promise.all([
            supabaseAdmin.from("leadgen_source_options").select("value, label, metadata").eq("source_key", "state_licensing").eq("option_kind", "industry").eq("enabled", true).in("value", nativeIndustries),
            supabaseAdmin.from("leadgen_source_options").select("value, label, metadata").eq("source_key", "state_licensing").eq("option_kind", "location").eq("enabled", true).in("value", nativeLocations),
        ])
        if (industriesResult.error) throw new Error(`Could not load state licensing enrichment industries: ${industriesResult.error.message}`)
        if (locationsResult.error) throw new Error(`Could not load state licensing enrichment locations: ${locationsResult.error.message}`)
        industries = ((industriesResult.data ?? []) as SourceOption[]).filter((industry) => Boolean(tdlrMapping(industry))).slice(0, 4)
        locations = ((locationsResult.data ?? []) as SourceOption[]).slice(0, 6)
    }
    const tasks: Array<{
        poll_id: string
        workspace_id: string
        source_key: string
        stage: string
        industry_value: string | null
        location_value: string | null
        status: string
        source_query: Record<string, unknown>
    }> = sourceKey === TDLR_SOURCE_KEY ? candidates.flatMap((candidate) => industries.flatMap((industry) => {
        if (candidateState(candidate) !== "TX") return []
        if (!mappedIndustries.has(candidate.industry_value ?? "") || !mappedLocations.has(candidate.location_value ?? "")) return []
        const mapping = tdlrMapping(industry)
        if (!mapping) return []
        return locations.map((location) => ({
            poll_id: pollId,
            workspace_id: workspaceId,
            source_key: TDLR_SOURCE_KEY,
            stage: "licensing_candidate_enrichment",
            industry_value: candidate.industry_value ?? industry.value,
            location_value: candidate.location_value ?? location.value,
            status: "queued",
            source_query: {
                board: "tdlr",
                board_label: "Texas Department of Licensing and Regulation",
                candidate_company_id: candidate.id,
                candidate_company_name: candidate.display_name,
                tdlr_status: mapping.status,
                tdlr_endorsement: mapping.endorsement ?? null,
                industry_label: industry.label,
                county: tdlrCounty(location),
                location_label: location.label,
                limit: 5,
            },
        }))
    })) : []
    const dbprElectricalTasks = sourceKey === FL_DBPR_ELECTRICAL_SOURCE_KEY ? candidates
        .filter((candidate) => candidateState(candidate) === "FL")
        .filter((candidate) => mappedIndustries.has(candidate.industry_value ?? "") && mappedLocations.has(candidate.location_value ?? ""))
        .filter((candidate) => DBPR_ELECTRICAL_INDUSTRIES.has(candidate.industry_value ?? ""))
        .map((candidate) => ({
            poll_id: pollId,
            workspace_id: workspaceId,
            source_key: FL_DBPR_ELECTRICAL_SOURCE_KEY,
            stage: "licensing_candidate_enrichment",
            industry_value: candidate.industry_value,
            location_value: candidate.location_value,
            status: "queued",
            source_query: {
                board: "fl_dbpr_electrical",
                board_label: "Florida DBPR Electrical Contractors Licensing Board",
                adapter_source_key: "state_license.fl.electrical",
                candidate_company_id: candidate.id,
                candidate_company_name: candidate.display_name,
                candidate_state: "FL",
                candidate_city: candidateCity(candidate),
                candidate_postcode: candidatePostcode(candidate),
                file_url: DBPR_ELECTRICAL_CSV_URL,
                limit: 3,
            },
        })) : []
    const ncGeneralTasks = sourceKey === NC_GENERAL_CONTRACTORS_SOURCE_KEY ? candidates
        .filter((candidate) => candidateState(candidate) === "NC")
        .filter((candidate) => mappedIndustries.has(candidate.industry_value ?? "") && mappedLocations.has(candidate.location_value ?? ""))
        .flatMap((candidate) => {
            const classifications = NC_CLASSIFICATIONS_BY_INDUSTRY[candidate.industry_value ?? ""] ?? []
            if (classifications.length === 0) return []
            return classifications.slice(0, 3).map((classificationId) => ({
                poll_id: pollId,
                workspace_id: workspaceId,
                source_key: NC_GENERAL_CONTRACTORS_SOURCE_KEY,
                stage: "licensing_candidate_enrichment",
                industry_value: candidate.industry_value,
                location_value: candidate.location_value,
                status: "queued",
                source_query: {
                    board: "nc_general_contractors",
                    board_label: "North Carolina Licensing Board for General Contractors",
                    adapter_source_key: "state_license.nc.general_contractors",
                    candidate_company_id: candidate.id,
                    candidate_company_name: candidate.display_name,
                    candidate_state: "NC",
                    candidate_city: candidateCity(candidate),
                    candidate_postcode: candidatePostcode(candidate),
                    classification_id: classificationId,
                    limit: 3,
                },
            }))
        }) : []
    tasks.push(...dbprElectricalTasks, ...ncGeneralTasks)
    if (tasks.length === 0) return 0
    const { error } = await supabaseAdmin.from("leadgen_poll_tasks").insert(tasks)
    if (error) throw error
    return tasks.length
}

async function processTdlrTask({ task, workspaceId, pollId }: { task: LicensingTask; workspaceId: string; pollId: string }) {
    const query = task.source_query as {
        tdlr_status?: string
        tdlr_endorsement?: string | null
        county?: string
        industry_label?: string
        location_label?: string
        limit?: number
        candidate_company_id?: string
        candidate_company_name?: string
    }
    if (!query.tdlr_status || !query.county) throw new Error("Missing TDLR license type or county in source task.")
    const html = await fetchTdlrSearch({ status: query.tdlr_status, endorsement: query.tdlr_endorsement ?? undefined, county: query.county, name: query.candidate_company_name })
    const results = parseTdlrRows(html, Math.min(25, Math.max(1, Number(query.limit) || 15)))
    let companyCount = 0
    if (query.candidate_company_id) {
        const bestResult = results.find((result) => result.phone) ?? results[0]
        if (bestResult) {
            const qualified = await applyTdlrEnrichmentToCompany({ workspaceId, pollId, companyId: query.candidate_company_id, result: bestResult })
            companyCount = qualified ? 1 : 0
        } else {
            await updateInvestigationTask({
                workspaceId,
                pollId,
                companyId: query.candidate_company_id,
                sourceKey: "state_license.tx.tdlr",
                status: "completed",
                matched: false,
                skipReason: "TDLR returned no candidate match for this business.",
            })
        }
    } else {
        for (const result of results) {
            const stored = await upsertTdlrRecord({
                workspaceId,
                pollId,
                taskId: task.id,
                industryValue: task.industry_value ?? "",
                locationValue: task.location_value ?? "",
                industryLabel: query.industry_label ?? task.industry_value ?? "State license",
                countyLabel: query.location_label ?? query.county,
                result,
            })
            if (stored) companyCount += 1
        }
    }
    return { rawCount: results.length, companyCount }
}

async function processDbprElectricalTask({ task, workspaceId, pollId }: { task: LicensingTask; workspaceId: string; pollId: string }) {
    const query = task.source_query as {
        candidate_company_id?: string
        candidate_company_name?: string
        limit?: number
        file_url?: string
    }
    if (!query.candidate_company_id || !query.candidate_company_name) throw new Error("Florida DBPR task is missing a candidate company.")
    await updateInvestigationTask({ workspaceId, pollId, companyId: query.candidate_company_id, sourceKey: "state_license.fl.electrical", status: "running" })
    const csv = await fetchCachedCsv(query.file_url || DBPR_ELECTRICAL_CSV_URL)
    if (!csv.trim()) throw new Error("Florida DBPR electrical public records CSV was empty.")
    const candidate: CompanyCandidate = {
        id: query.candidate_company_id,
        display_name: query.candidate_company_name,
        phone: null,
        address: {
            state: "FL",
            city: asString(task.source_query?.candidate_city),
            postcode: asString(task.source_query?.candidate_postcode),
        },
        industry_value: task.industry_value,
        location_value: task.location_value,
    }
    const results = parseDbprElectricalRows(csv, candidate, Math.min(10, Math.max(1, Number(query.limit) || 3)))
    if (results.length === 0) {
        await updateInvestigationTask({
            workspaceId,
            pollId,
            companyId: query.candidate_company_id,
            sourceKey: "state_license.fl.electrical",
            status: "completed",
            matched: false,
            skipReason: "Florida DBPR electrical public records returned no active license match for this candidate.",
        })
        return { rawCount: 0, companyCount: 0 }
    }
    const bestResult = results[0]
    const qualified = await applyDbprElectricalEnrichmentToCompany({ workspaceId, pollId, companyId: query.candidate_company_id, result: bestResult })
    return { rawCount: results.length, companyCount: qualified ? 1 : 0 }
}

async function processNcGeneralTask({ task, workspaceId, pollId }: { task: LicensingTask; workspaceId: string; pollId: string }) {
    const query = task.source_query as {
        candidate_company_id?: string
        candidate_company_name?: string
        classification_id?: string
        limit?: number
    }
    if (!query.candidate_company_id || !query.candidate_company_name) throw new Error("NC general contractor task is missing a candidate company.")
    await updateInvestigationTask({ workspaceId, pollId, companyId: query.candidate_company_id, sourceKey: "state_license.nc.general_contractors", status: "running" })
    const searchTerm = firstSearchTerm(query.candidate_company_name)
    if (!searchTerm) throw new Error("NC general contractor task could not build a candidate company search term.")
    const html = await fetchNcGeneralSearch({ companyName: searchTerm, classificationId: query.classification_id })
    const rows = parseNcSearchRows(html, Math.min(10, Math.max(1, Number(query.limit) || 3)))
    if (rows.length === 0) {
        await updateInvestigationTask({
            workspaceId,
            pollId,
            companyId: query.candidate_company_id,
            sourceKey: "state_license.nc.general_contractors",
            status: "completed",
            matched: false,
            skipReason: `NC general contractors returned no active license match for "${searchTerm}".`,
        })
        return { rawCount: 0, companyCount: 0 }
    }
    for (const row of rows) {
        const detail = await fetchNcGeneralDetail(row.key)
        if (!detail.active) continue
        const result: NcLicenseResult = {
            licenseNumber: detail.licenseNumber || row.licenseNumber,
            ownerName: detail.ownerName || row.ownerName,
            phone: detail.phone,
            status: detail.status,
            classifications: detail.classifications,
            active: detail.active,
            detailUrl: detail.detailUrl,
            rawSearchRow: row.rawSearchRow,
            rawDetailHtml: detail.rawDetailHtml,
        }
        const qualified = await applyNcGeneralEnrichmentToCompany({ workspaceId, pollId, companyId: query.candidate_company_id, result })
        return { rawCount: rows.length, companyCount: qualified ? 1 : 0 }
    }
    await updateInvestigationTask({
        workspaceId,
        pollId,
        companyId: query.candidate_company_id,
        sourceKey: "state_license.nc.general_contractors",
        status: "completed",
        matched: false,
        skipReason: "NC general contractors returned results, but none were active after detail lookup.",
    })
    return { rawCount: rows.length, companyCount: 0 }
}

export async function processStateLicensingPoll(pollId: string, workspaceId: string, options: { finalize?: boolean } = {}) {
    await setLeadgenPollStatus(pollId, workspaceId, "running")
    const tasksResult = await supabaseAdmin
        .from("leadgen_poll_tasks")
        .select("id, source_key, industry_value, location_value, source_query")
        .eq("poll_id", pollId)
        .eq("workspace_id", workspaceId)
        .in("source_key", STATE_LICENSE_SOURCE_KEYS)
        .eq("status", "queued")
        .order("created_at", { ascending: true })
    if (tasksResult.error) {
        await setLeadgenPollStatus(pollId, workspaceId, "failed", `Could not load state licensing tasks: ${tasksResult.error.message}`)
        return
    }
    const tasks = (tasksResult.data ?? []) as LicensingTask[]
    if (tasks.length === 0) {
        if (options.finalize !== false) await setLeadgenPollStatus(pollId, workspaceId, "failed", "No queued state licensing tasks were available for this poll.")
        return
    }
    for (const task of tasks) {
        await supabaseAdmin.from("leadgen_poll_tasks").update({ status: "running", started_at: new Date().toISOString(), error: null }).eq("id", task.id)
        try {
            const board = typeof task.source_query?.board === "string" ? task.source_query.board : "tdlr"
            const { rawCount, companyCount } = board === "fl_dbpr_electrical"
                ? await processDbprElectricalTask({ task, workspaceId, pollId })
                : board === "nc_general_contractors"
                    ? await processNcGeneralTask({ task, workspaceId, pollId })
                    : await processTdlrTask({ task, workspaceId, pollId })
            await supabaseAdmin
                .from("leadgen_poll_tasks")
                .update({ status: "completed", raw_count: rawCount, company_count: companyCount, completed_at: new Date().toISOString(), error: null })
                .eq("id", task.id)
        } catch (error) {
            await supabaseAdmin
                .from("leadgen_poll_tasks")
                .update({ status: "failed", completed_at: new Date().toISOString(), error: compactErrorMessage(error) })
                .eq("id", task.id)
        }
        await sleep(STATE_LICENSING_REQUEST_DELAY_MS)
    }
    await refreshLeadgenPollCounts(pollId, workspaceId)
}
