"use server"

import { revalidatePath } from "next/cache"
import { assetHref, workspaceHref } from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireAssetAccess, requireWorkspaceAccess, workspaceAccessHasCapability } from "@/lib/workspace-access"

type AssetFieldsInput = {
    title: string
    description: string
    expectedUpdatedAt: string
    expectedUserId: string
}

export type AssetFieldsResult =
    | { ok: true; version: string; values: { title: string; description: string } }
    | { ok: false; error: string; conflict?: boolean; version?: string; values?: { title: string; description: string } }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function updateAssetFields(slug: string, assetId: string, input: AssetFieldsInput): Promise<AssetFieldsResult> {
    const { workspace, user, access } = await requireWorkspaceAccess(slug)
    if (!workspaceAccessHasCapability(access, "fulfilment.manage") && !workspaceAccessHasCapability(access, "onboarding.manage")) {
        return { ok: false, error: "You do not have permission to update this asset." }
    }
    if (!uuidPattern.test(assetId) || input.expectedUserId !== user.id) {
        return { ok: false, conflict: true, error: "Your session changed. Refresh before retrying this asset draft." }
    }
    await requireAssetAccess(access, assetId)

    const title = typeof input.title === "string" ? input.title.trim() : ""
    const description = typeof input.description === "string" ? input.description.trim() : ""
    if (!title || title.length > 500) return { ok: false, error: "Add an asset name of 500 characters or fewer." }
    if (description.length > 20_000) return { ok: false, error: "Keep the asset description to 20,000 characters or fewer." }
    if (!input.expectedUpdatedAt || input.expectedUpdatedAt.length > 50 || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) {
        return { ok: false, conflict: true, error: "Refresh before retrying this asset draft." }
    }

    const nextVersion = new Date().toISOString()
    const { data: saved, error } = await supabaseAdmin
        .from("assets")
        .update({ title, description: description || null, updated_at: nextVersion })
        .eq("workspace_id", workspace.id)
        .eq("id", assetId)
        .eq("updated_at", input.expectedUpdatedAt)
        .select("title,description,updated_at")
        .maybeSingle()
    if (error) return { ok: false, error: "The asset fields could not be saved." }
    if (!saved) {
        const { data: latest } = await supabaseAdmin.from("assets").select("title,description,updated_at").eq("workspace_id", workspace.id).eq("id", assetId).maybeSingle()
        return { ok: false, conflict: true, version: latest?.updated_at, values: latest ? { title: latest.title, description: latest.description ?? "" } : undefined, error: "This asset changed elsewhere. Review the latest saved fields before retrying." }
    }

    revalidatePath(assetHref(slug, assetId))
    revalidatePath(workspaceHref(slug, "assets"))
    return { ok: true, version: saved.updated_at, values: { title: saved.title, description: saved.description ?? "" } }
}
