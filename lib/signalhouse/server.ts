import "server-only"
import { randomUUID } from "node:crypto"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { decryptWorkspaceIntegration, encryptIntegrationCredential } from "@/lib/workspace-integrations"
import { signalHouseList, signalHouseObject, signalHouseRequest, SignalHouseError } from "@/lib/signalhouse/api"
import { SIGNALHOUSE_GROUP_ID, SIGNALHOUSE_WEBHOOK_EVENTS, e164ToSignalHouse, signalHouseKeyExpiry, signalHousePhoneToE164, smsNumberCanSend } from "@/lib/signalhouse/model"

export type SignalHouseAccountRow = {
    id: string; workspace_id: string; group_id: string; name: string; key_hint: string; key_expires_at: string | null; webhook_id: string | null
    status: "connected" | "needs_attention" | "disconnected"; last_synced_at: string | null; last_webhook_at: string | null; last_error: string | null; created_at: string
}
export type SignalHouseRegistrationRow = { id: string; account_id: string; external_id: string; usecase: string; description: string; status: string; synced_at: string }
export type SmsNumberRow = {
    id: string; account_id: string; phone_e164: string; label: string; registration_external_id: string | null; status: string; capabilities: string[]
    health: Record<string, unknown>; added_at: string | null; removed_at: string | null; synced_at: string
}

const ACCOUNT_FIELDS = "id, workspace_id, group_id, name, key_hint, key_expires_at, webhook_id, status, last_synced_at, last_webhook_at, last_error, created_at"
const NUMBER_FIELDS = "id, account_id, phone_e164, label, registration_external_id, status, capabilities, health, added_at, removed_at, synced_at"
const MAX_PAGES = 10
const PAGE_SIZE = 100

function fail(error: { message: string } | null, what: string) {
    if (error) throw new Error(`Could not ${what}. Please retry.`)
}

export function signalHouseWebhookUrl(origin: string, accountId: string) {
    return `${origin}/api/signalhouse/webhook/${accountId}`
}

/** Everything the SignalHouse settings page shows, for connected accounts only. */
export async function loadSignalHouse(workspaceId: string) {
    const { data: accounts, error } = await supabaseAdmin.from("signalhouse_accounts").select(ACCOUNT_FIELDS).eq("workspace_id", workspaceId).neq("status", "disconnected").order("created_at")
    fail(error, "load SignalHouse")
    const ids = (accounts ?? []).map(account => account.id)
    if (!ids.length) return { accounts: [] as SignalHouseAccountRow[], registrations: [] as SignalHouseRegistrationRow[], numbers: [] as SmsNumberRow[] }
    const [registrations, numbers] = await Promise.all([
        supabaseAdmin.from("signalhouse_registrations").select("id, account_id, external_id, usecase, description, status, synced_at").in("account_id", ids).order("external_id"),
        supabaseAdmin.from("campaign_sms_numbers").select(NUMBER_FIELDS).in("account_id", ids).order("phone_e164").limit(1000),
    ])
    fail(registrations.error, "load registrations"); fail(numbers.error, "load numbers")
    return { accounts: (accounts ?? []) as SignalHouseAccountRow[], registrations: (registrations.data ?? []) as SignalHouseRegistrationRow[], numbers: (numbers.data ?? []) as SmsNumberRow[] }
}

/** Numbers the workspace has added, on connected accounts, with whether each can send now. */
export async function loadUsableSmsNumbers(workspaceId: string) {
    const loaded = await loadSignalHouse(workspaceId)
    const statusOf = new Map(loaded.registrations.map(registration => [`${registration.account_id}:${registration.external_id}`, registration.status]))
    return loaded.numbers.filter(number => number.added_at && !number.removed_at).map(number => ({
        ...number, canSend: smsNumberCanSend(number, statusOf.get(`${number.account_id}:${number.registration_external_id}`)),
    }))
}

