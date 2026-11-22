"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { ADMIN_ACTIONS, loadCampaign, loadCampaignSource, requireCampaigns, runCampaignAdmin, type CampaignAdminAction } from "@/lib/campaigns/server"
import { testLeadInput } from "@/lib/campaigns/test-lead"

/** One owner/admin command for the Campaigns screens; the database function checks access again. */
export async function campaignCommand(workspaceSlug: string, action: CampaignAdminAction, input: Record<string, unknown>) {
    if (!(ADMIN_ACTIONS as readonly string[]).includes(action)) return { ok: false as const, error: "Unknown action." }
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const result = await runCampaignAdmin(workspace.id, user.id, action, input)
    if (result.ok) revalidatePath(`/${workspace.slug}/campaigns`, "layout")
    return result
}

/** A new campaign starts as a draft with no sources. */
export async function createCampaign(workspaceSlug: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return { ok: false as const, error: "Give the campaign a name." }
    return campaignCommand(workspaceSlug, "create", { name: trimmed, allowed_origins: [], with_source: false })
}

/** Go live or pause. A campaign goes live only once one of its sources is Live. */
export async function setCampaignStatus(workspaceSlug: string, campaignId: string, status: "live" | "paused") {
    const { workspace } = await requireCampaigns(workspaceSlug)
    if (status === "live") {
        const loaded = await loadCampaign(workspace.id, campaignId)
        if (!loaded) return { ok: false as const, error: "Campaign not found." }
        if (!loaded.sources.some(source => source.status === "live")) return { ok: false as const, error: "Set one of its sources Live first." }
    }
    return campaignCommand(workspaceSlug, "update_campaign", { campaign_id: campaignId, status })
}

/**
 * Sends one Test lead into a source in Testing, through the same intake as a real form, and returns its booking page
 * so the whole flow can be tried before the landing page is connected.
 */
export async function sendTestLead(workspaceSlug: string, sourceId: string) {
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const source = await loadCampaignSource(workspace.id, sourceId)
    if (!source) return { ok: false as const, error: "Source not found." }
    if (source.status !== "testing") return { ok: false as const, error: "Switch the source to Testing to send a test lead." }
    const input = testLeadInput(source.id, user.id)
    const { data, error } = await supabaseAdmin.rpc("campaign_intake", { p_key: source.intake_key, p_input: input })
    const result = data as { accepted?: boolean; failure?: string } | null
    if (error || !result?.accepted) return { ok: false as const, error: result?.failure === "rate_limited" ? "Too many test leads in 10 minutes. Try again shortly." : "The test lead was not accepted. Please retry." }
    revalidatePath(`/${workspace.slug}/campaigns`, "layout")
    return { ok: true as const, bookingPath: source.books && source.booking_slug ? `/book/${source.booking_slug}?submission=${input.submission_id}` : null }
}
