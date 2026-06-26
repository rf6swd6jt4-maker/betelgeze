"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { buildSourcePlan, executableLeadgenSources, type LeadgenSourceConfig } from "@/lib/leadgen/sources"
import { createOsmTasksForPoll, finalizeLeadgenPoll, processOsmPoll } from "@/lib/leadgen/osm-worker"
import { createPipelineTasksForPoll, createWebsiteTasksForPoll, processPipelineSourcePoll } from "@/lib/leadgen/pipeline-workers"
import { createStateLicensingEnrichmentTasksForPoll, createStateLicensingTasksForPoll, processStateLicensingPoll } from "@/lib/leadgen/state-licensing-worker"

function configObject(value: unknown): Partial<LeadgenSourceConfig> {
    return value && typeof value === "object" ? value as Partial<LeadgenSourceConfig> : {}
}

function refreshPolls(slug: string) {
    revalidatePath(`/leadgen/${slug}`)
    revalidatePath(`/leadgen/${slug}/polls`)
}

export async function createLeadgenPoll(slug: string) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const settingsResult = await supabaseAdmin
        .from("leadgen_workspace_settings")
        .select("enabled_sources, source_config")
        .eq("workspace_id", workspace.id)
        .maybeSingle()
    const settings = settingsResult.error ? null : settingsResult.data
    const enabledSources = Array.isArray(settings?.enabled_sources) ? settings.enabled_sources.map(String) : []
    const currentSourceConfig = configObject(settings?.source_config)
    const sourcePlan = buildSourcePlan(enabledSources, currentSourceConfig)
    const osmPlan = sourcePlan.find((source) => source.key === "osm")
    const stateLicensingPlan = sourcePlan.find((source) => source.key === "state_licensing")
    const websitePlan = sourcePlan.find((source) => source.key === "website")
    const preSeedPipelinePlans = sourcePlan.filter((source) => ["overture"].includes(source.key) && source.industries.length > 0 && source.locations.length > 0)
    const postSeedPipelinePlans = sourcePlan.filter((source) => ["opencorporates", "sam_gov"].includes(source.key) && source.industries.length > 0 && source.locations.length > 0)
    const runnableOsmPlan = osmPlan && osmPlan.industries.length > 0 && osmPlan.locations.length > 0 ? osmPlan : null
    const runnableStateLicensingPlan = stateLicensingPlan && stateLicensingPlan.industries.length > 0 && stateLicensingPlan.locations.length > 0 ? stateLicensingPlan : null
    const runnableWebsitePlan = websitePlan && websitePlan.industries.length > 0 && websitePlan.locations.length > 0 ? websitePlan : null
    const runnablePlans = sourcePlan.filter((source) => executableLeadgenSources.has(source.key) && source.industries.length > 0 && source.locations.length > 0)
    const hasRunnableSources = runnablePlans.length > 0
    const { data: poll, error } = await supabaseAdmin.from("leadgen_polls").insert({
        workspace_id: workspace.id,
        requested_by: user.id,
        trigger: "manual",
        status: hasRunnableSources ? "queued" : "failed",
        source_count: sourcePlan.length,
        source_snapshot: sourcePlan,
        icp_snapshot: {
            industries: sourcePlan[0]?.industries ?? [],
            locations: sourcePlan[0]?.locations ?? [],
            candidate_target_count: currentSourceConfig.icp?.limit ?? null,
            max_enrichment_depth: currentSourceConfig.icp?.maxEnrichmentDepth ?? null,
            owner_required: currentSourceConfig.icp?.ownerRequired !== false,
            captured_at: new Date().toISOString(),
        },
        error: hasRunnableSources ? null : "Enable at least one executable source and select at least one ICP industry and one ICP location in Settings.",
        completed_at: hasRunnableSources ? null : new Date().toISOString(),
    }).select("id").single()
    if (error) throw new Error("Could not queue a new leadgen poll.")
    if (poll?.id && hasRunnableSources) {
        const initialTaskCounts = await Promise.all([
            preSeedPipelinePlans.length ? createPipelineTasksForPoll({ workspaceId: workspace.id, pollId: poll.id, plans: preSeedPipelinePlans }) : 0,
            runnableOsmPlan ? createOsmTasksForPoll({ workspaceId: workspace.id, pollId: poll.id, plan: runnableOsmPlan }) : 0,
            runnableStateLicensingPlan ? createStateLicensingTasksForPoll({ workspaceId: workspace.id, pollId: poll.id, plan: runnableStateLicensingPlan }) : 0,
        ])
        const taskCount = initialTaskCounts.reduce((total, count) => total + count, 0)
        if (taskCount === 0) {
            await supabaseAdmin
                .from("leadgen_polls")
                .update({ status: "failed", completed_at: new Date().toISOString(), error: "No source tasks could be generated. Check source mappings and target locations." })
                .eq("id", poll.id)
                .eq("workspace_id", workspace.id)
        } else {
            for (const plan of preSeedPipelinePlans) await processPipelineSourcePoll(poll.id, workspace.id, plan.key, { finalize: false })
            if (runnableOsmPlan) await processOsmPoll(poll.id, workspace.id, { finalize: false })
            if (runnableStateLicensingPlan) await processStateLicensingPoll(poll.id, workspace.id, { finalize: false })
            if (runnableStateLicensingPlan) {
                await createStateLicensingEnrichmentTasksForPoll({ workspaceId: workspace.id, pollId: poll.id, plan: runnableStateLicensingPlan })
                await processStateLicensingPoll(poll.id, workspace.id, { finalize: false })
            }
            if (runnableWebsitePlan) {
                await createWebsiteTasksForPoll({ workspaceId: workspace.id, pollId: poll.id, plan: runnableWebsitePlan })
                await processPipelineSourcePoll(poll.id, workspace.id, "website", { finalize: false })
            }
            if (postSeedPipelinePlans.length) {
                await createPipelineTasksForPoll({ workspaceId: workspace.id, pollId: poll.id, plans: postSeedPipelinePlans })
                for (const plan of postSeedPipelinePlans) await processPipelineSourcePoll(poll.id, workspace.id, plan.key, { finalize: false })
            }
            await finalizeLeadgenPoll(poll.id, workspace.id)
        }
    }
    refreshPolls(slug)
    redirect(`https://leadgen.betelgeze.com/${slug}/polls`)
}