/** Which campaigns and sources use each number, and how many leads are texting with it. */
export async function loadSmsNumberUse(workspaceId: string) {
    const [campaigns, sources, leads] = await Promise.all([
        supabaseAdmin.from("campaigns").select("id, name, sms_number_id").eq("workspace_id", workspaceId).neq("status", "archived").not("sms_number_id", "is", null).limit(200),
        supabaseAdmin.from("campaign_sources").select("id, campaign_id, name, tag, tag_tone, sms_number_id").eq("workspace_id", workspaceId).not("sms_number_id", "is", null).limit(500),
        supabaseAdmin.from("campaign_leads").select("sms_number_id").eq("workspace_id", workspaceId).not("sms_number_id", "is", null).limit(5000),
    ])
    fail(campaigns.error, "load campaigns"); fail(sources.error, "load sources"); fail(leads.error, "load leads")
    const conversations = new Map<string, number>()
    for (const lead of leads.data ?? []) conversations.set(lead.sms_number_id as string, (conversations.get(lead.sms_number_id as string) ?? 0) + 1)
    return { campaigns: campaigns.data ?? [], sources: sources.data ?? [], conversations }
}

async function accountKey(accountId: string, workspaceId: string) {
    const { data, error } = await supabaseAdmin.from("signalhouse_accounts").select("id, group_id, config_encrypted, webhook_id, status").eq("id", accountId).eq("workspace_id", workspaceId).maybeSingle()
    fail(error, "load the SignalHouse account")
    if (!data || data.status === "disconnected") throw new Error("This SignalHouse account is not connected.")
    const config = decryptWorkspaceIntegration(data.config_encrypted)
    if (!config.api_key) throw new Error("This SignalHouse account has no API key. Connect it again.")
    return { account: data, apiKey: config.api_key, config }
}

/**
 * Connects a SignalHouse group: checks the key against the group, creates (or re-keys) one signed Global webhook
 * pointing at this account's Betelgeze address, stores the key and signing secret encrypted, then reads its
 * registrations and numbers. Connecting the same group again replaces the key.
 */
