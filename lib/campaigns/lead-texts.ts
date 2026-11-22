import "server-only"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { campaignsPilotEnabled } from "@/lib/campaigns/pilot"
import { decryptWorkspaceIntegration } from "@/lib/workspace-integrations"
import { signalHouseObject, signalHouseRequest } from "@/lib/signalhouse/api"
import { e164ToSignalHouse, signalHousePhoneToE164, smsNumberCanSend } from "@/lib/signalhouse/model"
import { notifyLeadText } from "@/lib/push/chat-notifications"
import { campaignStageLabels, isCampaignStage } from "@/lib/campaigns/model"

/**
 * Lead texts in Comms (docs/comms-leads.md). A lead's conversation is a native conversation of kind "lead" whose
 * participants are the workspace's owners and admins with Campaigns; texts go out and come in through SignalHouse and
 * are stored as native messages, so reads, unread counts and alerts follow the rest of Comms.
 */

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"])
export const LEAD_TEXT_LIMIT = 1600

function fail(error: { message: string } | null, what: string) {
    if (error) throw new Error(`Could not ${what}. Please retry.`)
}

/** Owners and admins who have Campaigns: they read lead conversations and receive their alerts. */
async function leadParticipants(workspaceId: string) {
    const { data, error } = await supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspaceId).in("role", ["owner", "admin"])
    fail(error, "load the team")
    return (data ?? []).map(row => row.user_id as string).filter(userId => campaignsPilotEnabled(userId))
}

/** The lead's conversation, made on first use. Participants who gained Campaigns since are added. */
export async function ensureLeadConversation(workspaceId: string, leadId: string, createdBy: string | null = null) {
    const { data: existing, error } = await supabaseAdmin.from("workspace_native_conversations").select("id").eq("workspace_id", workspaceId).eq("kind", "lead").eq("lead_id", leadId).maybeSingle()
    fail(error, "load the conversation")
    let conversationId = existing?.id as string | undefined
    if (!conversationId) {
        const { data, error: insertError } = await supabaseAdmin.from("workspace_native_conversations").insert({ workspace_id: workspaceId, kind: "lead", lead_id: leadId, created_by: createdBy }).select("id").single()
        if (insertError?.code === "23505") return ensureLeadConversation(workspaceId, leadId, createdBy)
        fail(insertError, "start the conversation")
        conversationId = data!.id as string
    }
    const participants = await leadParticipants(workspaceId)
    if (participants.length) {
        const { error: participantError } = await supabaseAdmin.from("workspace_native_conversation_participants")
            .upsert(participants.map(userId => ({ workspace_id: workspaceId, conversation_id: conversationId, user_id: userId })), { onConflict: "conversation_id,user_id", ignoreDuplicates: true })
        fail(participantError, "add the team to the conversation")
    }
    return conversationId
}

type LeadForText = { id: string; first_name: string; last_name: string | null; company: string | null; phone_e164: string; sms_consent: string; sms_number_id: string | null; latest_source_id: string | null; latest_campaign_id: string }

/** The number a lead texts with: the one that first texted them, else their source's, else the campaign's. */
async function leadNumber(workspaceId: string, lead: LeadForText) {
    let numberId = lead.sms_number_id
    if (!numberId && lead.latest_source_id) numberId = (await supabaseAdmin.from("campaign_sources").select("sms_number_id").eq("id", lead.latest_source_id).eq("workspace_id", workspaceId).maybeSingle()).data?.sms_number_id ?? null
    if (!numberId) numberId = (await supabaseAdmin.from("campaigns").select("sms_number_id").eq("id", lead.latest_campaign_id).eq("workspace_id", workspaceId).maybeSingle()).data?.sms_number_id ?? null
    if (!numberId) return null
    const { data: number } = await supabaseAdmin.from("campaign_sms_numbers").select("id, account_id, phone_e164, status, registration_external_id, added_at, removed_at").eq("id", numberId).eq("workspace_id", workspaceId).maybeSingle()
    if (!number || !number.added_at || number.removed_at) return null
    const [{ data: registration }, { data: account }] = await Promise.all([
        supabaseAdmin.from("signalhouse_registrations").select("status").eq("account_id", number.account_id).eq("external_id", number.registration_external_id ?? "").maybeSingle(),
        supabaseAdmin.from("signalhouse_accounts").select("id, status, config_encrypted").eq("id", number.account_id).maybeSingle(),
    ])
    if (!account || account.status === "disconnected") return null
    return { ...number, canSend: smsNumberCanSend(number, registration?.status), apiKey: decryptWorkspaceIntegration(account.config_encrypted).api_key ?? "" }
}

/**
 * Sends a staff member's text to a lead and stores it in their conversation. The message is stored first (as
 * "sending"), then handed to SignalHouse: accepted, it is marked queued, so nothing sent is ever missing from Comms;
 * refused, the copy is removed and the error returned, so a retry sends again. `clientRequestId` makes a repeated press
 * send once.
 */
