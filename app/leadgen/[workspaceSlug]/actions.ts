"use server"

import { revalidatePath } from "next/cache"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { buildSourcePlan, type LeadgenSourceConfig } from "@/lib/leadgen/sources"
import { createOsmTasksForPoll, finalizeLeadgenPoll, processOsmPoll } from "@/lib/leadgen/osm-worker"
import { createStateLicensingTasksForPoll, processStateLicensingPoll } from "@/lib/leadgen/state-licensing-worker"

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
    const sourcePlan = buildSourcePlan(enabledSources, configObject(settings?.source_config))
    const osmPlan = sourcePlan.find((source) => source.key === "osm")
    const stateLicensingPlan = sourcePlan.find((source) => source.key === "state_licensing")
    const runnableOsmPlan = osmPlan && osmPlan.industries.length > 0 && osmPlan.locations.length > 0 ? osmPlan : null
    const runnableStateLicensingPlan = stateLicensingPlan && stateLicensingPlan.industries.length > 0 && stateLicensingPlan.locations.length > 0 ? stateLicensingPlan : null
    const runnablePlans = sourcePlan.filter((source) => source.industries.length > 0 && source.locations.length > 0)
    const hasRunnableSources = runnablePlans.length > 0
    const { data: poll, error } = await supabaseAdmin.from("leadgen_polls").insert({
        workspace_id: workspace.id,
        requested_by: user.id,
        trigger: "manual",
        status: hasRunnableSources ? "queued" : "failed",
        source_count: sourcePlan.length,
        source_snapshot: sourcePlan,
        error: hasRunnableSources ? null : "Enable at least one source and select at least one industry and one location in Settings.",
        completed_at: hasRunnableSources ? null : new Date().toISOString(),
    }).select("id").single()
    if (error) throw new Error("Could not queue a new leadgen poll.")
    if (poll?.id && hasRunnableSources) {
        const taskCounts = await Promise.all([
            runnableOsmPlan ? createOsmTasksForPoll({ workspaceId: workspace.id, pollId: poll.id, plan: runnableOsmPlan }) : 0,
            runnableStateLicensingPlan ? createStateLicensingTasksForPoll({ workspaceId: workspace.id, pollId: poll.id, plan: runnableStateLicensingPlan }) : 0,
        ])
        const taskCount = taskCounts.reduce((total, count) => total + count, 0)
        if (taskCount === 0) {
            await supabaseAdmin
                .from("leadgen_polls")
                .update({ status: "failed", completed_at: new Date().toISOString(), error: "No source tasks could be generated. Check source mappings and target locations." })
                .eq("id", poll.id)
                .eq("workspace_id", workspace.id)
        } else {
            if (runnableOsmPlan) await processOsmPoll(poll.id, workspace.id, { finalize: false })
            if (runnableStateLicensingPlan) await processStateLicensingPoll(poll.id, workspace.id, { finalize: false })
            await finalizeLeadgenPoll(poll.id, workspace.id)
        }
    }
    refreshPolls(slug)
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
