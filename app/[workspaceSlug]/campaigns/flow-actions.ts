"use server"

import { revalidatePath } from "next/cache"
import { requireCampaigns } from "@/lib/campaigns/server"
import { createFlows, deleteFlow, duplicateFlow, removeFromFlow, sendFlowTest, storeFlowImage, updateFlow } from "@/lib/campaigns/flows-server"
import type { FlowSettings } from "@/lib/campaigns/flows"

/** Text flows commands (docs/text-flows.md). Owners and admins with Campaigns; every write names its workspace. */

const UUID = /^[0-9a-f-]{36}$/i
const refresh = (slug: string, campaignId: string) => revalidatePath(`/${slug}/campaigns/${campaignId}`, "layout")

export async function createFlowAction(workspaceSlug: string, campaignId: string, kind: "blank" | "starters") {
    if (!UUID.test(campaignId)) return { ok: false as const, error: "Campaign not found." }
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    try {
        const ids = await createFlows(workspace.id, campaignId, user.id, kind)
        refresh(workspace.slug, campaignId)
        return { ok: true as const, id: ids[0] ?? null }
    } catch { return { ok: false as const, error: "Could not create the flow. Please retry." } }
}

/** Saves one edit: only the fields named in `patch`. */
export async function saveFlowAction(workspaceSlug: string, campaignId: string, flowId: string, patch: Partial<FlowSettings>) {
    if (!UUID.test(campaignId) || !UUID.test(flowId) || !patch || typeof patch !== "object") return { ok: false as const, error: "Flow not found." }
    const { workspace } = await requireCampaigns(workspaceSlug)
    const allowed: (keyof FlowSettings)[] = ["name", "enabled", "trigger", "triggerStage", "sourceIds", "stopOnReply", "stopOnBook", "stopOnPay", "windowStart", "windowEnd", "windowDays", "steps", "replies"]
    const clean = Object.fromEntries(Object.entries(patch).filter(([key]) => (allowed as string[]).includes(key))) as Partial<FlowSettings>
    const result = await updateFlow(workspace.id, campaignId, flowId, clean).catch(() => ({ ok: false as const, error: "Could not save. Please retry." }))
    if (result.ok && (clean.enabled !== undefined || clean.name !== undefined || clean.trigger !== undefined)) refresh(workspace.slug, campaignId)
    return result
}

export async function duplicateFlowAction(workspaceSlug: string, campaignId: string, flowId: string) {
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const id = UUID.test(flowId) ? await duplicateFlow(workspace.id, campaignId, flowId, user.id).catch(() => null) : null
    if (!id) return { ok: false as const, error: "Could not copy the flow. Please retry." }
    refresh(workspace.slug, campaignId)
    return { ok: true as const, id }
}

export async function deleteFlowAction(workspaceSlug: string, campaignId: string, flowId: string) {
    const { workspace } = await requireCampaigns(workspaceSlug)
    if (!UUID.test(flowId)) return { ok: false as const, error: "Flow not found." }
    try { await deleteFlow(workspace.id, campaignId, flowId) } catch { return { ok: false as const, error: "Could not delete the flow. Please retry." } }
    refresh(workspace.slug, campaignId)
    return { ok: true as const }
}

export async function removeFromFlowAction(workspaceSlug: string, campaignId: string, runId: string) {
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const removed = UUID.test(runId) ? await removeFromFlow(workspace.id, runId, user.id).catch(() => false) : false
    if (removed) refresh(workspace.slug, campaignId)
    return removed ? { ok: true as const } : { ok: false as const, error: "They are no longer in this flow." }
}

export async function sendFlowTestAction(workspaceSlug: string, campaignId: string, flowId: string, phone: string, previewLeadId: string | null) {
    const { workspace } = await requireCampaigns(workspaceSlug)
    const digits = String(phone ?? "").replace(/\D/g, "")
    const e164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : ""
    return sendFlowTest(workspace.id, campaignId, flowId, e164, previewLeadId && UUID.test(previewLeadId) ? previewLeadId : null)
        .catch(() => ({ ok: false as const, error: "Could not send the test texts. Please retry." }))
}

export async function uploadFlowImageAction(workspaceSlug: string, campaignId: string, flowId: string, form: FormData) {
    const { workspace } = await requireCampaigns(workspaceSlug)
    if (!UUID.test(flowId) || !UUID.test(campaignId)) return { ok: false as const, error: "Flow not found." }
    const file = form.get("file")
    if (!(file instanceof File)) return { ok: false as const, error: "Pick a picture." }
    const stored = await storeFlowImage(workspace.id, flowId, { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, type: file.type }).catch(() => ({ error: "Could not upload the picture. Please retry." }))
    if ("error" in stored) return { ok: false as const, error: stored.error }
    return { ok: true as const, image: stored }
}