export async function sendLeadText(input: { workspaceId: string; userId: string; leadId: string; body: string; clientRequestId: string }) {
    const body = input.body.replace(/\r\n/g, "\n").trim()
    if (!body) return { ok: false as const, error: "Write a message first." }
    if (body.length > LEAD_TEXT_LIMIT) return { ok: false as const, error: `Texts are limited to ${LEAD_TEXT_LIMIT} characters.` }
    if (!/^[0-9a-f-]{36}$/i.test(input.clientRequestId)) return { ok: false as const, error: "Please retry." }
    const { data: lead, error } = await supabaseAdmin.from("campaign_leads").select("id, first_name, last_name, company, phone_e164, sms_consent, sms_number_id, latest_source_id, latest_campaign_id").eq("id", input.leadId).eq("workspace_id", input.workspaceId).maybeSingle()
    fail(error, "load the lead")
    if (!lead) return { ok: false as const, error: "Lead not found." }
    if (lead.sms_consent !== "opted_in") return { ok: false as const, error: "They opted out of texts, so nothing can be sent." }
    const number = await leadNumber(input.workspaceId, lead as LeadForText)
    if (!number) return { ok: false as const, error: "No texting number for this lead. Pick one on the campaign's Text flows tab." }
    if (!number.canSend || !number.apiKey) return { ok: false as const, error: "Its number cannot send yet: its 10DLC registration is not active." }
    const conversationId = await ensureLeadConversation(input.workspaceId, lead.id, input.userId)

    const { data: stored, error: insertError } = await supabaseAdmin.from("workspace_native_messages").insert({
        workspace_id: input.workspaceId, conversation_id: conversationId, sender_user_id: input.userId, client_request_id: input.clientRequestId,
        body, sms_direction: "outbound", sms_status: "sending", sms_number_id: number.id,
    }).select("id, created_at").single()
    if (insertError?.code === "23505") {
        const { data: earlier } = await supabaseAdmin.from("workspace_native_messages").select("id").eq("workspace_id", input.workspaceId).eq("client_request_id", input.clientRequestId).maybeSingle()
        return { ok: true as const, conversationId, messageId: earlier?.id as string | undefined, duplicate: true }
    }
    fail(insertError, "save the text")
    if (!lead.sms_number_id) await supabaseAdmin.from("campaign_leads").update({ sms_number_id: number.id }).eq("id", lead.id).eq("workspace_id", input.workspaceId).is("sms_number_id", null)

    let status = "queued", providerId: string | null = null, problem: string | null = null
    try {
        const result = signalHouseObject(await signalHouseRequest(number.apiKey, "/message/sms", {
            method: "POST", idempotencyKey: input.clientRequestId,
            body: { senderPhoneNumber: e164ToSignalHouse(number.phone_e164), recipientPhoneNumber: [e164ToSignalHouse(lead.phone_e164)], messageBody: body },
        }))
        const inserted = Array.isArray(result.insertedMessages) ? result.insertedMessages[0] as Record<string, unknown> | undefined : undefined
        providerId = inserted?._id ? String(inserted._id).slice(0, 100) : null
        if (Number(result.enqueuedCount ?? 1) === 0 || inserted?.status === "FAILED") {
            status = "failed"
            problem = inserted?.errorCode === "OUT" ? "They opted out of texts." : "SignalHouse did not send it."
        }
    } catch (sendError) {
        status = "failed"
        problem = sendError instanceof Error ? sendError.message : "SignalHouse did not answer."
    }
    if (status === "failed") {
        // Nothing reached the lead: remove the stored copy so the composer can retry the same request.
        await supabaseAdmin.from("workspace_native_messages").delete().eq("id", stored!.id).eq("sms_status", "sending")
        return { ok: false as const, error: `Not sent. ${problem ?? ""}`.trim(), conversationId }
    }
    await supabaseAdmin.from("workspace_native_messages").update({ sms_status: status, sms_provider_message_id: providerId }).eq("id", stored!.id)
    return { ok: true as const, conversationId, messageId: stored!.id as string }
}

/**
 * A lead's text from SignalHouse (MESSAGE_RECEIVED). Finds the lead by phone on that number (else the most recent lead
 * with that phone), stores the text in their conversation and alerts its participants. Returns false when no lead
 * matches; the event stays stored for later.
 */
