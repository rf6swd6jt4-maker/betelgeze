import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getR2BucketName, getR2Client } from "@/lib/onboarding/uploads"
import { decryptWorkspaceIntegration } from "@/lib/workspace-integrations"
import { signalHouseObject, signalHouseRequest } from "@/lib/signalhouse/api"
import { e164ToSignalHouse, smsNumberCanSend, smsNumberName } from "@/lib/signalhouse/model"
import { sendLeadText } from "@/lib/campaigns/lead-texts"
import { runCampaignAdmin } from "@/lib/campaigns/server"
import { formatAppointment, isCampaignStage, type CampaignStage } from "@/lib/campaigns/model"
import {
    FLOW_IMAGE_MAX_BYTES, FLOW_IMAGE_TYPES, STOP_WORDS, fillFlowText, flowWarnings, leadTimeZone, nextSendingTime, parseFlowReplies, parseFlowSteps, waitUntil,
    type FlowField, type FlowImage, type FlowSettings, type FlowSourceFacts, type FlowStep, type FlowTrigger, type FlowWindowDays,
} from "@/lib/campaigns/flows"

/** Text flows on the server (docs/text-flows.md): loading and saving flows, the worker, replies and test sends. */

const SITE = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://app.betelgeze.com").replace(/\/$/, "")
const FLOW_FIELDS = "id, workspace_id, campaign_id, name, enabled, trigger_kind, trigger_stage, source_ids, stop_on_reply, stop_on_book, stop_on_pay, window_start_minute, window_end_minute, window_days, steps, replies, version, created_by, created_at, updated_at"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type FlowRow = {
    id: string; workspace_id: string; campaign_id: string; name: string; enabled: boolean; trigger_kind: FlowTrigger; trigger_stage: string | null
    source_ids: string[] | null; stop_on_reply: boolean; stop_on_book: boolean; stop_on_pay: boolean; window_start_minute: number; window_end_minute: number
    window_days: FlowWindowDays; steps: unknown; replies: unknown; version: number; created_by: string | null; created_at: string; updated_at: string
}
type RunRow = {
    id: string; workspace_id: string; flow_id: string; lead_id: string; booking_id: string | null; status: string; step_id: string | null; step_index: number
    next_at: string; lease_token: string | null; attempts: number; texts_sent: number; replied_at: string | null; started_at: string
}

function fail(error: { message: string } | null, what: string) {
    if (error) throw new Error(`Could not ${what}. Please retry.`)
}

export function flowFromRow(row: FlowRow): FlowSettings {
    return {
        id: row.id, name: row.name, enabled: row.enabled, trigger: row.trigger_kind, triggerStage: isCampaignStage(row.trigger_stage) ? row.trigger_stage : null,
        sourceIds: row.source_ids?.length ? row.source_ids : null, stopOnReply: row.stop_on_reply, stopOnBook: row.stop_on_book, stopOnPay: row.stop_on_pay,
        windowStart: row.window_start_minute, windowEnd: row.window_end_minute, windowDays: row.window_days,
        steps: parseFlowSteps(row.steps), replies: parseFlowReplies(row.replies),
    }
}

async function sourceFacts(workspaceId: string, campaignId: string) {
    const { data, error } = await supabaseAdmin.from("campaign_sources").select("id, name, tag, tag_tone, books, booking_slug, pay_amount_cents, status").eq("workspace_id", workspaceId).eq("campaign_id", campaignId).order("created_at")
    fail(error, "load the sources")
    return (data ?? []).map(source => ({ id: source.id as string, name: source.name as string, tag: source.tag as string, tone: source.tag_tone as string, books: Boolean(source.books), pays: source.pay_amount_cents !== null, status: source.status as string }))
}

/** Owners and admins with a name, for setters. */
export async function loadSetters(workspaceId: string) {
    const { data: members, error } = await supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspaceId).in("role", ["owner", "admin"])
    fail(error, "load the team")
    const ids = (members ?? []).map(member => member.user_id as string)
    const { data: profiles } = ids.length ? await supabaseAdmin.from("user_profiles").select("user_id, username, display_name").in("user_id", ids) : { data: [] }
    const byId = new Map((profiles ?? []).map(profile => [profile.user_id as string, (profile.display_name as string | null)?.trim() || (profile.username as string | null) || "Teammate"]))
    return ids.map(id => ({ id, name: byId.get(id) ?? "Teammate" })).sort((a, b) => a.name.localeCompare(b.name))
}

// ---------- The Text flows tab and the editor ----------

export async function loadCampaignFlowList(workspaceId: string, campaignId: string) {
    const [flowsResult, sources] = await Promise.all([
        supabaseAdmin.from("campaign_text_flows").select(FLOW_FIELDS).eq("workspace_id", workspaceId).eq("campaign_id", campaignId).is("deleted_at", null).order("created_at"),
        sourceFacts(workspaceId, campaignId),
    ])
    fail(flowsResult.error, "load the flows")
    const rows = (flowsResult.data ?? []) as FlowRow[]
    const { data: runs, error } = rows.length
        ? await supabaseAdmin.from("campaign_flow_runs").select("flow_id, status, replied_at").eq("workspace_id", workspaceId).in("flow_id", rows.map(row => row.id)).order("started_at", { ascending: false }).limit(5000)
        : { data: [], error: null }
    fail(error, "load the flow counts")
    return rows.map(row => {
        const flow = flowFromRow(row)
        const own = (runs ?? []).filter(run => run.flow_id === row.id)
        return {
            flow, warnings: flowWarnings(flow, sources).length, texts: flow.steps.filter(step => step.kind === "text").length,
            active: own.filter(run => run.status === "active").length,
            replied: own.length ? Math.round(own.filter(run => run.replied_at).length / own.length * 100) : null,
        }
    })
}

