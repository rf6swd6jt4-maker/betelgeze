import "server-only"

import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"

export type AttachmentOwner = "relationship" | "work-item" | "note"
export type AttachmentItem = { id: string; kind: "asset" | "note"; title: string; detail: string; previewUrl: string | null }

const linkSource = {
    relationship: { assetTable: "asset_relationships", assetColumn: "relationship_id", noteTable: "note_relationships", noteColumn: "relationship_id" },
    "work-item": { assetTable: "asset_work_items", assetColumn: "work_item_id", noteTable: "note_work_items", noteColumn: "work_item_id" },
    note: { assetTable: "note_assets", assetColumn: "note_id", noteTable: "note_notes", noteColumn: "parent_note_id" },
} as const

export async function listRecordAttachments(workspaceId: string, owner: AttachmentOwner, ownerId: string, options: { skipAssets?: boolean; workspaceSlug?: string } = {}): Promise<AttachmentItem[]> {
    const source = linkSource[owner]
    const noteTarget = owner === "note" ? "attached_note_id" : "note_id"
    const [assetLinks, noteLinks] = await Promise.all([
        options.skipAssets ? Promise.resolve({ data: [], error: null }) : supabaseAdmin.from(source.assetTable).select("asset_id").eq("workspace_id", workspaceId).eq(source.assetColumn, ownerId).order("created_at", { ascending: false }).limit(80),
        supabaseAdmin.from(source.noteTable).select(noteTarget).eq("workspace_id", workspaceId).eq(source.noteColumn, ownerId).order("created_at", { ascending: false }).limit(80),
    ])
    if (assetLinks.error || noteLinks.error) throw new Error("Attachments could not load")
    const assetIds = (assetLinks.data ?? []).map((row) => row.asset_id as string)
    const noteIds = (noteLinks.data ?? []).map((row) => (row as Record<string, string>)[noteTarget])
    const [assets, notes] = await Promise.all([
        assetIds.length ? supabaseAdmin.from("assets").select("id,title,content_type,asset_kind,source_kind,native_kind,storage_path,updated_at").eq("workspace_id", workspaceId).in("id", assetIds) : Promise.resolve({ data: [], error: null }),
        noteIds.length ? supabaseAdmin.from("notes").select("id,name,description,updated_at").eq("workspace_id", workspaceId).in("id", noteIds) : Promise.resolve({ data: [], error: null }),
    ])
    if (assets.error || notes.error) throw new Error("Attachments could not load")
    const assetById = new Map((assets.data ?? []).map((row) => [row.id, row]))
    const noteById = new Map((notes.data ?? []).map((row) => [row.id, row]))
    const assetsOutput = await Promise.all(assetIds.flatMap((id) => assetById.has(id) ? [assetById.get(id)!] : []).map(async (asset, index) => ({
        id: asset.id, kind: "asset" as const, title: asset.title,
        detail: asset.content_type?.split("/").at(-1)?.toUpperCase() ?? asset.asset_kind.replaceAll("_", " "),
        previewUrl: index < 24 && asset.content_type?.startsWith("image/") && asset.storage_path
            ? asset.source_kind === "message" ? `/api/client-messages/media/${asset.storage_path.split("/").map(encodeURIComponent).join("/")}` : asset.native_kind === "sop_extracted_image" && options.workspaceSlug ? `/api/workspaces/${encodeURIComponent(options.workspaceSlug)}/sop-images/${asset.id}?thumbnail=1` : await createUploadSignedUrl(asset.storage_path)
            : null,
    })))
    const notesOutput = noteIds.flatMap((id) => noteById.has(id) ? [noteById.get(id)!] : []).map((note) => ({ id: note.id, kind: "note" as const, title: note.name, detail: note.description.slice(0, 85), previewUrl: null }))
    return [...assetsOutput, ...notesOutput]
}

export async function listAttachmentChoices(workspaceId: string, owner: AttachmentOwner, ownerId: string) {
    const [assets, notes] = await Promise.all([
        supabaseAdmin.from("assets").select("id,title,content_type").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(100),
        supabaseAdmin.from("notes").select("id,name").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(100),
    ])
    if (assets.error || notes.error) throw new Error("Attachment choices could not load")
    return [
        ...(assets.data ?? []).map((asset) => ({ id: asset.id, kind: "asset" as const, title: asset.title, detail: asset.content_type ?? "Asset" })),
        ...(notes.data ?? []).filter((note) => owner !== "note" || note.id !== ownerId).map((note) => ({ id: note.id, kind: "note" as const, title: note.name, detail: "Note" })),
    ]
}
