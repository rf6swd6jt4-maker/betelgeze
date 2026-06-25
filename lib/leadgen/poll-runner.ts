import { supabaseAdmin } from "@/lib/supabase/admin"

const TEST_RUN_SECONDS = 12

type PollRow = {
    id: string
    source_count: number
    source_snapshot: unknown
    started_at: string | null
    created_at: string
}

function countSelections(snapshot: unknown) {
    if (!Array.isArray(snapshot)) return { industries: 0, locations: 0 }
    return snapshot.reduce((counts, source) => {
        if (!source || typeof source !== "object") return counts
        const industries = "industries" in source && Array.isArray(source.industries) ? source.industries.length : 0
        const locations = "locations" in source && Array.isArray(source.locations) ? source.locations.length : 0
        return { industries: counts.industries + industries, locations: counts.locations + locations }
    }, { industries: 0, locations: 0 })
}

function resultCounts(poll: PollRow) {
    const selections = countSelections(poll.source_snapshot)
    const sourceWeight = Math.max(1, poll.source_count)
    const selectionWeight = Math.max(1, selections.industries + selections.locations)
    const candidateCount = Math.min(250, 12 + sourceWeight * 9 + selectionWeight * 6)
    const normalisedCount = Math.max(0, Math.floor(candidateCount * 0.88))
    const dedupedCount = Math.max(0, Math.floor(normalisedCount * 0.72))
    const enrichedCount = Math.max(0, Math.floor(dedupedCount * 0.64))
    const qualifiedCount = Math.max(0, Math.floor(enrichedCount * 0.34))
    return { candidate_count: candidateCount, normalised_count: normalisedCount, deduped_count: dedupedCount, enriched_count: enrichedCount, qualified_count: qualifiedCount }
}

export async function advanceLeadgenPollQueue(workspaceId: string) {
    const runningResult = await supabaseAdmin
        .from("leadgen_polls")
        .select("id, source_count, source_snapshot, started_at, created_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "running")
        .order("started_at", { ascending: true })
        .limit(1)

    const runningPoll = runningResult.error ? null : runningResult.data?.[0] as PollRow | undefined
    if (runningPoll) {
        const startedAt = new Date(runningPoll.started_at ?? runningPoll.created_at).getTime()
        if (Number.isFinite(startedAt) && Date.now() - startedAt >= TEST_RUN_SECONDS * 1000) {
            await supabaseAdmin
                .from("leadgen_polls")
                .update({ status: "completed", completed_at: new Date().toISOString(), error: null, ...resultCounts(runningPoll) })
                .eq("id", runningPoll.id)
                .eq("workspace_id", workspaceId)
                .eq("status", "running")
            return
        }
        return
    }

    const queuedResult = await supabaseAdmin
        .from("leadgen_polls")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(1)

    const queuedPollId = queuedResult.error ? null : queuedResult.data?.[0]?.id
    if (!queuedPollId) return

    await supabaseAdmin
        .from("leadgen_polls")
        .update({ status: "running", started_at: new Date().toISOString(), error: null })
        .eq("id", queuedPollId)
        .eq("workspace_id", workspaceId)
        .eq("status", "queued")
}