export async function loadFlowEditor(workspaceId: string, campaignId: string, flowId: string) {
    if (!UUID.test(flowId)) return null
    const { data: row, error } = await supabaseAdmin.from("campaign_text_flows").select(FLOW_FIELDS).eq("workspace_id", workspaceId).eq("campaign_id", campaignId).eq("id", flowId).is("deleted_at", null).maybeSingle()
    fail(error, "load the flow")
    if (!row) return null
    const flow = flowFromRow(row as FlowRow)
    const [sources, setters, runsResult, leadsResult, campaignResult] = await Promise.all([
        sourceFacts(workspaceId, campaignId),
        loadSetters(workspaceId),
        supabaseAdmin.from("campaign_flow_runs").select("id, lead_id, step_index, started_at").eq("workspace_id", workspaceId).eq("flow_id", flowId).eq("status", "active").order("started_at", { ascending: false }).limit(200),
        supabaseAdmin.from("campaign_leads").select("id, reference, first_name, last_name, company, phone_e164, assigned_to, latest_source_id").eq("workspace_id", workspaceId).eq("latest_campaign_id", campaignId).order("last_submitted_at", { ascending: false }).limit(60),
        supabaseAdmin.from("campaigns").select("id, name, sms_number_id").eq("workspace_id", workspaceId).eq("id", campaignId).maybeSingle(),
    ])
    fail(runsResult.error, "load the leads in this flow"); fail(leadsResult.error, "load the leads"); fail(campaignResult.error, "load the campaign")
    const runs = runsResult.data ?? []
    const missing = runs.map(run => run.lead_id as string).filter(id => !(leadsResult.data ?? []).some(lead => lead.id === id))
    const { data: extra } = missing.length ? await supabaseAdmin.from("campaign_leads").select("id, reference, first_name, last_name, company, phone_e164, assigned_to, latest_source_id").eq("workspace_id", workspaceId).in("id", missing) : { data: [] }
    const leads = [...(leadsResult.data ?? []), ...(extra ?? [])]
    const leadIds = leads.map(lead => lead.id as string)
    const { data: bookings } = leadIds.length ? await supabaseAdmin.from("campaign_bookings").select("id, lead_id, source_id, starts_at, held_until, status").eq("workspace_id", workspaceId).in("lead_id", leadIds).in("status", ["held", "booked", "no_show", "showed"]).order("created_at", { ascending: false }).limit(200) : { data: [] }
    const { data: sourceRows } = await supabaseAdmin.from("campaign_sources").select("id, booking_slug, books, meeting_place, meeting_link, time_zone").eq("workspace_id", workspaceId).eq("campaign_id", campaignId)
    const setterName = new Map(setters.map(setter => [setter.id, setter.name]))
    // Each lead's fields, for the editor's "Fill in as" preview.
    const previews = leads.map(lead => {
        const source = (sourceRows ?? []).find(item => item.id === lead.latest_source_id)
        const booking = (bookings ?? []).find(item => item.lead_id === lead.id) ?? null
        return {
            id: lead.id as string, name: [lead.first_name, lead.last_name].filter(Boolean).join(" "), company: (lead.company as string | null) ?? null, sourceId: (lead.latest_source_id as string | null) ?? null,
            fields: leadFields({ lead, source: source ?? null, booking, setterName: lead.assigned_to ? setterName.get(lead.assigned_to as string) ?? null : null }),
        }
    })
    let numberName: string | null = null
    if (campaignResult.data?.sms_number_id) {
        const { data: number } = await supabaseAdmin.from("campaign_sms_numbers").select("phone_e164, label").eq("id", campaignResult.data.sms_number_id).maybeSingle()
        numberName = number ? smsNumberName(number as { phone_e164: string; label: string }) : null
    }
    return {
        flow, sources, setters, previews, numberName, campaignName: (campaignResult.data?.name as string) ?? "", updatedAt: (row as FlowRow).updated_at,
        inFlow: runs.map(run => ({ runId: run.id as string, leadId: run.lead_id as string, stepIndex: run.step_index as number, startedAt: run.started_at as string })),
    }
}

type LeadFieldInput = {
    lead: { reference?: unknown; first_name?: unknown; company?: unknown; phone_e164?: unknown }
    source: { booking_slug?: unknown; books?: unknown; meeting_place?: unknown; meeting_link?: unknown; time_zone?: unknown } | null
    booking: { starts_at?: unknown; held_until?: unknown; status?: unknown } | null
    setterName: string | null
}

const formatPhone = (value: string) => value.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3")

