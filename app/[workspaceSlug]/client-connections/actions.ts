"use server"

import { revalidatePath } from "next/cache"
import { connectClientHighLevel, refreshClientHighLevel } from "@/lib/client-connections"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export type ClientConnectionActionResult = { ok: true } | { ok: false; error: string }

export async function connectClientAccount(workspaceSlug: string, input: { relationshipId: string; accountType: "client_account" | "agency_subaccount"; locationId: string; privateToken: string }): Promise<ClientConnectionActionResult> {
    try {
        const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "client-connections")
        await connectClientHighLevel({
            relationshipId: input.relationshipId,
            accountType: input.accountType,
            locationId: input.locationId,
            privateToken: input.privateToken,
            workspaceId: workspace.id,
            userId: user.id,
        })
        revalidatePath(`/${workspaceSlug}/client-connections`)
        return { ok: true }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "The client connection could not be saved." }
    }
}

export async function refreshClientAccount(workspaceSlug: string, relationshipId: string): Promise<ClientConnectionActionResult> {
    try {
        const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "client-connections")
        await refreshClientHighLevel({ workspaceId: workspace.id, userId: user.id, relationshipId })
        revalidatePath(`/${workspaceSlug}/client-connections`)
        return { ok: true }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "The client connection could not be refreshed." }
    }
}
