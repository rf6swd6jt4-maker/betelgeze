"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { ADMIN_ACTIONS, loadCampaign, loadCampaignSource, requireCampaigns, runCampaignAdmin, type CampaignAdminAction } from "@/lib/campaigns/server"
import { testLeadInput } from "@/lib/campaigns/test-lead"
import { ensureLeadConversation } from "@/lib/campaigns/lead-texts"

/** One owner/admin command for the Campaigns screens; the database function checks access again. */
export async function campaignCommand(workspaceSlug: string, action: CampaignAdminAction, input: Record<string, unknown>) {
    if (!(ADMIN_ACTIONS as readonly string[]).includes(action)) return { ok: false as const, error: "Unknown action." }
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    let result = await runCampaignAdmin(workspace.id, user.id, action, input)
    // A repeated booking change (a second press before the page refreshed) already happened: report it as done.
    if (!result.ok && action === "booking_status" && typeof input.booking_id === "string") {
        const { data } = await supabaseAdmin.from("campaign_bookings").select("status").eq("id", input.booking_id).eq("workspace_id", workspace.id).maybeSingle()
        if (data?.status && data.status === input.status) result = { ok: true as const, data: { id: input.booking_id, status: data.status, repeated: true } }
    }
    if (result.ok) revalidatePath(`/${workspace.slug}/campaigns`, "layout")
    if (result.ok && (action === "set_stage" || action === "booking_status")) after(async () => { const { kickFlows } = await import("@/lib/campaigns/flows-server"); await kickFlows() })
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

/**
 * Chat on a lead: their text conversation in Comms → Leads (docs/comms-leads.md), started the first time. Owners and
 * admins with Campaigns are its participants; nothing is sent.
 */
export async function openLeadChat(workspaceSlug: string, leadId: string) {
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    if (!/^[0-9a-f-]{36}$/i.test(leadId)) return { ok: false as const, error: "Lead not found." }
    const { data: lead } = await supabaseAdmin.from("campaign_leads").select("id, first_name, last_name").eq("id", leadId).eq("workspace_id", workspace.id).maybeSingle()
    if (!lead) return { ok: false as const, error: "Lead not found." }
    try {
        const conversationId = await ensureLeadConversation(workspace.id, lead.id, user.id)
        return {
            ok: true as const, conversationId,
            title: [lead.first_name, lead.last_name].filter(Boolean).join(" "),
            href: `/${workspace.slug}/communications?mode=leads&nativeConversation=${encodeURIComponent(conversationId)}`,
        }
    } catch {
        return { ok: false as const, error: "The conversation could not open. Please retry." }
    }
}

/**
 * Lead marks used by text flows (docs/text-flows.md): the setter, the Call mark and a Confirmed appointment, and a
 * source's default setter for its new leads. Each checks the record belongs to this workspace.
 */
export async function leadMarkCommand(workspaceSlug: string, input: { kind: "setter" | "called" | "confirmed" | "source_setter"; id: string; userId?: string | null }) {
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    if (!/^[0-9a-f-]{36}$/i.test(input.id)) return { ok: false as const, error: "Not found." }
    const now = new Date().toISOString()
    const note = (leadId: string, kind: string, detail: Record<string, unknown>) => supabaseAdmin.from("campaign_lead_events").insert({ workspace_id: workspace.id, lead_id: leadId, kind, detail: { ...detail, by: user.id } })
    if (input.kind === "setter" || input.kind === "source_setter") {
        const setter = input.userId || null
        if (setter) {
            const { data: member } = await supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspace.id).eq("user_id", setter).in("role", ["owner", "admin"]).maybeSingle()
            if (!member) return { ok: false as const, error: "Setters are owners or admins of this workspace." }
        }
        if (input.kind === "source_setter") {
            const { data, error } = await supabaseAdmin.from("campaign_sources").update({ setter_user_id: setter, updated_at: now }).eq("workspace_id", workspace.id).eq("id", input.id).select("id").maybeSingle()
            if (error || !data) return { ok: false as const, error: "Could not save. Please retry." }
        } else {
            const { data, error } = await supabaseAdmin.from("campaign_leads").update({ assigned_to: setter, updated_at: now }).eq("workspace_id", workspace.id).eq("id", input.id).select("id").maybeSingle()
            if (error || !data) return { ok: false as const, error: "Could not save. Please retry." }
            await note(input.id, "setter_set", { setter_id: setter })
        }
    } else if (input.kind === "called") {
        const { data, error } = await supabaseAdmin.from("campaign_leads").update({ call_due_at: null, call_reason: null, updated_at: now }).eq("workspace_id", workspace.id).eq("id", input.id).not("call_due_at", "is", null).select("id").maybeSingle()
        if (error) return { ok: false as const, error: "Could not save. Please retry." }
        if (data) await note(input.id, "called", {})
    } else {
        const { data, error } = await supabaseAdmin.from("campaign_bookings").update({ confirmed_at: now, updated_at: now }).eq("workspace_id", workspace.id).eq("id", input.id).eq("status", "booked").select("id, lead_id").maybeSingle()
        if (error) return { ok: false as const, error: "Could not save. Please retry." }
        if (!data) return { ok: false as const, error: "Only a booked appointment can be confirmed." }
        await note(data.lead_id as string, "confirmed", { booking_id: data.id })
    }
    revalidatePath(`/${workspace.slug}/campaigns`, "layout")
    return { ok: true as const }
}
