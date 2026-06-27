"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { configObject, createInitialLeadgenPollTasks, planLeadgenSources, processLeadgenPoll } from "@/lib/leadgen/poll-runner"
import { executableLeadgenSources } from "@/lib/leadgen/sources"

function refreshPolls(slug: string) {
    revalidatePath(`/leadgen/${slug}`)
    revalidatePath(`/leadgen/${slug}/polls`)
    revalidatePath(`/leadgen/${slug}/new`)
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
    const sourcePlan = planLeadgenSources(enabledSources, currentSourceConfig)
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
        const taskCount = await createInitialLeadgenPollTasks({ workspaceId: workspace.id, pollId: poll.id, sourcePlan })
        if (taskCount === 0) {
            await supabaseAdmin
                .from("leadgen_polls")
                .update({ status: "failed", completed_at: new Date().toISOString(), error: "No source tasks could be generated. Check source mappings and target locations." })
                .eq("id", poll.id)
                .eq("workspace_id", workspace.id)
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
    await processLeadgenPoll({ pollId, workspaceId: workspace.id })
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