/** The values a lead's texts are filled in with. */
export function leadFields(input: LeadFieldInput): Partial<Record<FlowField, string | null>> {
    const zone = typeof input.source?.time_zone === "string" ? input.source.time_zone : "America/Chicago"
    const link = input.source?.books && typeof input.source.booking_slug === "string" && typeof input.lead.reference === "string" ? `${SITE}/book/${input.source.booking_slug}?ref=${input.lead.reference}` : null
    const startsAt = typeof input.booking?.starts_at === "string" ? input.booking.starts_at : null
    const heldUntil = typeof input.booking?.held_until === "string" ? input.booking.held_until : null
    const place = input.source?.meeting_place
    const meeting = place === "zoom" || place === "google_meet"
        ? (typeof input.source?.meeting_link === "string" && input.source.meeting_link ? `Join here: ${input.source.meeting_link}` : `We'll send the ${place === "zoom" ? "Zoom" : "Google Meet"} link before the call`)
        : typeof input.lead.phone_e164 === "string" ? `We'll call you on ${formatPhone(input.lead.phone_e164)}` : null
    return {
        first_name: typeof input.lead.first_name === "string" ? input.lead.first_name : null,
        business: typeof input.lead.company === "string" && input.lead.company ? input.lead.company : "your business",
        setter_first_name: input.setterName ? input.setterName.split(/\s+/)[0] : "the Scaylup team",
        booking_link: link, payment_link: link,
        appointment_time: startsAt ? formatAppointment(startsAt, zone) : null,
        hold_until: heldUntil ? new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(heldUntil)) : null,
        meeting_details: meeting,
    }
}

const STARTERS: Omit<FlowSettings, "id" | "enabled" | "sourceIds" | "windowStart" | "windowEnd" | "windowDays">[] = [
    { name: "Instant reply", trigger: "new", triggerStage: null, stopOnReply: true, stopOnBook: true, stopOnPay: false, replies: [], steps: [
        { id: "s1", kind: "text", body: "Hi {first_name}, it's {setter_first_name} from Scaylup. Thanks for your answers. Pick your time here: {booking_link}", image: null },
        { id: "s2", kind: "wait", mode: "for", amount: 10, unit: "minutes" },
        { id: "s3", kind: "if", condition: "notbooked" },
        { id: "s4", kind: "text", body: "Quick one, {first_name}: want me to just call you? Reply with a time that works.", image: null },
        { id: "s5", kind: "wait", mode: "for", amount: 1, unit: "days" },
        { id: "s6", kind: "act", action: "task", value: null }] },
    { name: "Picked a time, didn't pay", trigger: "hold", triggerStage: null, stopOnReply: true, stopOnBook: false, stopOnPay: true, replies: [], steps: [
        { id: "s1", kind: "text", body: "Your {appointment_time} slot is held until {hold_until}, {first_name}. Pay here to keep it: {payment_link}", image: null },
        { id: "s2", kind: "wait", mode: "hold", amount: 1, unit: "minutes" },
        { id: "s3", kind: "if", condition: "notpaid" },
        { id: "s4", kind: "text", body: "Your {appointment_time} hold ran out, {first_name}. Pick a time again and pay to keep it: {booking_link}", image: null },
        { id: "s5", kind: "wait", mode: "for", amount: 1, unit: "days" },
        { id: "s6", kind: "act", action: "task", value: null }] },
    { name: "Booking confirmation and reminders", trigger: "booked", triggerStage: null, stopOnReply: false, stopOnBook: false, stopOnPay: false, replies: [{ word: "C", action: "confirm" }, { word: "R", action: "task" }], steps: [
        { id: "s1", kind: "text", body: "You're booked, {first_name}: {appointment_time}. {meeting_details}.", image: null },
        { id: "s2", kind: "wait", mode: "before", amount: 24, unit: "hours" },
        { id: "s3", kind: "if", condition: "stillbooked" },
        { id: "s4", kind: "text", body: "Reminder: we're on tomorrow, {appointment_time}. Reply C to confirm or R to reschedule.", image: null },
        { id: "s5", kind: "wait", mode: "before", amount: 1, unit: "hours" },
        { id: "s6", kind: "text", body: "Talk in an hour, {first_name}.", image: null }] },
    { name: "No-show follow-up", trigger: "noshow", triggerStage: null, stopOnReply: true, stopOnBook: true, stopOnPay: false, replies: [], steps: [
        { id: "s1", kind: "text", body: "Hi {first_name}, sorry we missed you. Pick a new time here: {booking_link}", image: null },
        { id: "s2", kind: "wait", mode: "for", amount: 2, unit: "days" },
        { id: "s3", kind: "if", condition: "notbooked" },
        { id: "s4", kind: "text", body: "Still happy to talk, {first_name}. Grab any time that suits: {booking_link}", image: null },
        { id: "s5", kind: "wait", mode: "for", amount: 3, unit: "days" },
        { id: "s6", kind: "act", action: "stage", value: "lost" }] },
]

