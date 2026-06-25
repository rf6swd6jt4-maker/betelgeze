"use server"

import { revalidatePath } from "next/cache"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { buildSourcePlan, type LeadgenSourceConfig } from "@/lib/leadgen/sources"
import { createYelpTasksForPoll, processYelpPoll } from "@/lib/leadgen/yelp-worker"

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
    const yelpPlan = sourcePlan.find((source) => source.key === "yelp")
    const hasRunnableSources = Boolean(yelpPlan && yelpPlan.industries.length > 0 && yelpPlan.locations.length > 0)
    const { data: poll, error } = await supabaseAdmin.from("leadgen_polls").insert({
        workspace_id: workspace.id,
        requested_by: user.id,
        trigger: "manual",
        status: hasRunnableSources ? "queued" : "failed",
        source_count: sourcePlan.length,
        source_snapshot: sourcePlan,
        error: hasRunnableSources ? null : "Enable Yelp and select at least one industry and one location in Settings.",
        completed_at: hasRunnableSources ? null : new Date().toISOString(),
    }).select("id").single()
    if (error) throw new Error("Could not queue a new leadgen poll.")
    if (poll?.id && yelpPlan) {
        const taskCount = await createYelpTasksForPoll({ workspaceId: workspace.id, pollId: poll.id, plan: yelpPlan })
        if (taskCount === 0) {
            await supabaseAdmin
                .from("leadgen_polls")
                .update({ status: "failed", completed_at: new Date().toISOString(), error: "No Yelp tasks could be generated. Check industry mappings and target locations." })
                .eq("id", poll.id)
                .eq("workspace_id", workspace.id)
        } else {
            await processYelpPoll(poll.id, workspace.id)
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
