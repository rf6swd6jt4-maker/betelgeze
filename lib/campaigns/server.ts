import "server-only"
import { notFound } from "next/navigation"
import { cache } from "react"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { campaignsPilotEnabled } from "@/lib/campaigns/pilot"
import type { CampaignStage, CampaignTagTone, CampaignSourceStatus, MeetingPlace } from "@/lib/campaigns/model"

export type CampaignRow = { id: string; name: string; status: string; created_at: string; sms_number_id?: string | null }
export type CampaignSourceRow = {
    id: string; campaign_id: string; name: string; tag: string; tag_tone: CampaignTagTone; page_url: string | null; allowed_origins: string[]
    status: CampaignSourceStatus; intake_key: string; books: boolean; booking_slug: string | null; meeting_title: string; meeting_minutes: number
    meeting_place: MeetingPlace; meeting_link: string | null; time_zone: string; booking_days: number[]; day_start_minute: number; day_end_minute: number
    notice_hours: number; horizon_days: number; pay_amount_cents: number | null; hold_minutes: number; refund_rule: string | null; created_at: string; updated_at: string
    sms_number_id: string | null; setter_user_id: string | null
}
export type CampaignLeadRow = {
    id: string; reference: string; first_name: string; last_name: string | null; company: string | null; phone_e164: string; email: string | null; stage: CampaignStage
    latest_source_id: string | null; sms_number_id: string | null; is_test: boolean; answers: { id?: string; question?: string; answer?: string }[]; first_submitted_at: string
    last_submitted_at: string; submission_count: number; sms_consent: string; first_attribution: Record<string, unknown>; latest_campaign_id: string
    assigned_to: string | null; call_due_at: string | null; call_reason: string | null
}
export type CampaignBookingRow = {
    id: string; lead_id: string; source_id: string; starts_at: string; ends_at: string; status: string; held_until: string | null
    amount_cents: number | null; paid_at: string | null; booked_by: string; created_at: string; confirmed_at: string | null
}
export type CampaignEventRow = { id: string; kind: string; detail: Record<string, unknown>; created_at: string }

const SOURCE_FIELDS = "id, campaign_id, name, tag, tag_tone, page_url, allowed_origins, status, intake_key, books, booking_slug, meeting_title, meeting_minutes, meeting_place, meeting_link, time_zone, booking_days, day_start_minute, day_end_minute, notice_hours, horizon_days, pay_amount_cents, hold_minutes, refund_rule, created_at, updated_at, sms_number_id, setter_user_id"
const LEAD_FIELDS = "id, reference, first_name, last_name, company, phone_e164, email, stage, latest_source_id, is_test, answers, first_submitted_at, last_submitted_at, submission_count, sms_consent, first_attribution, latest_campaign_id, sms_number_id, assigned_to, call_due_at, call_reason"
const BOOKING_FIELDS = "id, lead_id, source_id, starts_at, ends_at, status, held_until, amount_cents, paid_at, booked_by, created_at, confirmed_at"
/** The pipeline shows the most recent leads; older ones stay reachable as the campaign grows (later: paging). */
export const CAMPAIGN_LEAD_LIMIT = 500

/** Campaigns are a pilot for listed people (CAMPAIGNS_PILOT_USERS) who are owners or admins. Anyone else gets a 404. */
export const requireCampaigns = cache(async (slug: string) => {
    const context = await requireWorkspace(slug, "admin")
    if (!campaignsPilotEnabled(context.user.id)) notFound()
    return context
})

function fail(error: { message: string } | null, what: string) {
    if (error) throw new Error(`Could not load ${what}. Please retry.`)
}

export async function loadCampaigns(workspaceId: string) {
    const { data, error } = await supabaseAdmin.from("campaigns").select("id, name, status, created_at").eq("workspace_id", workspaceId).neq("status", "archived").order("created_at").limit(100)
    fail(error, "campaigns")
    return (data ?? []) as CampaignRow[]
}

export async function loadCampaign(workspaceId: string, campaignId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return null
    const [campaign, sources] = await Promise.all([
        supabaseAdmin.from("campaigns").select("id, name, status, created_at, sms_number_id").eq("workspace_id", workspaceId).eq("id", campaignId).neq("status", "archived").maybeSingle(),
        supabaseAdmin.from("campaign_sources").select(SOURCE_FIELDS).eq("workspace_id", workspaceId).eq("campaign_id", campaignId).order("created_at").limit(50),
    ])
    fail(campaign.error, "the campaign"); fail(sources.error, "sources")
    if (!campaign.data) return null
    return { campaign: campaign.data as CampaignRow, sources: (sources.data ?? []) as CampaignSourceRow[] }
}

