"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { requireCampaigns } from "@/lib/campaigns/server"
import { addSmsNumbers, connectSignalHouse, countTextingLeads, disconnectSignalHouse, labelSmsNumber, removeSmsNumber, sendTestText, setTextingNumber, syncSignalHouseAccount } from "@/lib/signalhouse/server"
import { supabaseAdmin } from "@/lib/supabase/admin"

type Result = { ok: true; [key: string]: unknown } | { ok: false; error: string }

async function guarded(slug: string, run: (workspaceId: string, userId: string) => Promise<Result>) {
    const { workspace, user } = await requireCampaigns(slug)
    try {
        const result = await run(workspace.id, user.id)
        if (result.ok) {
            revalidatePath(`/${workspace.slug}/settings/signalhouse`, "layout")
            revalidatePath(`/${workspace.slug}/campaigns`, "layout")
        }
        return result
    } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "Could not save. Please retry." }
    }
}

async function appOrigin() {
    const requestHeaders = await headers()
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "app.betelgeze.com"
    return `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`
}

export async function connectSignalHouseAction(slug: string, apiKey: string, groupId: string) {
    const origin = await appOrigin()
    return guarded(slug, (workspaceId, userId) => connectSignalHouse({ workspaceId, userId, apiKey, groupId, origin }))
}

export async function syncSignalHouseAction(slug: string, accountId: string) {
    return guarded(slug, workspaceId => syncSignalHouseAccount(workspaceId, accountId))
}

export async function disconnectSignalHouseAction(slug: string, accountId: string) {
    return guarded(slug, workspaceId => disconnectSignalHouse(workspaceId, accountId))
}

export async function addSmsNumbersAction(slug: string, numberIds: string[]) {
    return guarded(slug, workspaceId => addSmsNumbers(workspaceId, numberIds))
}

export async function removeSmsNumberAction(slug: string, numberId: string) {
    return guarded(slug, workspaceId => removeSmsNumber(workspaceId, numberId))
}

export async function labelSmsNumberAction(slug: string, numberId: string, label: string) {
    return guarded(slug, workspaceId => labelSmsNumber(workspaceId, numberId, label))
}

export async function sendTestTextAction(slug: string, numberId: string, to: string) {
    return guarded(slug, workspaceId => sendTestText(workspaceId, numberId, to))
}

/** How many leads already text with the current number of a campaign or source, before changing it. */
export async function textingLeadsAction(slug: string, kind: "campaign" | "source", id: string) {
    return guarded(slug, async workspaceId => {
        const table = kind === "campaign" ? "campaigns" : "campaign_sources"
        const { data } = await supabaseAdmin.from(table).select(kind === "campaign" ? "sms_number_id" : "sms_number_id, campaign_id").eq("id", id).eq("workspace_id", workspaceId).maybeSingle()
        const row = data as { sms_number_id: string | null; campaign_id?: string } | null
        let current = row?.sms_number_id ?? null
        if (!current && kind === "source" && row?.campaign_id) current = (await supabaseAdmin.from("campaigns").select("sms_number_id").eq("id", row.campaign_id).eq("workspace_id", workspaceId).maybeSingle()).data?.sms_number_id ?? null
        return { ok: true as const, count: await countTextingLeads(workspaceId, { kind, id }, current) }
    })
}

export async function setTextingNumberAction(slug: string, kind: "campaign" | "source", id: string, numberId: string | null, moveConversations: boolean) {
    return guarded(slug, workspaceId => setTextingNumber({ workspaceId, target: { kind, id }, numberId, moveConversations }))
}