export async function cancelLeadgenPoll(slug: string, pollId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const { error } = await supabaseAdmin
        .from("leadgen_polls")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", pollId)
        .eq("workspace_id", workspace.id)
        .in("status", ["queued", "running"])
    if (error) throw new Error("Could not cancel this poll.")
    refreshPolls(slug)
}

export async function retryLeadgenPoll(slug: string, pollId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    await supabaseAdmin
        .from("leadgen_poll_tasks")
        .update({ status: "queued", started_at: null, completed_at: null, error: null })
        .eq("poll_id", pollId)
        .eq("workspace_id", workspace.id)
        .eq("status", "failed")
    await supabaseAdmin
        .from("leadgen_polls")
        .update({ status: "queued", error: null, completed_at: null })
        .eq("id", pollId)
        .eq("workspace_id", workspace.id)
    await processOsmPoll(pollId, workspace.id, { finalize: false })
    await processStateLicensingPoll(pollId, workspace.id, { finalize: false })
    await processPipelineSourcePoll(pollId, workspace.id, "website", { finalize: false })
    await processPipelineSourcePoll(pollId, workspace.id, "overture", { finalize: false })
    await processPipelineSourcePoll(pollId, workspace.id, "opencorporates", { finalize: false })
    await processPipelineSourcePoll(pollId, workspace.id, "sam_gov", { finalize: false })
    await finalizeLeadgenPoll(pollId, workspace.id)
    refreshPolls(slug)
}

export async function removeLeadgenPoll(slug: string, pollId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    await supabaseAdmin.from("leadgen_source_records").delete().eq("poll_id", pollId).eq("workspace_id", workspace.id)
    await supabaseAdmin.from("leadgen_poll_tasks").delete().eq("poll_id", pollId).eq("workspace_id", workspace.id)
    await supabaseAdmin.from("leadgen_polls").delete().eq("id", pollId).eq("workspace_id", workspace.id)
    refreshPolls(slug)
}

export async function removeLeadgenCompany(slug: string, companyId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    await supabaseAdmin.from("leadgen_companies").delete().eq("id", companyId).eq("workspace_id", workspace.id)
    revalidatePath(`/leadgen/${slug}`)
}
