import { buildSourcePlan, executableLeadgenSources, seedLeadgenSources, stateLicensingSourceKeys, type LeadgenSourceConfig, type LeadgenSourcePlanItem } from "@/lib/leadgen/sources"
import { createOsmTasksForPoll, finalizeLeadgenPoll, processOsmPoll, setLeadgenPollStatus } from "@/lib/leadgen/osm-worker"
import { createPipelineTasksForPoll, createWebsiteTasksForPoll, processPipelineSourcePoll } from "@/lib/leadgen/pipeline-workers"
import { processPublicRecordsPoll } from "@/lib/leadgen/public-records-worker"
import { createStateLicensingEnrichmentTasksForPoll, processStateLicensingPoll } from "@/lib/leadgen/state-licensing-worker"
import { createInvestigationTasksForPoll, scorePollCompanies } from "@/lib/leadgen/evidence-scoring"
import { finishPollStage, loadPollCompanies, loadStageSourceKeys, recordBusinessValidationStage, recordOwnerIdentityStage, recordOwnerPhoneStage, recordPhoneValidationStage, recordSeedStage, startPollStage, type PollStageKey } from "@/lib/leadgen/staged-poll"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const TARGET_VALIDATED_BUSINESSES = 10
export const MAX_SEED_CANDIDATES = 50

export function configObject(value: unknown): Partial<LeadgenSourceConfig> {
    return value && typeof value === "object" ? value as Partial<LeadgenSourceConfig> : {}
}

export function planLeadgenSources(enabledSources: string[], sourceConfig: Partial<LeadgenSourceConfig> | null | undefined) {
    return buildSourcePlan(enabledSources, sourceConfig)
}

function executablePlan(sourcePlan: LeadgenSourcePlanItem[]) {
    const runnable = sourcePlan.filter((source) => executableLeadgenSources.has(source.key) && source.industries.length > 0 && source.locations.length > 0)
    return {
        osmSeedPlan: runnable.find((source) => source.key === "osm"),
        stateLicensingPlans: runnable.filter((source) => stateLicensingSourceKeys.has(source.key)),
        websitePlan: sourcePlan.find((source) => source.key === "website"),
        preSeedPipelinePlans: runnable
            .filter((source) => seedLeadgenSources.has(source.key) && source.key !== "osm")
            .map((source) => ({ ...source, limit: Math.min(MAX_SEED_CANDIDATES, Math.max(1, source.limit ?? MAX_SEED_CANDIDATES)) })),
        postSeedPipelinePlans: runnable
            .filter((source) => source.key === "sam_gov")
            .slice(0, 1)
            .map((source) => ({ ...source, limit: 1 })),
        runnablePlans: runnable,
    }
}