export async function connectSignalHouse(input: { workspaceId: string; userId: string; apiKey: string; groupId: string; origin: string }) {
    const apiKey = input.apiKey.trim()
    const groupId = input.groupId.trim()
    if (!SIGNALHOUSE_GROUP_ID.test(groupId)) return { ok: false as const, error: "The Group ID starts with G and has 8 characters." }
    if (apiKey.length < 20 || apiKey.length > 4000 || /\s/.test(apiKey)) return { ok: false as const, error: "Paste the whole API key." }
    let groupName = ""
    try {
        const response = await signalHouseRequest(apiKey, `/group?id=${encodeURIComponent(groupId)}`)
        const group = signalHouseList(response)[0] ?? signalHouseObject(response)
        if (!group.groupId && !group.groupName && !group._id) return { ok: false as const, error: "SignalHouse found no group with that ID for this key." }
        groupName = String(group.groupName ?? group.groupCompanyName ?? "").slice(0, 200)
    } catch (error) {
        return { ok: false as const, error: error instanceof SignalHouseError ? error.message : "SignalHouse could not be reached. Please retry." }
    }

    const { data: existing } = await supabaseAdmin.from("signalhouse_accounts").select("id, webhook_id").eq("workspace_id", input.workspaceId).eq("group_id", groupId).neq("status", "disconnected").maybeSingle()
    const now = new Date().toISOString()
    const base = { name: groupName, key_hint: apiKey.slice(-4), key_expires_at: signalHouseKeyExpiry(apiKey), status: "connected", last_error: null, updated_at: now }
    let accountId = existing?.id as string | undefined
    if (accountId) {
        const { error } = await supabaseAdmin.from("signalhouse_accounts").update({ ...base, config_encrypted: encryptIntegrationCredential({ api_key: apiKey }) }).eq("id", accountId)
        fail(error, "save the SignalHouse account")
    } else {
        const { data, error } = await supabaseAdmin.from("signalhouse_accounts").insert({ ...base, workspace_id: input.workspaceId, group_id: groupId, config_encrypted: encryptIntegrationCredential({ api_key: apiKey }), created_by: input.userId }).select("id").single()
        fail(error, "save the SignalHouse account")
        accountId = data!.id as string
    }

    // The signing secret is returned only when a webhook is created or its secret rotated, so take it then.
    const url = signalHouseWebhookUrl(input.origin, accountId)
    try {
        const hooks = signalHouseList(await signalHouseRequest(apiKey, `/webhook?groupId=${encodeURIComponent(groupId)}&endpointType=Global&limit=100`))
        const mine = hooks.find(hook => hook.url === url)
        const settings = { name: "Betelgeze campaigns", url, subscribedEvents: [...SIGNALHOUSE_WEBHOOK_EVENTS], authType: "HMAC" }
        let webhookId: string
        let secret: string
        if (mine) {
            webhookId = String(mine._id ?? mine.id)
            await signalHouseRequest(apiKey, `/webhook/${encodeURIComponent(webhookId)}`, { method: "PUT", body: { name: settings.name, url, subscribedEvents: settings.subscribedEvents } })
            const rotated = signalHouseObject(await signalHouseRequest(apiKey, `/webhook/${encodeURIComponent(webhookId)}/rotate-secret`, { method: "POST", body: { graceSeconds: 0 }, idempotencyKey: randomUUID() }))
            secret = String(rotated.signingSecret ?? "")
        } else {
            const created = signalHouseObject(await signalHouseRequest(apiKey, "/webhook", { method: "POST", body: { groupId, endpointType: "Global", ...settings }, idempotencyKey: `betelgeze-webhook-${accountId}` }))
            webhookId = String(created._id ?? created.id ?? "")
            secret = String(created.signingSecret ?? "")
        }
        if (!webhookId || !/^[0-9a-f]{32,128}$/i.test(secret)) throw new SignalHouseError("SignalHouse did not return a signing secret for the webhook.", 502)
        const { error } = await supabaseAdmin.from("signalhouse_accounts").update({ config_encrypted: encryptIntegrationCredential({ api_key: apiKey, webhook_secret: secret }), webhook_id: webhookId, updated_at: new Date().toISOString() }).eq("id", accountId)
        fail(error, "save the webhook")
    } catch (error) {
        const message = error instanceof Error ? error.message : "The webhook could not be set up."
        await supabaseAdmin.from("signalhouse_accounts").update({ status: "needs_attention", last_error: `Replies and receipts are not set up: ${message}`.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", accountId)
        return { ok: false as const, error: `Connected, but replies and receipts could not be set up. ${message}` }
    }

    const synced = await syncSignalHouseAccount(input.workspaceId, accountId)
    return synced.ok ? { ok: true as const, accountId } : { ok: false as const, error: synced.error }
}

/** Reads the account's 10DLC registrations and numbers (bounded pages) and stores what SignalHouse reports. */
export async function syncSignalHouseAccount(workspaceId: string, accountId: string) {
    try {
        const { account, apiKey } = await accountKey(accountId, workspaceId)
        const group = encodeURIComponent(account.group_id)
        const readAll = async (path: string) => {
            const out: Record<string, unknown>[] = []
            for (let page = 1; page <= MAX_PAGES; page++) {
                const items = signalHouseList(await signalHouseRequest(apiKey, `${path}&page=${page}&limit=${PAGE_SIZE}`))
                out.push(...items)
                if (items.length < PAGE_SIZE) break
            }
            return out
        }
        const [campaigns, numbers] = await Promise.all([readAll(`/campaign?groupId=${group}&registrationType=TEN_DLC`), readAll(`/number?groupId=${group}`)])
        const now = new Date().toISOString()
        const registrations = campaigns.map(item => ({
            workspace_id: workspaceId, account_id: accountId, external_id: String(item.campaignId ?? item._id ?? "").slice(0, 100),
            usecase: String(item.usecase ?? "").slice(0, 100), description: String(item.description ?? "").slice(0, 2000), status: String(item.status ?? "").slice(0, 40), synced_at: now,
        })).filter(item => item.external_id)
        if (registrations.length) {
            const { error } = await supabaseAdmin.from("signalhouse_registrations").upsert(registrations, { onConflict: "account_id,external_id" })
            fail(error, "save registrations")
        }
        const rows = numbers.flatMap(item => {
            const phone = signalHousePhoneToE164(item.phoneNumber)
            if (!phone) return []
            const health = item.health && typeof item.health === "object" ? item.health as Record<string, unknown> : {}
            return [{
                workspace_id: workspaceId, account_id: accountId, phone_e164: phone,
                registration_external_id: item.campaignId ? String(item.campaignId).slice(0, 100) : null, status: String(item.status ?? "").slice(0, 40),
                capabilities: Array.isArray(item.capabilities) ? item.capabilities.map(String).slice(0, 10) : [],
                health: JSON.stringify(health).length <= 8000 ? health : {}, synced_at: now, updated_at: now,
            }]
        })
        if (rows.length) {
            const { error } = await supabaseAdmin.from("campaign_sms_numbers").upsert(rows, { onConflict: "account_id,phone_e164" })
            fail(error, "save numbers")
        }
        // A number SignalHouse no longer lists has been released: it can no longer send.
        const listed = new Set(rows.map(row => row.phone_e164))
        const { data: stored } = await supabaseAdmin.from("campaign_sms_numbers").select("id, phone_e164").eq("account_id", accountId).neq("status", "RELEASED")
        const gone = (stored ?? []).filter(row => !listed.has(row.phone_e164)).map(row => row.id)
        if (gone.length) await supabaseAdmin.from("campaign_sms_numbers").update({ status: "RELEASED", updated_at: now }).in("id", gone)
        await supabaseAdmin.from("signalhouse_accounts").update({ last_synced_at: now, updated_at: now, ...(account.status === "needs_attention" && account.webhook_id ? { status: "connected", last_error: null } : {}) }).eq("id", accountId)
        return { ok: true as const, registrations: registrations.length, numbers: rows.length }
    } catch (error) {
        const message = error instanceof Error ? error.message : "SignalHouse could not be read."
        await supabaseAdmin.from("signalhouse_accounts").update({ last_error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", accountId).eq("workspace_id", workspaceId)
        return { ok: false as const, error: message }
    }
}

/** Stops using an account: removes Betelgeze's webhook from SignalHouse (best effort) and forgets the key. */
export async function disconnectSignalHouse(workspaceId: string, accountId: string) {
    try {
        const { account, apiKey } = await accountKey(accountId, workspaceId)
        if (account.webhook_id) await signalHouseRequest(apiKey, `/webhook/${encodeURIComponent(account.webhook_id)}`, { method: "DELETE" }).catch(() => null)
    } catch { /* already unusable; disconnect anyway */ }
    const { error } = await supabaseAdmin.from("signalhouse_accounts").update({ status: "disconnected", config_encrypted: encryptIntegrationCredential({ disconnected: "true" }), webhook_id: null, updated_at: new Date().toISOString() }).eq("id", accountId).eq("workspace_id", workspaceId)
    fail(error, "disconnect SignalHouse")
    return { ok: true as const }
}

export async function addSmsNumbers(workspaceId: string, numberIds: string[]) {
    const ids = numberIds.filter(id => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 50)
    if (!ids.length) return { ok: false as const, error: "Pick a number to add." }
    const now = new Date().toISOString()
    const { data, error } = await supabaseAdmin.from("campaign_sms_numbers").update({ added_at: now, removed_at: null, updated_at: now }).eq("workspace_id", workspaceId).in("id", ids).select("id")
    fail(error, "add the numbers")
    return { ok: true as const, added: data?.length ?? 0 }
}

/** Removes a number from Betelgeze (it stays in SignalHouse). Refused while a campaign, source or lead still uses it. */
export async function removeSmsNumber(workspaceId: string, numberId: string) {
    const use = await loadSmsNumberUse(workspaceId)
    if (use.campaigns.some(item => item.sms_number_id === numberId) || use.sources.some(item => item.sms_number_id === numberId)) return { ok: false as const, error: "Pick another number where this one is used first." }
    if (use.conversations.get(numberId)) return { ok: false as const, error: "Leads are texting with this number, so it stays." }
    const now = new Date().toISOString()
    const { error } = await supabaseAdmin.from("campaign_sms_numbers").update({ removed_at: now, updated_at: now }).eq("id", numberId).eq("workspace_id", workspaceId)
    fail(error, "remove the number")
    return { ok: true as const }
}

export async function labelSmsNumber(workspaceId: string, numberId: string, label: string) {
    const clean = label.replace(/\s+/g, " ").trim().slice(0, 60)
    const { error } = await supabaseAdmin.from("campaign_sms_numbers").update({ label: clean, updated_at: new Date().toISOString() }).eq("id", numberId).eq("workspace_id", workspaceId)
    fail(error, "save the label")
    return { ok: true as const }
}

/**
 * Sets the number a campaign (or one of its sources) texts from. Only an added number that can send is accepted.
 * New leads use it; leads already texting keep their number unless `moveConversations` is set.
 */
export async function setTextingNumber(input: { workspaceId: string; target: { kind: "campaign" | "source"; id: string }; numberId: string | null; moveConversations: boolean }) {
    if (input.numberId) {
        const usable = await loadUsableSmsNumbers(input.workspaceId)
        const number = usable.find(item => item.id === input.numberId)
        if (!number) return { ok: false as const, error: "That number is not available here." }
        if (!number.canSend) return { ok: false as const, error: "That number cannot send yet: its 10DLC registration is not active." }
    } else if (input.target.kind === "campaign") {
        return { ok: false as const, error: "Pick a number for the campaign." }
    }
    const table = input.target.kind === "campaign" ? "campaigns" : "campaign_sources"
    const { data: row, error: readError } = await supabaseAdmin.from(table).select(input.target.kind === "campaign" ? "id, sms_number_id" : "id, campaign_id, sms_number_id").eq("id", input.target.id).eq("workspace_id", input.workspaceId).maybeSingle()
    fail(readError, "load it")
    if (!row) return { ok: false as const, error: "Not found." }
    const { error } = await supabaseAdmin.from(table).update({ sms_number_id: input.numberId, updated_at: new Date().toISOString() }).eq("id", input.target.id).eq("workspace_id", input.workspaceId)
    fail(error, "save the number")
    if (input.moveConversations) {
        // Leads keep the number that first texted them; moving them is an explicit choice.
        const resolved = input.numberId ?? (await supabaseAdmin.from("campaigns").select("sms_number_id").eq("id", (row as { campaign_id?: string }).campaign_id ?? "").maybeSingle()).data?.sms_number_id ?? null
        let query = supabaseAdmin.from("campaign_leads").update({ sms_number_id: resolved }).eq("workspace_id", input.workspaceId).not("sms_number_id", "is", null)
        if (input.target.kind === "source") query = query.eq("latest_source_id", input.target.id)
        else {
            const { data: own } = await supabaseAdmin.from("campaign_sources").select("id").eq("campaign_id", input.target.id).not("sms_number_id", "is", null)
            query = query.eq("latest_campaign_id", input.target.id)
            for (const source of own ?? []) query = query.neq("latest_source_id", source.id)
        }
        const { error: moveError } = await query
        fail(moveError, "move the conversations")
    }
    return { ok: true as const }
}

/** Counts leads already texting from the current number of a campaign or source (they would keep it). */
export async function countTextingLeads(workspaceId: string, target: { kind: "campaign" | "source"; id: string }, currentNumberId: string | null) {
    if (!currentNumberId) return 0
    let query = supabaseAdmin.from("campaign_leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("sms_number_id", currentNumberId)
    query = target.kind === "source" ? query.eq("latest_source_id", target.id) : query.eq("latest_campaign_id", target.id)
    const { count, error } = await query
    fail(error, "count conversations")
    return count ?? 0
}

/** Sends one test text from a number to a staff member's phone. */
export async function sendTestText(workspaceId: string, numberId: string, to: string) {
    const recipient = signalHousePhoneToE164(to)
    if (!recipient) return { ok: false as const, error: "Enter a US mobile number." }
    const usable = await loadUsableSmsNumbers(workspaceId)
    const number = usable.find(item => item.id === numberId)
    if (!number) return { ok: false as const, error: "That number is not available here." }
    if (!number.canSend) return { ok: false as const, error: "This number cannot send yet: its 10DLC registration is not active." }
    try {
        const { apiKey } = await accountKey(number.account_id, workspaceId)
        const result = signalHouseObject(await signalHouseRequest(apiKey, "/message/sms", {
            method: "POST", idempotencyKey: randomUUID(),
            body: { senderPhoneNumber: e164ToSignalHouse(number.phone_e164), recipientPhoneNumber: [e164ToSignalHouse(recipient)], messageBody: "Test text from Betelgeze. Reply STOP to opt out." },
        }))
        if (Number(result.enqueuedCount ?? 1) === 0) return { ok: false as const, error: "SignalHouse did not accept it (the number may have opted out)." }
        return { ok: true as const }
    } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "The test text could not be sent." }
    }
}

/** One number's name, for showing which number a lead texts with. Null when unset or not in this workspace. */
export async function loadSmsNumber(workspaceId: string, numberId: string | null | undefined) {
    if (!numberId) return null
    const { data } = await supabaseAdmin.from("campaign_sms_numbers").select("id, phone_e164, label").eq("id", numberId).eq("workspace_id", workspaceId).maybeSingle()
    return data as { id: string; phone_e164: string; label: string } | null
}
