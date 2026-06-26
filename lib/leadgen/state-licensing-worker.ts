import { supabaseAdmin } from "@/lib/supabase/admin"
import type { LeadgenSourcePlanItem } from "@/lib/leadgen/sources"
import { refreshLeadgenPollCounts, setLeadgenPollStatus } from "@/lib/leadgen/osm-worker"

type SourceOption = {
    value: string
    label: string
    metadata: Record<string, unknown> | null
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

async function fetchTdlrSearch({ status, endorsement, county }: { status: string; endorsement?: string; county: string }) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TDLR_FETCH_TIMEOUT_MS)
    const body = new URLSearchParams({
        tdlr_status: status,
        pht_lic: "",
        pht_expdt: "",
        pht_oth_name: "",
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
    const sourceRecordId = result.profileUrl?.split("?")[1] || `${industryValue}:${locationValue}:${result.licenseNumber}`
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
        city: result.city,
        county: result.county,
        zip: result.zip,
        phone: result.phone,
        profile_url: result.profileUrl,
        raw_html: result.rawHtml,
    }
    const { error: recordError } = await supabaseAdmin
        .from("leadgen_source_records")
        .upsert({
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
        }, { onConflict: "workspace_id,source_key,source_record_id" })
    if (recordError) throw recordError
    const { error: companyError } = await supabaseAdmin
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
            first_seen_poll_id: pollId,
            last_seen_at: new Date().toISOString(),
        }, { onConflict: "workspace_id,source_key,source_record_id" })
    if (companyError) throw companyError
    return true
}

export async function createStateLicensingTasksForPoll({ workspaceId, pollId, plan }: { workspaceId: string; pollId: string; plan: LeadgenSourcePlanItem }) {
    if (plan.key !== "state_licensing") return 0
    const [industriesResult, locationsResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_source_options")
            .select("value, label, metadata")
            .eq("source_key", "state_licensing")
            .eq("option_kind", "industry")
            .eq("enabled", true)
            .in("value", plan.industries),
        supabaseAdmin
            .from("leadgen_source_options")
            .select("value, label, metadata")
            .eq("source_key", "state_licensing")
            .eq("option_kind", "location")
            .eq("enabled", true)
            .in("value", plan.locations),
    ])
    if (industriesResult.error) throw new Error(`Could not load state licensing industries: ${industriesResult.error.message}`)
    if (locationsResult.error) throw new Error(`Could not load state licensing locations: ${locationsResult.error.message}`)
    const industries = (industriesResult.data ?? []) as SourceOption[]
    const locations = (locationsResult.data ?? []) as SourceOption[]
    const limit = Math.min(25, Math.max(1, plan.limit ?? 15))
    const tasks = industries.flatMap((industry) => {
        const mapping = tdlrMapping(industry)
        if (!mapping) return []
        return locations.map((location) => ({
            poll_id: pollId,
            workspace_id: workspaceId,
            source_key: "state_licensing",
            industry_value: industry.value,
            location_value: location.value,
            status: "queued",
            source_query: {
                board: "tdlr",
                board_label: "Texas Department of Licensing and Regulation",
                tdlr_status: mapping.status,
                tdlr_endorsement: mapping.endorsement ?? null,
                industry_label: industry.label,
                county: tdlrCounty(location),
                location_label: location.label,
                limit,
            },
        }))
    })
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
            }
            if (!query.tdlr_status || !query.county) throw new Error("Missing TDLR license type or county in source task.")
            const html = await fetchTdlrSearch({ status: query.tdlr_status, endorsement: query.tdlr_endorsement ?? undefined, county: query.county })
            const results = parseTdlrRows(html, Math.min(25, Math.max(1, Number(query.limit) || 15)))
            let companyCount = 0
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