export async function createInitialLeadgenPollTasks({ workspaceId, pollId, sourcePlan }: { workspaceId: string; pollId: string; sourcePlan: LeadgenSourcePlanItem[] }) {
    const { osmSeedPlan, preSeedPipelinePlans } = executablePlan(sourcePlan)
    const [pipelineCount, osmCount] = await Promise.all([
        preSeedPipelinePlans.length ? createPipelineTasksForPoll({ workspaceId, pollId, plans: preSeedPipelinePlans }) : Promise.resolve(0),
        osmSeedPlan ? createOsmTasksForPoll({ workspaceId, pollId, plan: { ...osmSeedPlan, limit: Math.min(MAX_SEED_CANDIDATES, Math.max(1, osmSeedPlan.limit ?? MAX_SEED_CANDIDATES)) } }) : Promise.resolve(0),
    ])
    return pipelineCount + osmCount
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

function isWebsiteSource(sourceKey: string) {
    return sourceKey === "website" || sourceKey === "web.json_ld"
}

function isStateLicensingSource(sourceKey: string) {
    return stateLicensingSourceKeys.has(sourceKey as LeadgenSourcePlanItem["key"])
}

async function processStageEvidence({
    workspaceId,
    pollId,
    companyIds,
    stageKey,
    sourceKeys,
    stateLicensingPlans,
    websitePlan,
}: {
    workspaceId: string
    pollId: string
    companyIds: string[]
    stageKey: Exclude<PollStageKey, "seed" | "phone_validation">
    sourceKeys: string[]
    stateLicensingPlans: LeadgenSourcePlanItem[]
    websitePlan: LeadgenSourcePlanItem | null
}) {
    if (companyIds.length === 0) return
    const publicRecordSourceKeys = sourceKeys.filter((sourceKey) => !isWebsiteSource(sourceKey) && !isStateLicensingSource(sourceKey))
    if (publicRecordSourceKeys.length) {
        await createInvestigationTasksForPoll({ workspaceId, pollId, enabledSourceKeys: publicRecordSourceKeys, companyIds, stageKey })
        await processPublicRecordsPoll(pollId, workspaceId, { finalize: false, stageKey })
    }
    for (const stateLicensingPlan of stateLicensingPlans.filter((plan) => sourceKeys.includes(plan.key))) {
        await createStateLicensingEnrichmentTasksForPoll({ workspaceId, pollId, plan: { ...stateLicensingPlan, limit: Math.min(MAX_SEED_CANDIDATES, Math.max(1, stateLicensingPlan.limit ?? MAX_SEED_CANDIDATES)) }, companyIds, stageKey })
    }
    if (stateLicensingPlans.some((plan) => sourceKeys.includes(plan.key))) {
        await processStateLicensingPoll(pollId, workspaceId, { finalize: false, stageKey })
    }
    if (websitePlan && sourceKeys.includes("website")) {
        await createWebsiteTasksForPoll({ workspaceId, pollId, plan: { ...websitePlan, limit: MAX_SEED_CANDIDATES }, companyIds, stageKey })
        await processPipelineSourcePoll(pollId, workspaceId, "website", { finalize: false, stageKey })
    }
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
    const { osmSeedPlan, stateLicensingPlans, websitePlan, preSeedPipelinePlans, runnablePlans } = executablePlan(sourcePlan)
    const runnableWebsitePlan = websitePlan && websitePlan.industries.length > 0 && websitePlan.locations.length > 0 ? { ...websitePlan, limit: MAX_SEED_CANDIDATES } : null
    const enabledInvestigationSourceKeys = runnablePlans.map((source) => source.key)

    await setLeadgenPollStatus(pollId, workspaceId, "running")
    await startPollStage({ workspaceId, pollId, stageKey: "seed", targetCount: MAX_SEED_CANDIDATES })
    for (const plan of preSeedPipelinePlans) await processPipelineSourcePoll(pollId, workspaceId, plan.key, { finalize: false })
    if (osmSeedPlan) await processOsmPoll(pollId, workspaceId, { finalize: false })
    const seededCompanies = await loadPollCompanies(workspaceId, pollId, MAX_SEED_CANDIDATES)
    await recordSeedStage({ workspaceId, pollId, targetCount: TARGET_VALIDATED_BUSINESSES, maxSeedCandidates: MAX_SEED_CANDIDATES, seededCount: seededCompanies.length })
    const seedCompanyIds = seededCompanies.map((company) => company.id)

    const validationSourceKeys = await loadStageSourceKeys("business_validation", enabledInvestigationSourceKeys)
    await startPollStage({ workspaceId, pollId, stageKey: "business_validation", targetCount: TARGET_VALIDATED_BUSINESSES, inputCount: seedCompanyIds.length })
    await processStageEvidence({ workspaceId, pollId, stageKey: "business_validation", companyIds: seedCompanyIds, sourceKeys: validationSourceKeys, stateLicensingPlans, websitePlan: runnableWebsitePlan })
    await scorePollCompanies({ workspaceId, pollId })
    const latestSeedCompanies = await loadPollCompanies(workspaceId, pollId, MAX_SEED_CANDIDATES)
    const validatedCompanyIds = await recordBusinessValidationStage({ workspaceId, pollId, targetCount: TARGET_VALIDATED_BUSINESSES, companies: latestSeedCompanies })

    if (validatedCompanyIds.length === 0) {
        await finishPollStage({ workspaceId, pollId, stageKey: "owner_identity", status: "skipped", inputCount: 0, passedCount: 0, error: "No validated businesses were available for owner identity discovery." })
        await finishPollStage({ workspaceId, pollId, stageKey: "owner_phone", status: "skipped", inputCount: 0, passedCount: 0, error: "No owner identities were available for phone discovery." })
        await finishPollStage({ workspaceId, pollId, stageKey: "phone_validation", status: "skipped", inputCount: 0, passedCount: 0, error: "No owner phone numbers were available for validation." })
        await finalizeLeadgenPoll(pollId, workspaceId)
        return { processed: true }
    }

    await startPollStage({ workspaceId, pollId, stageKey: "owner_identity", targetCount: validatedCompanyIds.length, inputCount: validatedCompanyIds.length })
    const ownerIdentitySourceKeys = await loadStageSourceKeys("owner_identity", enabledInvestigationSourceKeys)
    await processStageEvidence({ workspaceId, pollId, stageKey: "owner_identity", companyIds: validatedCompanyIds, sourceKeys: ownerIdentitySourceKeys, stateLicensingPlans, websitePlan: runnableWebsitePlan })
    await scorePollCompanies({ workspaceId, pollId })
    const ownerIdentityCompanyIds = await recordOwnerIdentityStage({ workspaceId, pollId, companyIds: validatedCompanyIds })

    await startPollStage({ workspaceId, pollId, stageKey: "owner_phone", targetCount: ownerIdentityCompanyIds.length, inputCount: ownerIdentityCompanyIds.length })
    const ownerPhoneSourceKeys = await loadStageSourceKeys("owner_phone", enabledInvestigationSourceKeys)
    await processStageEvidence({ workspaceId, pollId, stageKey: "owner_phone", companyIds: ownerIdentityCompanyIds, sourceKeys: ownerPhoneSourceKeys, stateLicensingPlans, websitePlan: runnableWebsitePlan })
    await scorePollCompanies({ workspaceId, pollId })
    const ownerPhoneCompanyIds = await recordOwnerPhoneStage({ workspaceId, pollId, companyIds: ownerIdentityCompanyIds })

    await startPollStage({ workspaceId, pollId, stageKey: "phone_validation", targetCount: ownerPhoneCompanyIds.length, inputCount: ownerPhoneCompanyIds.length })
    const phoneValidationSourceKeys = await loadStageSourceKeys("phone_validation", enabledInvestigationSourceKeys)
    if (phoneValidationSourceKeys.includes("phone.basic_format_validation")) {
        await recordPhoneValidationStage({ workspaceId, pollId, companyIds: ownerPhoneCompanyIds })
    } else {
        await finishPollStage({ workspaceId, pollId, stageKey: "phone_validation", status: "skipped", inputCount: ownerPhoneCompanyIds.length, passedCount: 0, skippedCount: ownerPhoneCompanyIds.length, error: "No enabled phone validation source was available." })
    }

    await scorePollCompanies({ workspaceId, pollId })
    await finalizeLeadgenPoll(pollId, workspaceId)
    return { processed: true }
}