export async function recordInboundLeadText(workspaceId: string, accountId: string, envelope: Record<string, unknown>) {
    const meta = envelope.metaData && typeof envelope.metaData === "object" ? envelope.metaData as Record<string, unknown> : {}
    const message = (meta.Message && typeof meta.Message === "object" ? meta.Message : meta) as Record<string, unknown>
    const from = signalHousePhoneToE164(message.senderPhoneNumber)
    const to = signalHousePhoneToE164(message.phoneNumber ?? message.recipientPhoneNumber)
    const providerId = String(message._id ?? envelope.identifier ?? "").slice(0, 100)
    const body = String(message.messageBody ?? "").slice(0, 8000)
    if (!from || !to || !providerId || !body.trim()) return false
    const { data: number } = await supabaseAdmin.from("campaign_sms_numbers").select("id").eq("account_id", accountId).eq("phone_e164", to).maybeSingle()
    const leads = await supabaseAdmin.from("campaign_leads").select("id, first_name, last_name, company, sms_number_id").eq("workspace_id", workspaceId).eq("phone_e164", from).order("last_submitted_at", { ascending: false }).limit(10)
    fail(leads.error, "find the lead")
    const lead = (number ? leads.data?.find(item => item.sms_number_id === number.id) : undefined) ?? leads.data?.[0]
    if (!lead) return false
    const conversationId = await ensureLeadConversation(workspaceId, lead.id)
    const { data: stored, error } = await supabaseAdmin.from("workspace_native_messages").insert({
        workspace_id: workspaceId, conversation_id: conversationId, body, sms_direction: "inbound", sms_status: "received", sms_provider_message_id: providerId, sms_number_id: number?.id ?? null,
    }).select("id, created_at").single()
    if (error?.code === "23505") return true
    fail(error, "save the text")
    const updates: Record<string, unknown> = {}
    if (!lead.sms_number_id && number) updates.sms_number_id = number.id
    if (STOP_WORDS.has(body.trim().toUpperCase())) Object.assign(updates, { sms_consent: "opted_out", updated_at: new Date().toISOString() })
    if (Object.keys(updates).length) await supabaseAdmin.from("campaign_leads").update(updates).eq("id", lead.id).eq("workspace_id", workspaceId)
    const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ")
    await notifyLeadText({ workspaceId, conversationId, messageId: stored!.id as string, leadName: lead.company ? `${name} – ${lead.company}` : name, previewBody: body })
    return true
}

/** Delivery receipts for texts Betelgeze sent: MESSAGE_DELIVERED, MESSAGE_FAILED, SMS_FAILED. */
export async function applyLeadTextStatus(workspaceId: string, envelope: Record<string, unknown>) {
    const event = String(envelope.event ?? "")
    const ids = (Array.isArray(envelope.identifier) ? envelope.identifier : [envelope.identifier]).map(value => String(value ?? "").slice(0, 100)).filter(Boolean)
    if (!ids.length) return
    const meta = envelope.metaData && typeof envelope.metaData === "object" ? envelope.metaData as Record<string, unknown> : {}
    const delivered = event === "MESSAGE_DELIVERED"
    const reason = typeof meta.successOrFailureReason === "string" ? meta.successOrFailureReason : typeof meta.Message === "string" ? meta.Message : null
    // SignalHouse message ids are unique; the workspace and direction keep the update to this workspace's sent texts.
    await supabaseAdmin.from("workspace_native_messages").update({ sms_status: delivered ? "delivered" : "failed", sms_error: delivered ? null : reason?.slice(0, 300) ?? "Not delivered." })
        .eq("workspace_id", workspaceId).eq("sms_direction", "outbound").in("sms_provider_message_id", ids)
}

/** What the Comms Leads tab shows for each lead conversation: name, source tag, stage, a link and whether they can be texted. */
export async function loadLeadConversationFacts(workspaceId: string, workspaceSlug: string, leadIds: string[]) {
    const facts = new Map<string, { name: string; lead: { id: string; href: string; firstName: string; tag: string | null; tagTone: string | null; stageLabel: string; canText: boolean } }>()
    const ids = [...new Set(leadIds)].slice(0, 1000)
    if (!ids.length) return facts
    const { data: leads, error } = await supabaseAdmin.from("campaign_leads").select("id, first_name, last_name, company, stage, sms_consent, latest_campaign_id, latest_source_id").eq("workspace_id", workspaceId).in("id", ids)
    fail(error, "load the leads")
    const sourceIds = [...new Set((leads ?? []).flatMap(lead => lead.latest_source_id ? [lead.latest_source_id as string] : []))]
    const { data: sources } = sourceIds.length ? await supabaseAdmin.from("campaign_sources").select("id, tag, tag_tone").eq("workspace_id", workspaceId).in("id", sourceIds) : { data: [] }
    const sourceById = new Map((sources ?? []).map(source => [source.id as string, source]))
    for (const lead of leads ?? []) {
        const source = lead.latest_source_id ? sourceById.get(lead.latest_source_id as string) : undefined
        const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ")
        facts.set(lead.id as string, {
            name: lead.company ? `${name} – ${lead.company}` : name,
            lead: {
                id: lead.id as string, firstName: lead.first_name as string,
                href: `/${workspaceSlug}/campaigns/${lead.latest_campaign_id}/leads/${lead.id}`,
                tag: (source?.tag as string | undefined) ?? null, tagTone: (source?.tag_tone as string | undefined) ?? null,
                stageLabel: isCampaignStage(lead.stage) ? campaignStageLabels[lead.stage] : String(lead.stage),
                canText: lead.sms_consent === "opted_in",
            },
        })
    }
    return facts
}
