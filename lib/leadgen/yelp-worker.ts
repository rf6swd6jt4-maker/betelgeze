import { supabaseAdmin } from "@/lib/supabase/admin"
import type { LeadgenSourcePlanItem } from "@/lib/leadgen/sources"

type GeoTarget = {
    value: string
    label: string
    latitude: number | null
    longitude: number | null
    locality: string | null
    region: string | null
    country: string | null
    radius_meters: number
}

type CategoryMapping = {
    industry_value: string
    source_search_term: string
    source_category_aliases: string[] | null
}

type YelpBusiness = {
    id: string
    name?: string
    phone?: string
    display_phone?: string
    url?: string
    rating?: number
    review_count?: number
    categories?: Array<{ alias?: string; title?: string }>
    coordinates?: { latitude?: number; longitude?: number }
    location?: {
        address1?: string
        address2?: string
        address3?: string
        city?: string
        state?: string
        zip_code?: string
        country?: string
        display_address?: string[]
    }
}

function normalisePhone(value: string | null | undefined) {
    const digits = value?.replace(/[^\d+]/g, "") ?? ""
    return digits || null
}

async function setPollStatus(pollId: string, workspaceId: string, status: string, error?: string | null) {
    await supabaseAdmin
        .from("leadgen_polls")
        .update({ status, error: error ?? null, ...(status === "running" ? { started_at: new Date().toISOString() } : {}), ...(["completed", "failed", "cancelled"].includes(status) ? { completed_at: new Date().toISOString() } : {}) })
        .eq("id", pollId)
        .eq("workspace_id", workspaceId)
}

async function refreshPollCounts(pollId: string, workspaceId: string) {
    const [recordsResult, companiesResult, tasksResult] = await Promise.all([
        supabaseAdmin.from("leadgen_source_records").select("id", { count: "exact", head: true }).eq("poll_id", pollId),
        supabaseAdmin.from("leadgen_companies").select("id", { count: "exact", head: true }).eq("first_seen_poll_id", pollId),
        supabaseAdmin.from("leadgen_poll_tasks").select("id", { count: "exact", head: true }).eq("poll_id", pollId).eq("status", "failed"),
    ])
    const candidateCount = recordsResult.count ?? 0
    const companyCount = companiesResult.count ?? 0
    const failedTasks = tasksResult.count ?? 0
    await supabaseAdmin
        .from("leadgen_polls")
        .update({
            candidate_count: candidateCount,
            normalised_count: companyCount,
            deduped_count: companyCount,
            enriched_count: 0,
            qualified_count: 0,
            ...(failedTasks > 0 ? { error: `${failedTasks} source task${failedTasks === 1 ? "" : "s"} failed. Open task records for details.` } : { error: null }),
        })
        .eq("id", pollId)
        .eq("workspace_id", workspaceId)
}

async function upsertBusiness({ workspaceId, pollId, taskId, industryValue, locationValue, business }: { workspaceId: string; pollId: string; taskId: string; industryValue: string; locationValue: string; business: YelpBusiness }) {
    const companyName = business.name?.trim()
    if (!business.id || !companyName) return false
    const phone = normalisePhone(business.phone || business.display_phone)
    const profileUrl = business.url ?? null
    const address = business.location ?? {}
    const latitude = typeof business.coordinates?.latitude === "number" ? business.coordinates.latitude : null
    const longitude = typeof business.coordinates?.longitude === "number" ? business.coordinates.longitude : null
    const categories = business.categories ?? []
    const recordPayload = {
        workspace_id: workspaceId,
        poll_id: pollId,
        task_id: taskId,
        source_key: "yelp",
        source_record_id: business.id,
        company_name: companyName,
        phone,
        website_url: null,
        profile_url: profileUrl,
        address,
        latitude,
        longitude,
        categories,
        rating: typeof business.rating === "number" ? business.rating : null,
        review_count: typeof business.review_count === "number" ? business.review_count : null,
        raw_payload: business,
    }
    const { error: recordError } = await supabaseAdmin
        .from("leadgen_source_records")
        .upsert(recordPayload, { onConflict: "workspace_id,source_key,source_record_id" })
    if (recordError) throw recordError

    const companyPayload = {
        workspace_id: workspaceId,
        canonical_name: companyName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
        display_name: companyName,
        phone,
        website_domain: null,
        website_url: null,
        profile_url: profileUrl,
        source_key: "yelp",
        source_record_id: business.id,
        address,
        latitude,
        longitude,
        categories,
        rating: typeof business.rating === "number" ? business.rating : null,
        review_count: typeof business.review_count === "number" ? business.review_count : null,
        industry_value: industryValue,
        location_value: locationValue,
        first_seen_poll_id: pollId,
        last_seen_at: new Date().toISOString(),
    }
    const { error: companyError } = await supabaseAdmin
        .from("leadgen_companies")
        .upsert(companyPayload, { onConflict: "workspace_id,source_key,source_record_id" })
    if (companyError) throw companyError
    return true
}

