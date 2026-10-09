"use server"

import { revalidatePath } from "next/cache"
import { connectClientHighLevel, refreshClientHighLevel, saveClientConnection, removeClientConnection, listClientConnections, type ClientConnectionEdit } from "@/lib/client-connections"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export type ClientConnectionActionResult = { ok: true; accounts?: import("@/lib/client-connections").ClientConnectionAccount[] } | { ok: false; error: string }

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
        return { ok: true, accounts: await listClientConnections(workspace.id, user.id) }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "The client connection could not be refreshed." }
    }
}

export async function saveClientAccount(workspaceSlug: string, input: ClientConnectionEdit) {
    try {
        const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "client-connections")
        await saveClientConnection(workspace.id, user.id, input)
        return { ok: true as const, accounts: await listClientConnections(workspace.id, user.id) }
    } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "The connection could not be saved." } }
}
export async function removeClientAccount(workspaceSlug: string, relationshipId: string, revision: string) {
    try {
        const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "client-connections")
        await removeClientConnection(workspace.id, user.id, relationshipId, revision)
        return { ok: true as const, accounts: await listClientConnections(workspace.id, user.id) }
    } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "The connection could not be removed." } }
}
