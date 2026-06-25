import { supabaseAdmin } from "@/lib/supabase/admin"
import type { LeadgenSourcePlanItem } from "@/lib/leadgen/sources"

type GeoTarget = {
    value: string
    label: string
    latitude: number | null
    longitude: number | null
    radius_meters: number
}

type CategoryMapping = {
    industry_value: string
    source_search_term: string
    source_category_aliases: string[] | null
}

type OsmElement = {
    type: string
    id: number
    lat?: number
    lon?: number
    center?: { lat?: number; lon?: number }
    tags?: Record<string, string>
}

function normalisePhone(value: string | null | undefined) {
    const digits = value?.replace(/[^\d+]/g, "") ?? ""
    return digits || null
}

function domainFromUrl(value: string | null | undefined) {
    if (!value) return null
    try {
        return new URL(value.startsWith("http") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "") || null
    } catch {
        return null
    }
}

function tagClauses(tags: string[], target: GeoTarget, radius: number) {
    return tags
        .map((tag) => {
            const [key, rawValue] = tag.split("=", 2)
            if (!key || !rawValue) return null
            const value = rawValue.replace(/"/g, '\\"')
            const escapedKey = key.replace(/"/g, '\\"')
            return `nwr["${escapedKey}"="${value}"](around:${radius},${target.latitude},${target.longitude});`
        })
        .filter(Boolean)
        .join("\n")
}

function buildOverpassQuery(target: GeoTarget, mapping: CategoryMapping, radius: number, limit: number) {
    const tags = Array.isArray(mapping.source_category_aliases) ? mapping.source_category_aliases.filter(Boolean) : []
    const clauses = tagClauses(tags, target, radius)
    return `[out:json][timeout:25];
(
${clauses}
);
out center ${limit};`
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
    const failedTasks = tasksResult.count ?? 0
    await supabaseAdmin
        .from("leadgen_polls")
        .update({
            candidate_count: recordsResult.count ?? 0,
            normalised_count: companiesResult.count ?? 0,
            deduped_count: companiesResult.count ?? 0,
            enriched_count: 0,
            qualified_count: 0,
            ...(failedTasks > 0 ? { error: `${failedTasks} source task${failedTasks === 1 ? "" : "s"} failed. Open task records for details.` } : { error: null }),
        })
        .eq("id", pollId)
        .eq("workspace_id", workspaceId)
}

async function upsertOsmElement({ workspaceId, pollId, taskId, industryValue, locationValue, element }: { workspaceId: string; pollId: string; taskId: string; industryValue: string; locationValue: string; element: OsmElement }) {
    const tags = element.tags ?? {}
    const companyName = tags.name?.trim()
    if (!companyName) return false
    const sourceRecordId = `${element.type}/${element.id}`
    const phone = normalisePhone(tags.phone || tags["contact:phone"])
    const websiteUrl = tags.website || tags["contact:website"] || null
    const profileUrl = `https://www.openstreetmap.org/${element.type}/${element.id}`
    const latitude = typeof element.lat === "number" ? element.lat : typeof element.center?.lat === "number" ? element.center.lat : null
    const longitude = typeof element.lon === "number" ? element.lon : typeof element.center?.lon === "number" ? element.center.lon : null
    const address = {
        street: [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || null,
        city: tags["addr:city"] || null,
        state: tags["addr:state"] || null,
        postcode: tags["addr:postcode"] || null,
        country: tags["addr:country"] || null,
    }
    const categories = Object.entries(tags)
        .filter(([key]) => ["craft", "shop", "office", "amenity", "building"].includes(key))
        .map(([key, value]) => ({ key, value }))
    const sourceRecord = {
        workspace_id: workspaceId,
        poll_id: pollId,
        task_id: taskId,
        source_key: "osm",
        source_record_id: sourceRecordId,
        company_name: companyName,
        phone,
        website_url: websiteUrl,
        profile_url: profileUrl,
        address,
        latitude,
        longitude,
        categories,
        rating: null,
        review_count: null,
        raw_payload: element,
    }
    const { error: recordError } = await supabaseAdmin
        .from("leadgen_source_records")
        .upsert(sourceRecord, { onConflict: "workspace_id,source_key,source_record_id" })
    if (recordError) throw recordError
    const { error: companyError } = await supabaseAdmin
        .from("leadgen_companies")
        .upsert({
            workspace_id: workspaceId,
            canonical_name: companyName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
            display_name: companyName,
            phone,
            website_domain: domainFromUrl(websiteUrl),
            website_url: websiteUrl,
            profile_url: profileUrl,
            source_key: "osm",
            source_record_id: sourceRecordId,
            address,
            latitude,
            longitude,
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

export async function createOsmTasksForPoll({ workspaceId, pollId, plan }: { workspaceId: string; pollId: string; plan: LeadgenSourcePlanItem }) {
    if (plan.key !== "osm") return 0
    const [targetsResult, mappingsResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_geo_targets")
            .select("value, label, latitude, longitude, radius_meters")
            .in("value", plan.locations),
        supabaseAdmin
            .from("leadgen_source_category_mappings")
            .select("industry_value, source_search_term, source_category_aliases")
            .eq("source_key", "osm")
            .eq("enabled", true)
            .in("industry_value", plan.industries),
    ])
    const targets = (targetsResult.error ? [] : targetsResult.data ?? []) as GeoTarget[]
    const mappings = (mappingsResult.error ? [] : mappingsResult.data ?? []) as CategoryMapping[]
    const tasks = mappings.flatMap((mapping) => targets
        .filter((target) => typeof target.latitude === "number" && typeof target.longitude === "number")
        .map((target) => {
            const radius = Math.min(40000, Math.max(1000, plan.radiusMeters ?? target.radius_meters ?? 24000))
            const limit = Math.min(50, Math.max(1, plan.limit ?? 25))
            return {
                poll_id: pollId,
                workspace_id: workspaceId,
                source_key: "osm",
                industry_value: mapping.industry_value,
                location_value: target.value,
                status: "queued",
                source_query: {
                    query: buildOverpassQuery(target, mapping, radius, limit),
                    tags: mapping.source_category_aliases ?? [],
                    target: target.label,
                    radius_meters: radius,
                    limit,
                },
            }
        }))
    if (tasks.length === 0) return 0
    const { error } = await supabaseAdmin.from("leadgen_poll_tasks").insert(tasks)
    if (error) throw error
    return tasks.length
}

export async function processOsmPoll(pollId: string, workspaceId: string) {
    await setPollStatus(pollId, workspaceId, "running")
    const tasksResult = await supabaseAdmin
        .from("leadgen_poll_tasks")
        .select("id, industry_value, location_value, source_query")
        .eq("poll_id", pollId)
        .eq("workspace_id", workspaceId)
        .eq("source_key", "osm")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
    const tasks = tasksResult.error ? [] : tasksResult.data ?? []
    if (tasks.length === 0) {
        await setPollStatus(pollId, workspaceId, "failed", "No OSM source tasks were generated from these settings.")
        return
    }
    for (const task of tasks) {
        await supabaseAdmin.from("leadgen_poll_tasks").update({ status: "running", started_at: new Date().toISOString(), error: null }).eq("id", task.id)
        try {
            const query = task.source_query as { query?: string }
            if (!query.query) throw new Error("Missing Overpass query.")
            const response = await fetch("https://overpass-api.de/api/interpreter", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ data: query.query }),
                cache: "no-store",
            })
            const payload = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(`Overpass returned ${response.status}.`)
            const elements = Array.isArray(payload?.elements) ? payload.elements as OsmElement[] : []
            let companyCount = 0
            for (const element of elements) {
                const stored = await upsertOsmElement({ workspaceId, pollId, taskId: task.id, industryValue: task.industry_value, locationValue: task.location_value, element })
                if (stored) companyCount += 1
            }
            await supabaseAdmin.from("leadgen_poll_tasks").update({ status: "completed", raw_count: elements.length, company_count: companyCount, completed_at: new Date().toISOString(), error: null }).eq("id", task.id)
        } catch (error) {
            await supabaseAdmin.from("leadgen_poll_tasks").update({ status: "failed", completed_at: new Date().toISOString(), error: error instanceof Error ? error.message : "OSM task failed." }).eq("id", task.id)
        }
    }
    await refreshPollCounts(pollId, workspaceId)
    const failedResult = await supabaseAdmin.from("leadgen_poll_tasks").select("id", { count: "exact", head: true }).eq("poll_id", pollId).eq("status", "failed")
    await setPollStatus(pollId, workspaceId, (failedResult.count ?? 0) > 0 ? "failed" : "completed", (failedResult.count ?? 0) > 0 ? `${failedResult.count} OSM task${failedResult.count === 1 ? "" : "s"} failed.` : null)
    await refreshPollCounts(pollId, workspaceId)
}