export async function createYelpTasksForPoll({ workspaceId, pollId, plan }: { workspaceId: string; pollId: string; plan: LeadgenSourcePlanItem }) {
    if (plan.key !== "yelp") return 0
    const [targetsResult, mappingsResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_geo_targets")
            .select("value, label, latitude, longitude, locality, region, country, radius_meters")
            .in("value", plan.locations),
        supabaseAdmin
            .from("leadgen_source_category_mappings")
            .select("industry_value, source_search_term, source_category_aliases")
            .eq("source_key", "yelp")
            .eq("enabled", true)
            .in("industry_value", plan.industries),
    ])
    const targets = (targetsResult.error ? [] : targetsResult.data ?? []) as GeoTarget[]
    const mappings = (mappingsResult.error ? [] : mappingsResult.data ?? []) as CategoryMapping[]
    const tasks = mappings.flatMap((mapping) => targets.map((target) => ({
        poll_id: pollId,
        workspace_id: workspaceId,
        source_key: "yelp",
        industry_value: mapping.industry_value,
        location_value: target.value,
        status: "queued",
        source_query: {
            term: mapping.source_search_term,
            categories: mapping.source_category_aliases ?? [],
            location: target.label,
            latitude: target.latitude,
            longitude: target.longitude,
            radius_meters: Math.min(40000, Math.max(1000, plan.radiusMeters ?? target.radius_meters ?? 24000)),
            limit: Math.min(50, Math.max(1, plan.limit ?? 10)),
        },
    })))
    if (tasks.length === 0) return 0
    const { error } = await supabaseAdmin.from("leadgen_poll_tasks").insert(tasks)
    if (error) throw error
    return tasks.length
}

export async function processYelpPoll(pollId: string, workspaceId: string) {
    const apiKey = process.env.YELP_FUSION_API_KEY
    if (!apiKey) {
        await setPollStatus(pollId, workspaceId, "failed", "YELP_FUSION_API_KEY is not configured.")
        await supabaseAdmin.from("leadgen_poll_tasks").update({ status: "failed", error: "YELP_FUSION_API_KEY is not configured.", completed_at: new Date().toISOString() }).eq("poll_id", pollId)
        return
    }
    await setPollStatus(pollId, workspaceId, "running")
    const tasksResult = await supabaseAdmin
        .from("leadgen_poll_tasks")
        .select("id, industry_value, location_value, source_query")
        .eq("poll_id", pollId)
        .eq("workspace_id", workspaceId)
        .eq("source_key", "yelp")
        .eq("status", "queued")
        .order("created_at", { ascending: true })

    const tasks = tasksResult.error ? [] : tasksResult.data ?? []
    if (tasks.length === 0) {
        await setPollStatus(pollId, workspaceId, "failed", "No Yelp source tasks were generated from these settings.")
        return
    }

    for (const task of tasks) {
        await supabaseAdmin.from("leadgen_poll_tasks").update({ status: "running", started_at: new Date().toISOString(), error: null }).eq("id", task.id)
        try {
            const query = task.source_query as { term?: string; categories?: string[]; latitude?: number; longitude?: number; location?: string; radius_meters?: number; limit?: number }
            const url = new URL("https://api.yelp.com/v3/businesses/search")
            url.searchParams.set("term", query.term ?? "contractor")
            url.searchParams.set("limit", String(Math.min(50, Math.max(1, Number(query.limit ?? 10)))))
            url.searchParams.set("radius", String(Math.min(40000, Math.max(1000, Number(query.radius_meters ?? 24000)))))
            if (Array.isArray(query.categories) && query.categories.length > 0) url.searchParams.set("categories", query.categories.join(","))
            if (typeof query.latitude === "number" && typeof query.longitude === "number") {
                url.searchParams.set("latitude", String(query.latitude))
                url.searchParams.set("longitude", String(query.longitude))
            } else {
                url.searchParams.set("location", query.location ?? "Texas")
            }
            const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store" })
            const payload = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(typeof payload?.error?.description === "string" ? payload.error.description : `Yelp returned ${response.status}.`)
            const businesses = Array.isArray(payload?.businesses) ? payload.businesses as YelpBusiness[] : []
            let companyCount = 0
            for (const business of businesses) {
                const stored = await upsertBusiness({ workspaceId, pollId, taskId: task.id, industryValue: task.industry_value, locationValue: task.location_value, business })
                if (stored) companyCount += 1
            }
            await supabaseAdmin.from("leadgen_poll_tasks").update({ status: "completed", raw_count: businesses.length, company_count: companyCount, completed_at: new Date().toISOString(), error: null }).eq("id", task.id)
        } catch (error) {
            await supabaseAdmin.from("leadgen_poll_tasks").update({ status: "failed", completed_at: new Date().toISOString(), error: error instanceof Error ? error.message : "Yelp task failed." }).eq("id", task.id)
        }
    }
    await refreshPollCounts(pollId, workspaceId)
    const failedResult = await supabaseAdmin.from("leadgen_poll_tasks").select("id", { count: "exact", head: true }).eq("poll_id", pollId).eq("status", "failed")
    await setPollStatus(pollId, workspaceId, (failedResult.count ?? 0) > 0 ? "failed" : "completed", (failedResult.count ?? 0) > 0 ? `${failedResult.count} Yelp task${failedResult.count === 1 ? "" : "s"} failed.` : null)
    await refreshPollCounts(pollId, workspaceId)
}
