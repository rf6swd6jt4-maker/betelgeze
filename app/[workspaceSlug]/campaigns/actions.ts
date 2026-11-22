"use server"

import { revalidatePath } from "next/cache"
import { ADMIN_ACTIONS, requireCampaigns, runCampaignAdmin, type CampaignAdminAction } from "@/lib/campaigns/server"

/** One owner/admin command for the Campaigns screens; the database function checks access again. */
export async function campaignCommand(workspaceSlug: string, action: CampaignAdminAction, input: Record<string, unknown>) {
    if (!(ADMIN_ACTIONS as readonly string[]).includes(action)) return { ok: false as const, error: "Unknown action." }
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const result = await runCampaignAdmin(workspace.id, user.id, action, input)
    if (result.ok) revalidatePath(`/${workspace.slug}/campaigns`, "layout")
    return result
}
