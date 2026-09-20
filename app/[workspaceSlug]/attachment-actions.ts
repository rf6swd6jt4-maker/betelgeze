"use server"

import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import type { AttachmentOwner } from "@/lib/record-attachments"

export async function attachExistingRecord(slug: string, owner: AttachmentOwner, ownerId: string, kind: "asset" | "note", targetId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuid.test(ownerId) || !uuid.test(targetId) || !["relationship", "work-item", "note"].includes(owner) || !["asset", "note"].includes(kind)) return { ok: false as const, error: "Choose a valid attachment." }
    if (owner === "note" && kind === "note" && ownerId === targetId) return { ok: false as const, error: "A note cannot be attached to itself." }
    const ownerTable = owner === "relationship" ? "relationships" : owner === "work-item" ? "work_items" : "notes"
    const targetTable = kind === "asset" ? "assets" : "notes"
    const [existingOwner, existingTarget] = await Promise.all([
        supabaseAdmin.from(ownerTable).select("id").eq("workspace_id", workspace.id).eq("id", ownerId).maybeSingle(),
        supabaseAdmin.from(targetTable).select("id").eq("workspace_id", workspace.id).eq("id", targetId).maybeSingle(),
    ])
    if (existingOwner.error || existingTarget.error || !existingOwner.data || !existingTarget.data) return { ok: false as const, error: "One of these records is no longer available." }
    const error = owner === "relationship"
        ? kind === "asset"
            ? (await supabaseAdmin.from("asset_relationships").insert({ workspace_id: workspace.id, relationship_id: ownerId, asset_id: targetId })).error
            : (await supabaseAdmin.from("note_relationships").insert({ workspace_id: workspace.id, relationship_id: ownerId, note_id: targetId })).error
        : owner === "work-item"
            ? kind === "asset"
                ? (await supabaseAdmin.from("asset_work_items").insert({ workspace_id: workspace.id, work_item_id: ownerId, asset_id: targetId })).error
                : (await supabaseAdmin.from("note_work_items").insert({ workspace_id: workspace.id, work_item_id: ownerId, note_id: targetId })).error
            : kind === "asset"
                ? (await supabaseAdmin.from("note_assets").insert({ workspace_id: workspace.id, note_id: ownerId, asset_id: targetId })).error
                : (await supabaseAdmin.from("note_notes").insert({ workspace_id: workspace.id, parent_note_id: ownerId, attached_note_id: targetId })).error
    if (error && error.code !== "23505") {
        console.error("Attachment link insert failed", { owner, kind, code: error.code, message: error.message })
        return { ok: false as const, error: "This attachment could not be linked. Try again or contact support if it persists." }
    }
    return { ok: true as const }
}
