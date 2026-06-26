import { supabaseAdmin } from "@/lib/supabase/admin"
import type { LeadgenSourceKey, LeadgenSourcePlanItem } from "@/lib/leadgen/sources"
import { refreshLeadgenPollCounts, setLeadgenPollStatus } from "@/lib/leadgen/osm-worker"

type CompanySeed = {
    id: string
    display_name: string
    phone: string | null
    website_url: string | null
    profile_url: string | null
    source_key: string
    source_record_id: string
}

type PageExtraction = {
    url: string
    owner_name: string | null
    phone: string | null
    phones: string[]
    evidence: string[]
}

type PipelineTask = {
    id: string
    source_key: LeadgenSourceKey
    source_query: Record<string, unknown>
}

const SOURCE_STAGE: Partial<Record<LeadgenSourceKey, string>> = {
    overture: "candidate_seed",
    website: "owner_phone_extraction",
    opencorporates: "registry_enrichment",
    sam_gov: "sam_enrichment",
}

function compactErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "Leadgen source task failed."
    return message.length > 900 ? `${message.slice(0, 900)}…` : message
}

function normalisePhone(value: string | null | undefined) {
    const raw = value?.trim()
    if (!raw) return null
    const digits = raw.replace(/\D/g, "")
    if (digits.length === 10) return `+1${digits}`
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
    return digits.length >= 8 ? `+${digits}` : null
}