/** The campaign's latest leads and their open or most recent bookings, in two bounded reads. */
export async function loadCampaignLeads(workspaceId: string, campaignId: string) {
    const { data, error } = await supabaseAdmin.from("campaign_leads").select(LEAD_FIELDS).eq("workspace_id", workspaceId).eq("latest_campaign_id", campaignId)
        .order("last_submitted_at", { ascending: false }).limit(CAMPAIGN_LEAD_LIMIT)
    fail(error, "leads")
    const leads = (data ?? []) as CampaignLeadRow[]
    if (!leads.length) return { leads, bookings: new Map<string, CampaignBookingRow>() }
    const { data: bookingRows, error: bookingError } = await supabaseAdmin.from("campaign_bookings").select(BOOKING_FIELDS).eq("workspace_id", workspaceId)
        .in("lead_id", leads.map(lead => lead.id)).in("status", ["held", "booked", "showed", "no_show"]).order("created_at", { ascending: false }).limit(CAMPAIGN_LEAD_LIMIT * 2)
    fail(bookingError, "bookings")
    const bookings = new Map<string, CampaignBookingRow>()
    for (const booking of (bookingRows ?? []) as CampaignBookingRow[]) {
        if (booking.status === "held" && booking.held_until && new Date(booking.held_until) <= new Date()) continue
        if (!bookings.has(booking.lead_id)) bookings.set(booking.lead_id, booking)
    }
    return { leads, bookings }
}

/** How many of the campaign's leads are not booked yet (including paid ones), for its header. */
export async function loadNotBookedCount(workspaceId: string, campaignId: string) {
    const { count, error } = await supabaseAdmin.from("campaign_leads").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).eq("latest_campaign_id", campaignId).in("stage", ["not_booked", "paid_not_booked"])
    fail(error, "lead counts")
    return count ?? 0
}

export async function loadCampaignSource(workspaceId: string, sourceId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(sourceId)) return null
    const { data, error } = await supabaseAdmin.from("campaign_sources").select(SOURCE_FIELDS).eq("workspace_id", workspaceId).eq("id", sourceId).maybeSingle()
    fail(error, "the source")
    return (data ?? null) as CampaignSourceRow | null
}

export async function loadSourceStats(workspaceId: string, sourceId: string) {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const [week, last] = await Promise.all([
        supabaseAdmin.from("campaign_lead_submissions").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("source_id", sourceId).gte("received_at", since),
        supabaseAdmin.from("campaign_lead_submissions").select("received_at").eq("workspace_id", workspaceId).eq("source_id", sourceId).order("received_at", { ascending: false }).limit(1).maybeSingle(),
    ])
    fail(week.error, "source activity"); fail(last.error, "source activity")
    return { week: week.count ?? 0, lastAt: (last.data?.received_at as string | undefined) ?? null }
}

export async function loadCampaignLead(workspaceId: string, leadId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(leadId)) return null
    const [lead, bookings, events] = await Promise.all([
        supabaseAdmin.from("campaign_leads").select(LEAD_FIELDS).eq("workspace_id", workspaceId).eq("id", leadId).maybeSingle(),
        supabaseAdmin.from("campaign_bookings").select(BOOKING_FIELDS).eq("workspace_id", workspaceId).eq("lead_id", leadId).order("created_at", { ascending: false }).limit(20),
        supabaseAdmin.from("campaign_lead_events").select("id, kind, detail, created_at").eq("workspace_id", workspaceId).eq("lead_id", leadId).order("created_at", { ascending: false }).limit(100),
    ])
    fail(lead.error, "the lead"); fail(bookings.error, "bookings"); fail(events.error, "activity")
    if (!lead.data) return null
    const rows = (bookings.data ?? []) as CampaignBookingRow[]
    const now = Date.now()
    // The appointment shown on the lead's page: a booked time, or a hold that has not lapsed.
    const current = rows.find(booking => booking.status === "booked" || (booking.status === "held" && booking.held_until !== null && new Date(booking.held_until).getTime() > now)) ?? null
    return { lead: lead.data as CampaignLeadRow, bookings: rows, current, events: (events.data ?? []) as CampaignEventRow[] }
}

export const ADMIN_ACTIONS = ["create", "create_source", "update_source", "set_stage", "booking_status", "update_campaign"] as const
export type CampaignAdminAction = (typeof ADMIN_ACTIONS)[number]

export async function runCampaignAdmin(workspaceId: string, actorId: string, action: CampaignAdminAction, input: Record<string, unknown>) {
    const { data, error } = await supabaseAdmin.rpc("campaign_admin", { p_action: action, p_input: { ...input, workspace_id: workspaceId, actor_id: actorId } })
    if (error) return { ok: false as const, error: error.code === "P0001" ? error.message : "Could not save. Please retry." }
    return { ok: true as const, data: data as Record<string, unknown> }
}
