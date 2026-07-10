"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { configObject, createInitialLeadgenPollTasks, MAX_SEED_CANDIDATES, planLeadgenSources, processLeadgenPoll, TARGET_VALIDATED_BUSINESSES } from "@/lib/leadgen/poll-runner"
import { executableLeadgenSources, leadgenSourceRuntimeConfigured, seedLeadgenSources } from "@/lib/leadgen/sources"
import { LEADGEN_POLLING_SYSTEM_VERSION } from "@/lib/leadgen/version"
import { relationshipHubHref } from "@/lib/relationships"

type EnabledIcpValueRow = { value: string }

function refreshPolls(slug: string) {
    revalidatePath(`/${slug}/leadgen`)
    revalidatePath(`/${slug}/leadgen/polls`)
    revalidatePath(`/${slug}/leadgen/new`)
}

function selectedValues(value: unknown) {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

async function loadEnabledIcpValueSets() {
    const [industriesResult, locationsResult] = await Promise.all([
        supabaseAdmin.from("leadgen_icp_industries").select("value").eq("enabled", true),
        supabaseAdmin.from("leadgen_icp_locations").select("value").eq("enabled", true),
    ])
    if (industriesResult.error) throw new Error("Could not load supported ICP industries.")
    if (locationsResult.error) throw new Error("Could not load supported ICP locations.")
    return {
        industries: new Set(((industriesResult.data ?? []) as EnabledIcpValueRow[]).map((item) => item.value)),
        locations: new Set(((locationsResult.data ?? []) as EnabledIcpValueRow[]).map((item) => item.value)),
    }
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
    const enabledIcpValues = await loadEnabledIcpValueSets()
    const runnableSourceConfig = {
        ...currentSourceConfig,
        icp: currentSourceConfig.icp ? {
            ...currentSourceConfig.icp,
            industries: selectedValues(currentSourceConfig.icp.industries).filter((value) => enabledIcpValues.industries.has(value)),
            locations: selectedValues(currentSourceConfig.icp.locations).filter((value) => enabledIcpValues.locations.has(value)),
        } : currentSourceConfig.icp,
    }
    const sourcePlan = planLeadgenSources(enabledSources, runnableSourceConfig)
        .filter((source) => leadgenSourceRuntimeConfigured(source.key))
    const seedPlan = sourcePlan.find((source) => seedLeadgenSources.has(source.key) && executableLeadgenSources.has(source.key) && source.industries.length > 0 && source.locations.length > 0)
    const hasRunnableSources = Boolean(seedPlan)
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
            candidate_target_count: TARGET_VALIDATED_BUSINESSES,
            max_seed_candidates: MAX_SEED_CANDIDATES,
            max_enrichment_depth: runnableSourceConfig.icp?.maxEnrichmentDepth ?? null,
            owner_required: runnableSourceConfig.icp?.ownerRequired !== false,
            poll_mode: "staged_validated_business_funnel",
            polling_system_version: LEADGEN_POLLING_SYSTEM_VERSION,
            captured_at: new Date().toISOString(),
        },
        error: hasRunnableSources ? null : "Enable at least one seed source plus at least one ICP industry and one ICP location in Settings. Staged sources investigate candidates after seed tasks run.",
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
    redirect(`/${slug}/leadgen/polls`)
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
    revalidatePath(`/${slug}/leadgen`)
}

export async function promoteLeadgenCompanyToRelationship(slug: string, companyId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const { data: existingRelationship } = await supabaseAdmin
        .from("relationships")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("leadgen_company_id", companyId)
        .maybeSingle()

    if (existingRelationship?.id) {
        redirect(relationshipHubHref(workspace.slug, existingRelationship.id))
    }

    const { data: company } = await supabaseAdmin
        .from("leadgen_companies")
        .select("id, display_name, owner_name, owner_phone, phone, website_url, qualification_status, lead_score, source_key, industry_value, location_value, address, owner_identity_points, owner_phone_points, business_support_points")
        .eq("id", companyId)
        .eq("workspace_id", workspace.id)
        .maybeSingle()

    if (!company || company.qualification_status !== "qualified" || (!company.owner_name && !company.owner_phone)) {
        redirect(`/${slug}/leadgen?relationshipError=not-ready`)
    }

    const { data: relationship, error } = await supabaseAdmin
        .from("relationships")
        .insert({
            workspace_id: workspace.id,
            leadgen_company_id: company.id,
            source_type: "leadgen",
            primary_person_name: company.owner_name ?? company.owner_phone ?? company.display_name,
            primary_phone: company.owner_phone ?? company.phone ?? null,
            business_name: company.display_name,
            website_url: company.website_url ?? null,
            industry_value: company.industry_value ?? null,
            location_value: company.location_value ?? null,
            address: company.address ?? {},
            source_label: company.source_key,
            primary_contact_role: company.owner_name ? "Owner" : null,
            lifecycle_phase: "lead",
            status: "active",
            source_metadata: {
                source_key: company.source_key,
                lead_score: company.lead_score,
                owner_identity_points: company.owner_identity_points,
                owner_phone_points: company.owner_phone_points,
                business_support_points: company.business_support_points,
                promoted_from: "leadgen_companies",
            },
        })
        .select("id")
        .single()

    if (error || !relationship) {
        redirect(`/${slug}/leadgen?relationshipError=schema`)
    }

    revalidatePath(`/${slug}/leadgen`)
    revalidatePath(`/${slug}/relationships`)
    redirect(relationshipHubHref(workspace.slug, relationship.id))
}
