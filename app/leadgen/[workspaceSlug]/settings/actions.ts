"use server"

import { revalidatePath } from "next/cache"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { storeWorkspaceImage } from "@/lib/onboarding/uploads"
import { leadgenSourceOptions, normaliseLeadgenSourceKey, type LeadgenSourceConfig } from "@/lib/leadgen/sources"

function refresh(slug: string) {
    revalidatePath(`/leadgen/${slug}`)
    revalidatePath(`/leadgen/${slug}/settings`)
    revalidatePath(`/dashboard/${slug}`)
    revalidatePath(`/dashboard/${slug}/settings`)
}

function boundedInteger(value: FormDataEntryValue | null, fallback: number, min: number, max: number) {
    const numeric = Number(value ?? fallback)
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.floor(numeric))) : fallback
}

function sourceLimitMax(sourceValue: string, sourceKind: string) {
    if (sourceValue === "overture") return 500
    if (sourceValue === "sam_gov") return 1
    if (sourceKind === "seed") return 25
    return 80
}

export async function updateLeadgenWorkspaceName(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const name = String(formData.get("name") ?? "").trim()
    if (name.length < 2 || name.length > 100) throw new Error("Workspace names must be between 2 and 100 characters.")
    const { error } = await supabaseAdmin.from("workspaces").update({ name }).eq("id", workspace.id)
    if (error) throw new Error("Could not update workspace name.")
    refresh(slug)
}

export async function updateLeadgenCoverLayout(slug: string, bannerHeight: number, bannerPosition: number) {
    const { workspace } = await requireWorkspace(slug, "admin")
    if (!Number.isInteger(bannerHeight) || bannerHeight < 192 || bannerHeight > 288) throw new Error("Banner height must be between 192px and 288px.")
    if (!Number.isInteger(bannerPosition) || bannerPosition < 0 || bannerPosition > 100) throw new Error("Banner position must be between 0 and 100.")
    const { error } = await supabaseAdmin.from("workspaces").update({ leadgen_banner_height: bannerHeight, leadgen_banner_position: bannerPosition }).eq("id", workspace.id)
    if (error) throw new Error("Could not update leadgen cover.")
    refresh(slug)
}

export async function uploadLeadgenBanner(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const file = formData.get("banner")
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload.")
    const bannerPath = await storeWorkspaceImage(workspace.id, { name: file.name, size: file.size, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
    const { error } = await supabaseAdmin.from("workspaces").update({ leadgen_banner_path: bannerPath }).eq("id", workspace.id)
    if (error) throw new Error("The banner uploaded, but could not be saved to leadgen.")
    refresh(slug)
}

export async function uploadSharedWorkspaceLogo(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const file = formData.get("logo")
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload.")
    const logoPath = await storeWorkspaceImage(workspace.id, { name: file.name, size: file.size, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
    const { error } = await supabaseAdmin.from("workspaces").update({ logo_path: logoPath }).eq("id", workspace.id)
    if (error) throw new Error("The logo uploaded, but could not be saved to this workspace.")
    refresh(slug)
}

export async function saveLeadgenSettings(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const enabledSources = [...new Set(formData.getAll("sources")
        .map((value) => normaliseLeadgenSourceKey(String(value)))
        .filter((value): value is NonNullable<typeof value> => Boolean(value)))]
    const sourceConfig = leadgenSourceOptions.reduce<Partial<LeadgenSourceConfig>>((config, source) => {
        const limit = Number(formData.get(`sourceConfig:${source.value}:limit`) ?? 10)
        const radiusMeters = Number(formData.get(`sourceConfig:${source.value}:radiusMeters`) ?? 24000)
        const crawlDepth = Number(formData.get(`sourceConfig:${source.value}:crawlDepth`) ?? 2)
        const timeoutSeconds = Number(formData.get(`sourceConfig:${source.value}:timeoutSeconds`) ?? 10)
        const release = String(formData.get(`sourceConfig:${source.value}:release`) ?? "").trim()
        const notes = String(formData.get(`sourceConfig:${source.value}:notes`) ?? "").trim()
        config[source.value] = {
            enabled: enabledSources.includes(source.value),
            limit: Number.isFinite(limit) ? Math.min(sourceLimitMax(source.value, source.kind), Math.max(1, Math.floor(limit))) : 10,
            radiusMeters: Number.isFinite(radiusMeters) ? Math.min(40000, Math.max(1000, Math.floor(radiusMeters))) : 24000,
            crawlDepth: Number.isFinite(crawlDepth) ? Math.min(5, Math.max(1, Math.floor(crawlDepth))) : 2,
            timeoutSeconds: Number.isFinite(timeoutSeconds) ? Math.min(30, Math.max(3, Math.floor(timeoutSeconds))) : 10,
            respectRobots: formData.get(`sourceConfig:${source.value}:respectRobots`) !== "off",
            release,
            notes,
        }
        return config
    }, {
        icp: {
            industries: formData.getAll("sourceConfig:icp:industries").map((value) => String(value)),
            locations: formData.getAll("sourceConfig:icp:locations").map((value) => String(value)),
            limit: boundedInteger(formData.get("sourceConfig:icp:limit"), 1000, 10, 5000),
            maxEnrichmentDepth: boundedInteger(formData.get("sourceConfig:icp:maxEnrichmentDepth"), 4, 1, 8),
            ownerRequired: formData.get("sourceConfig:icp:ownerRequired") !== "off",
            notes: String(formData.get("sourceConfig:icp:notes") ?? "").trim(),
        },
    })
    const pollIntervalHours = Number(formData.get("pollIntervalHours") ?? 168)
    if (!Number.isInteger(pollIntervalHours) || pollIntervalHours < 1 || pollIntervalHours > 2160) throw new Error("Poll interval must be between 1 and 2160 hours.")
    const { error } = await supabaseAdmin.from("leadgen_workspace_settings").upsert({
        workspace_id: workspace.id,
        poll_interval_hours: pollIntervalHours,
        automatic_polls_enabled: formData.get("automaticPollsEnabled") === "on",
        geography: String(formData.get("geography") ?? "").trim() || null,
        icp_notes: String(formData.get("icpNotes") ?? "").trim() || null,
        enabled_sources: enabledSources,
        source_config: sourceConfig,
    })
    if (error) throw new Error("Could not save leadgen settings.")
}