function flowColumns(flow: Partial<FlowSettings>) {
    const row: Record<string, unknown> = {}
    if (flow.name !== undefined) row.name = flow.name.trim().slice(0, 120) || "Untitled flow"
    if (flow.trigger !== undefined) row.trigger_kind = flow.trigger
    if (flow.triggerStage !== undefined || flow.trigger !== undefined) row.trigger_stage = flow.trigger === "stage" ? flow.triggerStage ?? "not_booked" : flow.trigger === undefined ? flow.triggerStage : null
    if (flow.sourceIds !== undefined) row.source_ids = flow.sourceIds && flow.sourceIds.length ? flow.sourceIds.filter(id => UUID.test(id)).slice(0, 50) : null
    if (flow.stopOnReply !== undefined) row.stop_on_reply = flow.stopOnReply
    if (flow.stopOnBook !== undefined) row.stop_on_book = flow.stopOnBook
    if (flow.stopOnPay !== undefined) row.stop_on_pay = flow.stopOnPay
    if (flow.windowStart !== undefined) row.window_start_minute = flow.windowStart
    if (flow.windowEnd !== undefined) row.window_end_minute = flow.windowEnd
    if (flow.windowDays !== undefined) row.window_days = flow.windowDays
    if (flow.steps !== undefined) row.steps = parseFlowSteps(flow.steps)
    if (flow.replies !== undefined) row.replies = parseFlowReplies(flow.replies)
    return row
}

export async function createFlows(workspaceId: string, campaignId: string, actorId: string, kind: "blank" | "starters") {
    const rows = (kind === "starters" ? STARTERS : [{ name: "New flow", trigger: "new" as const, triggerStage: null, stopOnReply: true, stopOnBook: true, stopOnPay: false, replies: [], steps: [{ id: "s1", kind: "text" as const, body: "", image: null }] }])
        .map(flow => ({ workspace_id: workspaceId, campaign_id: campaignId, created_by: actorId, enabled: false, ...flowColumns(flow) }))
    const { data, error } = await supabaseAdmin.from("campaign_text_flows").insert(rows).select("id")
    fail(error, "create the flow")
    return (data ?? []).map(row => row.id as string)
}

/** Saves an edit. Switching on needs no warnings left; switching off or deleting stops the leads in it where they are. */
export async function updateFlow(workspaceId: string, campaignId: string, flowId: string, patch: Partial<FlowSettings>) {
    const { data: row, error } = await supabaseAdmin.from("campaign_text_flows").select(FLOW_FIELDS).eq("workspace_id", workspaceId).eq("campaign_id", campaignId).eq("id", flowId).is("deleted_at", null).maybeSingle()
    fail(error, "load the flow")
    if (!row) return { ok: false as const, error: "Flow not found." }
    const current = flowFromRow(row as FlowRow)
    const next: FlowSettings = { ...current, ...patch, steps: patch.steps !== undefined ? parseFlowSteps(patch.steps) : current.steps, replies: patch.replies !== undefined ? parseFlowReplies(patch.replies) : current.replies }
    if (next.trigger === "stage" && !next.triggerStage) next.triggerStage = "not_booked"
    if (next.windowEnd <= next.windowStart) return { ok: false as const, error: "The sending hours must end after they start." }
    const enabled = patch.enabled ?? current.enabled
    if (enabled && !current.enabled) {
        const warnings = flowWarnings(next, await sourceFacts(workspaceId, campaignId))
        if (warnings.length) return { ok: false as const, error: "Fix the things listed at the top first." }
    }
    const { error: updateError } = await supabaseAdmin.from("campaign_text_flows").update({ ...flowColumns({ ...patch, ...(patch.trigger !== undefined ? { triggerStage: next.triggerStage } : {}) }), enabled, version: (row as FlowRow).version + 1, updated_at: new Date().toISOString() }).eq("id", flowId).eq("workspace_id", workspaceId)
    if (updateError) return { ok: false as const, error: "Could not save. Please retry." }
    if (!enabled && current.enabled) await endFlowRuns(workspaceId, flowId, "flow_off")
    return { ok: true as const }
}

export async function duplicateFlow(workspaceId: string, campaignId: string, flowId: string, actorId: string) {
    const { data: row } = await supabaseAdmin.from("campaign_text_flows").select(FLOW_FIELDS).eq("workspace_id", workspaceId).eq("campaign_id", campaignId).eq("id", flowId).is("deleted_at", null).maybeSingle()
    if (!row) return null
    const flow = flowFromRow(row as FlowRow)
    const { data, error } = await supabaseAdmin.from("campaign_text_flows").insert({ workspace_id: workspaceId, campaign_id: campaignId, created_by: actorId, enabled: false, ...flowColumns({ ...flow, name: `${flow.name} (copy)` }) }).select("id").single()
    fail(error, "copy the flow")
    return data!.id as string
}

