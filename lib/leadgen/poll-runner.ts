import { buildSourcePlan, executableLeadgenSources, type LeadgenSourceConfig, type LeadgenSourcePlanItem } from "@/lib/leadgen/sources"
import { finalizeLeadgenPoll, setLeadgenPollStatus } from "@/lib/leadgen/osm-worker"
import { createPipelineTasksForPoll, createWebsiteTasksForPoll, processPipelineSourcePoll } from "@/lib/leadgen/pipeline-workers"
import { processPublicRecordsPoll } from "@/lib/leadgen/public-records-worker"
import { createStateLicensingEnrichmentTasksForPoll, processStateLicensingPoll } from "@/lib/leadgen/state-licensing-worker"
import { createInvestigationTasksForPoll, scorePollCompanies } from "@/lib/leadgen/evidence-scoring"
import { supabaseAdmin } from "@/lib/supabase/admin"

const PILOT_CANDIDATE_LIMIT = 10

export function configObject(value: unknown): Partial<LeadgenSourceConfig> {
    return value && typeof value === "object" ? value as Partial<LeadgenSourceConfig> : {}
}

export function planLeadgenSources(enabledSources: string[], sourceConfig: Partial<LeadgenSourceConfig> | null | undefined) {
    return buildSourcePlan(enabledSources, sourceConfig)
}

function executablePlan(sourcePlan: LeadgenSourcePlanItem[]) {
    return {
        stateLicensingPlan: sourcePlan.find((source) => source.key === "state_licensing"),
        websitePlan: sourcePlan.find((source) => source.key === "website"),
        preSeedPipelinePlans: sourcePlan
            .filter((source) => source.key === "overture" && executableLeadgenSources.has(source.key) && source.industries.length > 0 && source.locations.length > 0)
            .map((source) => ({ ...source, limit: Math.min(PILOT_CANDIDATE_LIMIT, Math.max(1, source.limit ?? PILOT_CANDIDATE_LIMIT)) })),
        postSeedPipelinePlans: sourcePlan.filter((source) => ["opencorporates"].includes(source.key) && executableLeadgenSources.has(source.key) && source.industries.length > 0 && source.locations.length > 0),
        runnablePlans: sourcePlan.filter((source) => executableLeadgenSources.has(source.key) && source.industries.length > 0 && source.locations.length > 0),
    }
}

export async function createInitialLeadgenPollTasks({ workspaceId, pollId, sourcePlan }: { workspaceId: string; pollId: string; sourcePlan: LeadgenSourcePlanItem[] }) {
    const { preSeedPipelinePlans } = executablePlan(sourcePlan)
    return preSeedPipelinePlans.length ? createPipelineTasksForPoll({ workspaceId, pollId, plans: preSeedPipelinePlans }) : 0
}

function sourcePlanFromPollSnapshot(snapshot: unknown): LeadgenSourcePlanItem[] {
    if (!Array.isArray(snapshot)) return []
    return snapshot.filter((item): item is LeadgenSourcePlanItem => Boolean(
        item &&
        typeof item === "object" &&
        "key" in item &&
        "industries" in item &&
        "locations" in item &&
        Array.isArray((item as { industries?: unknown }).industries) &&
        Array.isArray((item as { locations?: unknown }).locations)
    ))
}

export async function processLeadgenPoll({ workspaceId, pollId }: { workspaceId: string; pollId: string }) {
    const pollResult = await supabaseAdmin
        .from("leadgen_polls")
        .select("id, status, source_snapshot")
        .eq("id", pollId)
        .eq("workspace_id", workspaceId)
        .maybeSingle()
    if (pollResult.error || !pollResult.data) return { processed: false, reason: "missing_poll" }
    if (!["queued", "running"].includes(pollResult.data.status)) return { processed: false, reason: "not_runnable" }

    const sourcePlan = sourcePlanFromPollSnapshot(pollResult.data.source_snapshot)
    const { stateLicensingPlan, websitePlan, preSeedPipelinePlans, postSeedPipelinePlans } = executablePlan(sourcePlan)
    const runnableStateLicensingPlan = stateLicensingPlan && stateLicensingPlan.industries.length > 0 && stateLicensingPlan.locations.length > 0 ? stateLicensingPlan : null
    const runnableWebsitePlan = websitePlan && websitePlan.industries.length > 0 && websitePlan.locations.length > 0 ? { ...websitePlan, limit: PILOT_CANDIDATE_LIMIT } : null

    await setLeadgenPollStatus(pollId, workspaceId, "running")
    for (const plan of preSeedPipelinePlans) await processPipelineSourcePoll(pollId, workspaceId, plan.key, { finalize: false })
    await createInvestigationTasksForPoll({ workspaceId, pollId })
    await processPublicRecordsPoll(pollId, workspaceId, { finalize: false })
    if (runnableStateLicensingPlan) {
        await createStateLicensingEnrichmentTasksForPoll({ workspaceId, pollId, plan: runnableStateLicensingPlan })
        await processStateLicensingPoll(pollId, workspaceId, { finalize: false })
    }
    if (runnableWebsitePlan) {
        await createWebsiteTasksForPoll({ workspaceId, pollId, plan: runnableWebsitePlan })
        await processPipelineSourcePoll(pollId, workspaceId, "website", { finalize: false })
    }
    if (postSeedPipelinePlans.length) {
        await createPipelineTasksForPoll({ workspaceId, pollId, plans: postSeedPipelinePlans })
        for (const plan of postSeedPipelinePlans) await processPipelineSourcePoll(pollId, workspaceId, plan.key, { finalize: false })
    }
    await scorePollCompanies({ workspaceId, pollId })
    await finalizeLeadgenPoll(pollId, workspaceId)
    return { processed: true }
}
