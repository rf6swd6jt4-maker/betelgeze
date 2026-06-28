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

const TDLR_SEARCH_URL = "https://www.tdlr.texas.gov/LicenseSearch/SearchResultsListBrowse.asp?from=search"
const TDLR_DETAIL_BASE_URL = "https://www.tdlr.texas.gov/LicenseSearch/"
const TDLR_FETCH_TIMEOUT_MS = 22000
const TDLR_REQUEST_DELAY_MS = 1200

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
        .eq("source_key", "state_licensing")
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
            source_key: "state_licensing",
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
            source_key: "state_licensing",
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
            owner_source_key: ownerName ? "state_licensing" : null,
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
        source_key: "state_licensing",
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
        updatePayload.owner_source_key = "state_licensing"
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

export async function createStateLicensingTasksForPoll({ workspaceId, pollId, plan }: { workspaceId: string; pollId: string; plan: LeadgenSourcePlanItem }) {
    if (plan.key !== "state_licensing") return 0
    const [industryMappingsResult, locationMappingsResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_source_industry_mappings")
            .select("icp_industry_value, native_values")
            .eq("source_key", "state_licensing")
            .eq("enabled", true)
            .in("icp_industry_value", plan.industries),
        supabaseAdmin
            .from("leadgen_source_location_mappings")
            .select("icp_location_value, native_values")
            .eq("source_key", "state_licensing")
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
                source_key: "state_licensing",
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
    if (plan.key !== "state_licensing") return 0
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
            .eq("source_key", "state_licensing")
            .eq("enabled", true)
            .in("icp_industry_value", plan.industries),
        supabaseAdmin
            .from("leadgen_source_location_mappings")
            .select("icp_location_value, native_values")
            .eq("source_key", "state_licensing")
            .eq("enabled", true)
            .in("icp_location_value", plan.locations),
    ])
    if (industryMappingsResult.error) throw new Error(`Could not load state licensing enrichment industry mappings: ${industryMappingsResult.error.message}`)
    if (locationMappingsResult.error) throw new Error(`Could not load state licensing enrichment location mappings: ${locationMappingsResult.error.message}`)
    const industryMappings = (industryMappingsResult.data ?? []) as SourceIndustryMapping[]
    const locationMappings = (locationMappingsResult.data ?? []) as SourceLocationMapping[]
    const nativeIndustries = [...new Set(industryMappings.flatMap((mapping) => Array.isArray(mapping.native_values) ? mapping.native_values : []))]
    const nativeLocations = [...new Set(locationMappings.flatMap((mapping) => Array.isArray(mapping.native_values) ? mapping.native_values : []))]
    if (nativeIndustries.length === 0 || nativeLocations.length === 0) return 0
    const [industriesResult, locationsResult] = await Promise.all([
        supabaseAdmin.from("leadgen_source_options").select("value, label, metadata").eq("source_key", "state_licensing").eq("option_kind", "industry").eq("enabled", true).in("value", nativeIndustries),
        supabaseAdmin.from("leadgen_source_options").select("value, label, metadata").eq("source_key", "state_licensing").eq("option_kind", "location").eq("enabled", true).in("value", nativeLocations),
    ])
    if (industriesResult.error) throw new Error(`Could not load state licensing enrichment industries: ${industriesResult.error.message}`)
    if (locationsResult.error) throw new Error(`Could not load state licensing enrichment locations: ${locationsResult.error.message}`)
    const industries = ((industriesResult.data ?? []) as SourceOption[]).filter((industry) => Boolean(tdlrMapping(industry))).slice(0, 4)
    const locations = ((locationsResult.data ?? []) as SourceOption[]).slice(0, 6)
    const tasks = candidates.flatMap((candidate) => industries.flatMap((industry) => {
        const mapping = tdlrMapping(industry)
        if (!mapping) return []
        return locations.map((location) => ({
            poll_id: pollId,
            workspace_id: workspaceId,
            source_key: "state_licensing",
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
    }))
    if (tasks.length === 0) return 0
    const { error } = await supabaseAdmin.from("leadgen_poll_tasks").insert(tasks)
    if (error) throw error
    return tasks.length
}

export async function processStateLicensingPoll(pollId: string, workspaceId: string, options: { finalize?: boolean } = {}) {
    await setLeadgenPollStatus(pollId, workspaceId, "running")
    const tasksResult = await supabaseAdmin
        .from("leadgen_poll_tasks")
        .select("id, industry_value, location_value, source_query")
        .eq("poll_id", pollId)
        .eq("workspace_id", workspaceId)
        .eq("source_key", "state_licensing")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
    if (tasksResult.error) {
        await setLeadgenPollStatus(pollId, workspaceId, "failed", `Could not load state licensing tasks: ${tasksResult.error.message}`)
        return
    }
    const tasks = tasksResult.data ?? []
    if (tasks.length === 0) {
        if (options.finalize !== false) await setLeadgenPollStatus(pollId, workspaceId, "failed", "No queued state licensing tasks were available for this poll.")
        return
    }
    for (const task of tasks) {
        await supabaseAdmin.from("leadgen_poll_tasks").update({ status: "running", started_at: new Date().toISOString(), error: null }).eq("id", task.id)
        try {
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
                        industryValue: task.industry_value,
                        locationValue: task.location_value,
                        industryLabel: query.industry_label ?? task.industry_value,
                        countyLabel: query.location_label ?? query.county,
                        result,
                    })
                    if (stored) companyCount += 1
                }
            }
            await supabaseAdmin
                .from("leadgen_poll_tasks")
                .update({ status: "completed", raw_count: results.length, company_count: companyCount, completed_at: new Date().toISOString(), error: null })
                .eq("id", task.id)
        } catch (error) {
            await supabaseAdmin
                .from("leadgen_poll_tasks")
                .update({ status: "failed", completed_at: new Date().toISOString(), error: compactErrorMessage(error) })
                .eq("id", task.id)
        }
        await sleep(TDLR_REQUEST_DELAY_MS)
    }
    await refreshLeadgenPollCounts(pollId, workspaceId)
}