export async function deleteFlow(workspaceId: string, campaignId: string, flowId: string) {
    const { error } = await supabaseAdmin.from("campaign_text_flows").update({ deleted_at: new Date().toISOString(), enabled: false, updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("campaign_id", campaignId).eq("id", flowId)
    fail(error, "delete the flow")
    await endFlowRuns(workspaceId, flowId, "flow_deleted")
}

async function endFlowRuns(workspaceId: string, flowId: string, reason: string) {
    const { data } = await supabaseAdmin.from("campaign_flow_runs").update({ status: "stopped", ended_at: new Date().toISOString(), end_reason: reason, lease_token: null, lease_until: null })
        .eq("workspace_id", workspaceId).eq("flow_id", flowId).eq("status", "active").select("id, lead_id")
    const { data: flow } = await supabaseAdmin.from("campaign_text_flows").select("name").eq("id", flowId).maybeSingle()
    if (data?.length) await supabaseAdmin.from("campaign_lead_events").insert(data.map(run => ({ workspace_id: workspaceId, lead_id: run.lead_id, kind: "flow_stopped", detail: { flow_id: flowId, flow: flow?.name ?? "", run_id: run.id, reason } })))
}

/** "Take out": the lead gets no more texts from this flow. */
export async function removeFromFlow(workspaceId: string, runId: string, actorId: string) {
    const { data } = await supabaseAdmin.from("campaign_flow_runs").update({ status: "stopped", ended_at: new Date().toISOString(), end_reason: "removed", lease_token: null, lease_until: null })
        .eq("workspace_id", workspaceId).eq("id", runId).eq("status", "active").select("id, lead_id, flow_id").maybeSingle()
    if (!data) return false
    const { data: flow } = await supabaseAdmin.from("campaign_text_flows").select("name").eq("id", data.flow_id).maybeSingle()
    await supabaseAdmin.from("campaign_lead_events").insert({ workspace_id: workspaceId, lead_id: data.lead_id, kind: "flow_stopped", detail: { flow_id: data.flow_id, flow: flow?.name ?? "", run_id: data.id, reason: "removed", by: actorId } })
    return true
}

// ---------- Pictures ----------

export async function storeFlowImage(workspaceId: string, flowId: string, file: { bytes: Uint8Array; name: string; type: string }): Promise<FlowImage | { error: string }> {
    const type = file.type.toLowerCase()
    if (!FLOW_IMAGE_TYPES.includes(type as typeof FLOW_IMAGE_TYPES[number])) return { error: "Use a JPG, PNG or GIF picture." }
    if (!file.bytes.byteLength || file.bytes.byteLength > FLOW_IMAGE_MAX_BYTES) return { error: "Pictures must be under 500 KB so every carrier delivers them." }
    const extension = type === "image/png" ? "png" : type === "image/gif" ? "gif" : "jpg"
    const path = `${workspaceId}/campaigns/flows/${flowId}/${randomUUID()}.${extension}`
    await getR2Client().send(new PutObjectCommand({ Bucket: getR2BucketName(), Key: path, Body: file.bytes, ContentType: type, ContentLength: file.bytes.byteLength, CacheControl: "private, max-age=3600" }), { abortSignal: AbortSignal.timeout(25_000) })
    return { path, fileName: file.name.replace(/[\u0000-\u001f\u007f/\\]/g, " ").trim().slice(0, 120) || `picture.${extension}`, mimeType: type, size: file.bytes.byteLength }
}

export async function readFlowImage(path: string) {
    const response = await getR2Client().send(new GetObjectCommand({ Bucket: getR2BucketName(), Key: path }), { abortSignal: AbortSignal.timeout(20_000) })
    const bytes = await response.Body?.transformToByteArray()
    if (!bytes?.byteLength) throw new Error("The picture is missing.")
    return { bytes, type: response.ContentType ?? "image/jpeg" }
}

// ---------- The worker ----------

/** A stable request id per run and step, so a retried step never sends twice. */
function stepRequestId(runId: string, stepId: string) {
    const hex = createHash("sha256").update(`flow:${runId}:${stepId}`).digest("hex")
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${(8 + (parseInt(hex[16], 16) & 3)).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

async function note(workspaceId: string, leadId: string, kind: string, detail: Record<string, unknown>) {
    await supabaseAdmin.from("campaign_lead_events").insert({ workspace_id: workspaceId, lead_id: leadId, kind, detail })
}

async function finishRun(run: RunRow, status: "done" | "stopped", reason: string, flowName: string) {
    const { data } = await supabaseAdmin.from("campaign_flow_runs").update({ status, ended_at: new Date().toISOString(), end_reason: reason, lease_token: null, lease_until: null, last_error: null })
        .eq("id", run.id).eq("lease_token", run.lease_token ?? "").select("id").maybeSingle()
    if (data) await note(run.workspace_id, run.lead_id, status === "done" ? "flow_done" : "flow_stopped", { flow_id: run.flow_id, flow: flowName, run_id: run.id, reason })
}

async function pauseRun(run: RunRow, stepIndex: number, stepId: string | null, nextAt: Date, extra: Record<string, unknown> = {}) {
    await supabaseAdmin.from("campaign_flow_runs").update({ step_index: Math.min(stepIndex, 100), step_id: stepId, next_at: nextAt.toISOString(), lease_token: null, lease_until: null, attempts: 0, last_error: null, ...extra })
        .eq("id", run.id).eq("lease_token", run.lease_token ?? "")
}

async function retryRun(run: RunRow, problem: string, flowName: string) {
    if (run.attempts >= 6) return finishRun(run, "stopped", "failed", flowName).then(() => note(run.workspace_id, run.lead_id, "flow_failed", { flow_id: run.flow_id, flow: flowName, error: problem.slice(0, 200) }))
    const delay = Math.min(30, 2 ** run.attempts) * 60_000
    await supabaseAdmin.from("campaign_flow_runs").update({ next_at: new Date(Date.now() + delay).toISOString(), lease_token: null, lease_until: null, last_error: problem.slice(0, 300) }).eq("id", run.id).eq("lease_token", run.lease_token ?? "")
}

/** Works through one run until it waits, leaves the sending hours, or ends. */
async function advanceRun(run: RunRow) {
    const { data: flowRow } = await supabaseAdmin.from("campaign_text_flows").select(`${FLOW_FIELDS}, deleted_at`).eq("id", run.flow_id).maybeSingle()
    if (!flowRow || (flowRow as { deleted_at: string | null }).deleted_at) return finishRun(run, "stopped", "flow_deleted", (flowRow as FlowRow | null)?.name ?? "")
    const flowData = flowRow as FlowRow
    const flow = flowFromRow(flowData)
    if (!flow.enabled) return finishRun(run, "stopped", "flow_off", flow.name)
    const { data: lead } = await supabaseAdmin.from("campaign_leads").select("id, workspace_id, reference, first_name, last_name, company, phone_e164, stage, sms_consent, assigned_to, latest_source_id, latest_campaign_id").eq("id", run.lead_id).maybeSingle()
    if (!lead) return finishRun(run, "stopped", "removed", flow.name)
    if (lead.sms_consent !== "opted_in") return finishRun(run, "stopped", "opted_out", flow.name)
    if (lead.stage === "sold" || lead.stage === "lost") return finishRun(run, "stopped", "closed", flow.name)
    const { data: source } = lead.latest_source_id ? await supabaseAdmin.from("campaign_sources").select("id, booking_slug, books, meeting_place, meeting_link, time_zone").eq("id", lead.latest_source_id).maybeSingle() : { data: null }
    const loadBooking = async () => {
        const query = supabaseAdmin.from("campaign_bookings").select("id, status, starts_at, held_until, paid_at, confirmed_at")
        const { data } = run.booking_id ? await query.eq("id", run.booking_id).maybeSingle()
            : await query.eq("lead_id", lead.id).in("status", ["held", "booked", "no_show", "showed"]).order("created_at", { ascending: false }).limit(1).maybeSingle()
        return data
    }
    let booking = await loadBooking()
    const setters = await loadSetters(run.workspace_id)
    const setter = setters.find(item => item.id === lead.assigned_to) ?? null
    const sender = setter?.id ?? (flowData.created_by && setters.some(item => item.id === flowData.created_by) ? flowData.created_by : setters[0]?.id ?? null)
    const timeZone = leadTimeZone(lead.phone_e164 as string, (source?.time_zone as string | undefined) ?? "America/Chicago")

    let index = run.step_id ? flow.steps.findIndex(step => step.id === run.step_id) : -1
    if (index < 0) index = Math.min(run.step_index, flow.steps.length)
    let texts = run.texts_sent
    for (let guard = 0; guard < 45; guard++) {
        const step: FlowStep | undefined = flow.steps[index]
        if (!step) return finishRun(run, "done", "finished", flow.name)
        const now = new Date()
        if (step.kind === "text") {
            const opening = nextSendingTime(now, flow, timeZone)
            if (opening.getTime() > now.getTime()) return pauseRun(run, index, step.id, opening, { texts_sent: texts })
            if (!sender) return finishRun(run, "stopped", "failed", flow.name)
            const body = fillFlowText(step.body, leadFields({ lead, source, booking, setterName: setter?.name ?? null }))
            const image = step.image ? await readFlowImage(step.image.path).then(file => ({ bytes: file.bytes, fileName: step.image!.fileName, mimeType: step.image!.mimeType })) : null
            const sent = await sendLeadText({ workspaceId: run.workspace_id, userId: sender, leadId: lead.id as string, body, clientRequestId: stepRequestId(run.id, step.id), image })
            if (!sent.ok) {
                if (sent.reason === "opted_out") return finishRun(run, "stopped", "opted_out", flow.name)
                if (sent.reason === "no_number" || sent.reason === "cannot_send") {
                    await note(run.workspace_id, run.lead_id, "flow_failed", { flow_id: flow.id, flow: flow.name, error: sent.error })
                    return finishRun(run, "stopped", "no_number", flow.name)
                }
                return retryRun(run, sent.error, flow.name)
            }
            if (!("duplicate" in sent && sent.duplicate)) {
                texts++
                await note(run.workspace_id, run.lead_id, "flow_text", { flow_id: flow.id, flow: flow.name, run_id: run.id, step: index + 1, picture: Boolean(image) })
            }
        } else if (step.kind === "wait") {
            const until = waitUntil(step, now, { timeZone, startsAt: (booking?.starts_at as string | undefined) ?? null, heldUntil: (booking?.held_until as string | undefined) ?? null })
            const next = flow.steps[index + 1]
            if (until.getTime() > now.getTime() + 15_000) return pauseRun(run, index + 1, next?.id ?? null, until, { texts_sent: texts })
        } else if (step.kind === "if") {
            booking = await loadBooking()
            const { data: liveLead } = await supabaseAdmin.from("campaign_leads").select("stage").eq("id", lead.id).maybeSingle()
            const { data: liveRun } = await supabaseAdmin.from("campaign_flow_runs").select("replied_at").eq("id", run.id).maybeSingle()
            const bookedNow = async () => Boolean((await supabaseAdmin.from("campaign_bookings").select("id").eq("lead_id", lead.id).eq("status", "booked").limit(1).maybeSingle()).data)
            const holds = step.condition === "notbooked" ? !(await bookedNow()) && !["booked", "showed", "sold"].includes(String(liveLead?.stage))
                : step.condition === "notreplied" ? !liveRun?.replied_at
                    : step.condition === "notpaid" ? !booking?.paid_at
                        : booking?.status === "booked" && Date.parse(String(booking.starts_at)) > now.getTime()
            if (!holds) return finishRun(run, "done", "condition", flow.name)
        } else if (step.kind === "act") {
            await runAction(run.workspace_id, lead.id as string, flow, flowData.created_by, step, booking?.status === "booked" ? booking.id as string : null)
        }
        index++
    }
    return pauseRun(run, index, flow.steps[index]?.id ?? null, new Date(Date.now() + 60_000), { texts_sent: texts })
}

async function runAction(workspaceId: string, leadId: string, flow: FlowSettings, authorId: string | null, step: Extract<FlowStep, { kind: "act" }>, bookingId: string | null) {
    const detail = { flow_id: flow.id, flow: flow.name }
    if (step.action === "task") {
        await supabaseAdmin.from("campaign_leads").update({ call_due_at: new Date().toISOString(), call_reason: flow.name.slice(0, 200), updated_at: new Date().toISOString() }).eq("id", leadId).eq("workspace_id", workspaceId)
        await note(workspaceId, leadId, "call_due", detail)
    } else if (step.action === "assign" && step.value) {
        const setters = await loadSetters(workspaceId)
        if (setters.some(setter => setter.id === step.value)) {
            await supabaseAdmin.from("campaign_leads").update({ assigned_to: step.value, updated_at: new Date().toISOString() }).eq("id", leadId).eq("workspace_id", workspaceId)
            await note(workspaceId, leadId, "setter_set", { ...detail, setter_id: step.value })
        }
    } else if (step.action === "confirm" && bookingId) {
        await supabaseAdmin.from("campaign_bookings").update({ confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", bookingId).eq("workspace_id", workspaceId).is("confirmed_at", null)
        await note(workspaceId, leadId, "confirmed", detail)
    } else if (step.action === "stage" && step.value && isCampaignStage(step.value) && authorId) {
        await runCampaignAdmin(workspaceId, authorId, "set_stage", { lead_id: leadId, stage: step.value as CampaignStage })
    }
}

/** Claims due runs and works through them, within a time budget. `leadId` limits it to one lead (the after-intake kick). */
export async function processFlowRuns(options: { limit?: number; leadId?: string | null; budgetMs?: number } = {}) {
    const started = Date.now()
    const { data, error } = await supabaseAdmin.rpc("campaign_flow_claim", { p_limit: options.limit ?? 50, p_lead: options.leadId ?? null })
    if (error) throw new Error(error.message)
    const runs = (data ?? []) as RunRow[]
    let processed = 0, failed = 0
    for (const run of runs) {
        if (Date.now() - started > (options.budgetMs ?? 50_000)) {
            // Out of time: release the rest at once instead of waiting for their leases.
            await supabaseAdmin.from("campaign_flow_runs").update({ lease_token: null, lease_until: null }).eq("id", run.id).eq("lease_token", run.lease_token ?? "")
            continue
        }
        try { await advanceRun(run); processed++ }
        catch (problem) {
            failed++
            await retryRun(run, problem instanceof Error ? problem.message : "Unexpected error.", "").catch(() => undefined)
        }
    }
    return { claimed: runs.length, processed, failed }
}

/** After an answer: runs due now (an instant reply) go out without waiting for the minute scheduler. */
export async function kickFlows(leadId?: string | null) {
    try { await processFlowRuns({ limit: leadId ? 10 : 20, leadId: leadId ?? null, budgetMs: 20_000 }) }
    catch { console.warn("Text flows: the after-response run could not finish; the scheduler retries.") }
}

// ---------- Replies ----------

/**
 * A lead's reply. STOP and HELP are SignalHouse's (STOP already opted them out, which stops every flow). A flow's reply
 * word does its action; any other reply stops the flows that stop on a reply. Every reply is in Comms either way.
 */
export async function applyFlowReply(workspaceId: string, leadId: string, body: string) {
    const word = body.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
    if (STOP_WORDS.has(word) || word === "HELP" || word === "INFO") return
    const { data: runs } = await supabaseAdmin.from("campaign_flow_runs").select("id, flow_id, booking_id, replied_at").eq("workspace_id", workspaceId).eq("lead_id", leadId).eq("status", "active")
    if (!runs?.length) return
    const { data: flows } = await supabaseAdmin.from("campaign_text_flows").select(FLOW_FIELDS).in("id", runs.map(run => run.flow_id))
    const now = new Date().toISOString()
    await supabaseAdmin.from("campaign_flow_runs").update({ replied_at: now }).in("id", runs.filter(run => !run.replied_at).map(run => run.id))
    for (const run of runs) {
        const row = (flows ?? []).find(item => item.id === run.flow_id) as FlowRow | undefined
        if (!row) continue
        const flow = flowFromRow(row)
        const match = flow.replies.find(reply => reply.word === word)
        const detail = { flow_id: flow.id, flow: flow.name, run_id: run.id, word }
        const stop = async (reason: string) => {
            const { data } = await supabaseAdmin.from("campaign_flow_runs").update({ status: "stopped", ended_at: now, end_reason: reason, lease_token: null, lease_until: null }).eq("id", run.id).eq("status", "active").select("id").maybeSingle()
            if (data) await note(workspaceId, leadId, "flow_stopped", { ...detail, reason })
        }
        if (!match) { if (flow.stopOnReply) await stop("replied"); continue }
        if (match.action === "stop") await stop("reply_word")
        else if (match.action === "lost" && row.created_by) await runCampaignAdmin(workspaceId, row.created_by, "set_stage", { lead_id: leadId, stage: "lost" })
        else if (match.action === "task") await runAction(workspaceId, leadId, flow, row.created_by, { id: "reply", kind: "act", action: "task", value: null }, null)
        else if (match.action === "confirm") {
            const { data: booking } = await supabaseAdmin.from("campaign_bookings").select("id").eq("lead_id", leadId).eq("status", "booked").order("starts_at").limit(1).maybeSingle()
            if (booking) await runAction(workspaceId, leadId, flow, row.created_by, { id: "reply", kind: "act", action: "confirm", value: null }, booking.id as string)
        }
    }
}

// ---------- Send me a test ----------

/** Sends every text in the flow to one phone now, filled in as a chosen lead, without the waits. Nothing is stored. */
export async function sendFlowTest(workspaceId: string, campaignId: string, flowId: string, phoneE164: string, previewLeadId: string | null) {
    if (!/^\+1[2-9]\d{9}$/.test(phoneE164)) return { ok: false as const, error: "Enter a US mobile number." }
    const editor = await loadFlowEditor(workspaceId, campaignId, flowId)
    if (!editor) return { ok: false as const, error: "Flow not found." }
    const { data: campaign } = await supabaseAdmin.from("campaigns").select("sms_number_id").eq("id", campaignId).maybeSingle()
    if (!campaign?.sms_number_id) return { ok: false as const, error: "Pick the number this campaign texts from first." }
    const { data: number } = await supabaseAdmin.from("campaign_sms_numbers").select("id, account_id, phone_e164, status, registration_external_id, added_at, removed_at").eq("id", campaign.sms_number_id).maybeSingle()
    if (!number || !number.added_at || number.removed_at) return { ok: false as const, error: "The campaign's number is not connected." }
    const [{ data: registration }, { data: account }] = await Promise.all([
        supabaseAdmin.from("signalhouse_registrations").select("status").eq("account_id", number.account_id).eq("external_id", number.registration_external_id ?? "").maybeSingle(),
        supabaseAdmin.from("signalhouse_accounts").select("status, config_encrypted").eq("id", number.account_id).maybeSingle(),
    ])
    if (!account || account.status === "disconnected" || !smsNumberCanSend(number, registration?.status)) return { ok: false as const, error: "The campaign's number cannot send yet: its 10DLC registration is not active." }
    const apiKey = decryptWorkspaceIntegration(account.config_encrypted).api_key ?? ""
    const preview = editor.previews.find(item => item.id === previewLeadId) ?? editor.previews[0]
    const texts = editor.flow.steps.filter((step): step is Extract<FlowStep, { kind: "text" }> => step.kind === "text" && Boolean(step.body.trim() || step.image)).slice(0, 10)
    if (!texts.length) return { ok: false as const, error: "This flow has no texts yet." }
    let sent = 0
    for (const step of texts) {
        const body = fillFlowText(step.body, preview?.fields ?? {})
        try {
            let result: unknown
            if (step.image) {
                const file = await readFlowImage(step.image.path)
                const form = new FormData()
                form.set("senderPhoneNumber", e164ToSignalHouse(number.phone_e164)); form.set("recipientPhoneNumber", e164ToSignalHouse(phoneE164)); form.set("messageBody", body)
                form.append("images", new Blob([file.bytes as BlobPart], { type: step.image.mimeType }), step.image.fileName)
                result = await signalHouseRequest(apiKey, "/message/mms", { method: "POST", body: form, idempotencyKey: randomUUID() })
            } else {
                result = await signalHouseRequest(apiKey, "/message/sms", { method: "POST", idempotencyKey: randomUUID(), body: { senderPhoneNumber: e164ToSignalHouse(number.phone_e164), recipientPhoneNumber: [e164ToSignalHouse(phoneE164)], messageBody: body } })
            }
            if (Number(signalHouseObject(result).enqueuedCount ?? 1) > 0) sent++
        } catch (problem) {
            return { ok: false as const, error: problem instanceof Error ? problem.message : "SignalHouse did not answer.", sent }
        }
    }
    return { ok: true as const, sent }
}

export type FlowEditorData = NonNullable<Awaited<ReturnType<typeof loadFlowEditor>>>
export type FlowListItem = Awaited<ReturnType<typeof loadCampaignFlowList>>[number]
export type { FlowSourceFacts }
