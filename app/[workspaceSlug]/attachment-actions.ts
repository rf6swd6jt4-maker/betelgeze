"use server"

import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import type { AttachmentOwner } from "@/lib/record-attachments"

export async function attachExistingRecord(slug: string, owner: AttachmentOwner, ownerId: string, kind: "asset" | "note", targetId: string, expectedUserId?: string) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (expectedUserId !== user.id) return { ok: false as const, error: "Your session changed. Reload before attaching this record." }
    if (!uuid.test(ownerId) || !uuid.test(targetId) || !["relationship", "work-item", "note"].includes(owner) || !["asset", "note"].includes(kind)) return { ok: false as const, error: "Choose a valid attachment." }
    if (owner === "note" && kind === "note" && ownerId === targetId) return { ok: false as const, error: "A note cannot be attached to itself." }
    const { error } = await supabaseAdmin.rpc("attach_existing_record", { p_workspace: workspace.id, p_actor: user.id, p_owner: owner, p_owner_id: ownerId, p_kind: kind, p_target: targetId })
    if (error) return { ok: false as const, error: error.code === "P0001" ? error.message : "This attachment could not be confirmed. Retry; an existing link will not be duplicated." }
    return { ok: true as const }
}