function uniqueValues(values: Array<string | null | undefined>) {
    return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function extractPhones(text: string) {
    const candidates = [
        ...text.matchAll(/href=["']tel:([^"']+)["']/gi),
        ...text.matchAll(/telephone["']?\s*[:=]\s*["']([^"']+)["']/gi),
        ...text.matchAll(/phone["']?\s*[:=]\s*["']([^"']+)["']/gi),
        ...text.matchAll(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g),
    ]
        .map((match) => normalisePhone(match[1] ?? match[0]))
        .filter((phone): phone is string => Boolean(phone))
    return uniqueValues(candidates)
}

function extractOwnerName(text: string) {
    const patterns = [
        /\b(?:owner|founder|principal|president|managing partner|operator)\s*[:\-–]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i,
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*,?\s+(?:owner|founder|principal|president|managing partner|operator)\b/i,
        /\bmeet\s+(?:the\s+owner|our\s+owner)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i,
    ]
    for (const pattern of patterns) {
        const match = text.match(pattern)
        const value = match?.[1]?.replace(/\s+/g, " ").trim()
        if (value) return value
    }
    return null
}

function urlsToInspect(baseUrl: string, depth: number) {
    const url = new URL(baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`)
    const paths = depth <= 1 ? ["/"] : ["/", "/contact", "/contact-us", "/about", "/about-us", "/team"]
    return [...new Set(paths.map((path) => new URL(path, url.origin).toString()))]
}

async function fetchPage(url: string, timeoutSeconds: number): Promise<{ html: string; visibleText: string } | null> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000)
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)", Accept: "text/html,text/plain" },
            cache: "no-store",
            signal: controller.signal,
        })
        if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
        const contentType = response.headers.get("content-type") ?? ""
        if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return null
        const html = await response.text()
        const visibleText = html
            .replace(/<script(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
        return { html, visibleText }
    } finally {
        clearTimeout(timeout)
    }
}

function extractPageEvidence(url: string, html: string, visibleText: string): PageExtraction {
    const phones = extractPhones(`${html} ${visibleText}`)
    const ownerName = extractOwnerName(visibleText)
    const evidence = [
        phones.length ? `phone:${phones.join(",")}` : null,
        ownerName ? `owner:${ownerName}` : null,
        /application\/ld\+json/i.test(html) ? "json_ld_present" : null,
        /href=["']tel:/i.test(html) ? "tel_link_present" : null,
    ].filter((value): value is string => Boolean(value))
    return { url, owner_name: ownerName, phone: phones[0] ?? null, phones, evidence }
}

async function createMappedTasksForPoll({ workspaceId, pollId, plan }: { workspaceId: string; pollId: string; plan: LeadgenSourcePlanItem }) {
    const sourceStage = SOURCE_STAGE[plan.key]
    if (!sourceStage) return 0
    if (plan.key === "website") return createWebsiteTasksForPoll({ workspaceId, pollId, plan })
    const [industryMappingsResult, locationMappingsResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_source_industry_mappings")
            .select("icp_industry_value, native_values, native_label, metadata")
            .eq("source_key", plan.key)
            .eq("enabled", true)
            .in("icp_industry_value", plan.industries),
        supabaseAdmin
            .from("leadgen_source_location_mappings")
            .select("icp_location_value, native_values, metadata")
            .eq("source_key", plan.key)
            .eq("enabled", true)
            .in("icp_location_value", plan.locations),
    ])
    if (industryMappingsResult.error) throw new Error(`Could not load ${plan.label} industry mappings: ${industryMappingsResult.error.message}`)
    if (locationMappingsResult.error) throw new Error(`Could not load ${plan.label} location mappings: ${locationMappingsResult.error.message}`)
    const industryMappings = industryMappingsResult.data ?? []
    const locationMappings = locationMappingsResult.data ?? []
    const tasks = industryMappings.flatMap((industry) => locationMappings.flatMap((location) => {
        const industryValues = Array.isArray(industry.native_values) ? industry.native_values : []
        const locationValues = Array.isArray(location.native_values) ? location.native_values : []
        if (industryValues.length === 0 || locationValues.length === 0) return []
        return [{
            poll_id: pollId,
            workspace_id: workspaceId,
            source_key: plan.key,
            stage: sourceStage,
            industry_value: industry.icp_industry_value,
            location_value: location.icp_location_value,
            status: "queued",
            source_query: {
                source_key: plan.key,
                stage: sourceStage,
                native_industries: industryValues,
                native_locations: locationValues,
                industry_mapping: industry,
                location_mapping: location,
                limit: plan.limit ?? 25,
                radius_meters: plan.radiusMeters,
                release: plan.release,
            },
        }]
    }))
    if (tasks.length === 0) return 0
    const { error } = await supabaseAdmin.from("leadgen_poll_tasks").insert(tasks)
    if (error) throw error
    return tasks.length
}

export async function createWebsiteTasksForPoll({ workspaceId, pollId, plan }: { workspaceId: string; pollId: string; plan: LeadgenSourcePlanItem }) {
    if (plan.key !== "website") return 0
    const companiesResult = await supabaseAdmin
        .from("leadgen_companies")
        .select("id, display_name, phone, website_url, profile_url, source_key, source_record_id")
        .eq("workspace_id", workspaceId)
        .eq("first_seen_poll_id", pollId)
        .not("website_url", "is", null)
        .limit(Math.min(200, Math.max(1, plan.limit ?? 50)))
    if (companiesResult.error) throw new Error(`Could not load companies for website crawling: ${companiesResult.error.message}`)
    const companies = (companiesResult.data ?? []) as CompanySeed[]
    const tasks = companies.flatMap((company) => company.website_url ? [{
        poll_id: pollId,
        workspace_id: workspaceId,
        source_key: "website",
        stage: "owner_phone_extraction",
        candidate_id: null,
        industry_value: null,
        location_value: null,
        status: "queued",
        source_query: {
            company_id: company.id,
            company_name: company.display_name,
            website_url: company.website_url,
            crawl_depth: plan.crawlDepth ?? 2,
            timeout_seconds: plan.timeoutSeconds ?? 10,
            respect_robots: plan.respectRobots !== false,
        },
    }] : [])
    if (tasks.length === 0) return 0
    const { error } = await supabaseAdmin.from("leadgen_poll_tasks").insert(tasks)
    if (error) throw error
    return tasks.length
}

export async function createPipelineTasksForPoll({ workspaceId, pollId, plans }: { workspaceId: string; pollId: string; plans: LeadgenSourcePlanItem[] }) {
    const taskCounts = await Promise.all(plans.map((plan) => createMappedTasksForPoll({ workspaceId, pollId, plan })))
    return taskCounts.reduce((total, count) => total + count, 0)
}

async function processBlockedExternalTask(task: PipelineTask) {
    if (task.source_key === "overture") {
        if (!process.env.OVERTURE_DUCKDB_ENDPOINT) throw new Error("Overture Places is mapped, but the Overture GeoParquet/DuckDB adapter is not configured yet. Add OVERTURE_DUCKDB_ENDPOINT, then this worker can seed candidates from the Overture Places dataset.")
        throw new Error("Overture adapter endpoint is configured, but the endpoint client has not been implemented in Betelgeze yet.")
    }
    if (task.source_key === "opencorporates") {
        if (!process.env.OPENCORPORATES_API_KEY) throw new Error("OpenCorporates is mapped, but OPENCORPORATES_API_KEY is not configured in Vercel.")
        throw new Error("OpenCorporates API key is configured, but the officer lookup client has not been implemented in Betelgeze yet.")
    }
    if (task.source_key === "sam_gov") {
        if (!process.env.SAM_GOV_API_KEY) throw new Error("SAM.gov is mapped, but SAM_GOV_API_KEY is not configured in Vercel.")
        throw new Error("SAM.gov API key is configured, but the entity lookup client has not been implemented in Betelgeze yet.")
    }
    return { rawCount: 0, companyCount: 0 }
}

async function processWebsiteTask(task: PipelineTask) {
    const companyId = typeof task.source_query.company_id === "string" ? task.source_query.company_id : null
    const websiteUrl = typeof task.source_query.website_url === "string" ? task.source_query.website_url : null
    if (!companyId || !websiteUrl) throw new Error("Website crawler task is missing a company or website URL.")
    const depth = Math.min(5, Math.max(1, Number(task.source_query.crawl_depth) || 2))
    const timeoutSeconds = Math.min(30, Math.max(3, Number(task.source_query.timeout_seconds) || 10))
    const inspected: PageExtraction[] = []
    let ownerName: string | null = null
    let phone: string | null = null
    for (const url of urlsToInspect(websiteUrl, depth)) {
        try {
            const page = await fetchPage(url, timeoutSeconds)
            if (!page) {
                inspected.push({ url, owner_name: null, phone: null, phones: [], evidence: ["non_text_response"] })
                continue
            }
            const extracted = extractPageEvidence(url, page.html, page.visibleText)
            const pageOwner = extracted.owner_name
            const pagePhone = extracted.phone
            inspected.push(extracted)
            ownerName ||= pageOwner
            phone ||= pagePhone
            if (ownerName && phone) break
        } catch {
            inspected.push({ url, owner_name: null, phone: null, phones: [], evidence: ["fetch_failed"] })
        }
    }
    const { error: evidenceError } = await supabaseAdmin.from("leadgen_evidence").insert({
        workspace_id: String(task.source_query.workspace_id ?? ""),
        company_id: companyId,
        source_key: "website",
        evidence_kind: "website_owner_phone_extract",
        confidence: ownerName && phone ? 62 : phone ? 35 : 20,
        value: { owner_name: ownerName, phone, phones: uniqueValues(inspected.flatMap((page) => page.phones)) },
        raw_payload: { inspected },
    })
    if (evidenceError) throw evidenceError
    if (ownerName || phone) {
        const updatePayload: Record<string, unknown> = {
            last_seen_at: new Date().toISOString(),
        }
        if (ownerName) {
            updatePayload.owner_name = ownerName
            updatePayload.owner_source_key = "website"
            updatePayload.owner_evidence = { source: "website", inspected, extracted_at: new Date().toISOString() }
            if (phone) {
                updatePayload.owner_phone = phone
                updatePayload.owner_confidence = 62
            }
        }
        if (phone) updatePayload.phone = phone
        const { error } = await supabaseAdmin
            .from("leadgen_companies")
            .update(updatePayload)
            .eq("id", companyId)
        if (error) throw error
    }
    return { rawCount: inspected.length, companyCount: ownerName && phone ? 1 : 0 }
}

export async function processPipelineSourcePoll(pollId: string, workspaceId: string, sourceKey: LeadgenSourceKey, options: { finalize?: boolean } = {}) {
    await setLeadgenPollStatus(pollId, workspaceId, "running")
    const tasksResult = await supabaseAdmin
        .from("leadgen_poll_tasks")
        .select("id, source_key, source_query")
        .eq("poll_id", pollId)
        .eq("workspace_id", workspaceId)
        .eq("source_key", sourceKey)
        .eq("status", "queued")
        .order("created_at", { ascending: true })
    if (tasksResult.error) {
        await setLeadgenPollStatus(pollId, workspaceId, "failed", `Could not load ${sourceKey} tasks: ${tasksResult.error.message}`)
        return
    }
    const tasks = (tasksResult.data ?? []) as PipelineTask[]
    for (const task of tasks) {
        await supabaseAdmin.from("leadgen_poll_tasks").update({ status: "running", started_at: new Date().toISOString(), error: null }).eq("id", task.id)
        try {
            const query = { ...(task.source_query ?? {}), workspace_id: workspaceId }
            const taskWithWorkspace = { ...task, source_query: query }
            const result = sourceKey === "website" ? await processWebsiteTask(taskWithWorkspace) : await processBlockedExternalTask(taskWithWorkspace)
            await supabaseAdmin
                .from("leadgen_poll_tasks")
                .update({ status: "completed", raw_count: result?.rawCount ?? 0, company_count: result?.companyCount ?? 0, completed_at: new Date().toISOString(), error: null })
                .eq("id", task.id)
        } catch (error) {
            await supabaseAdmin
                .from("leadgen_poll_tasks")
                .update({ status: "failed", completed_at: new Date().toISOString(), error: compactErrorMessage(error) })
                .eq("id", task.id)
        }
    }
    await refreshLeadgenPollCounts(pollId, workspaceId)
    if (options.finalize !== false) await refreshLeadgenPollCounts(pollId, workspaceId)
}
