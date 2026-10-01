import "server-only"
import { assetPreviewUrl } from "@/lib/assets/preview"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { decodePrivateAttachmentCursor, encodePrivateAttachmentCursor } from "@/lib/assets/attachment-cursor"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { ATTACHMENT_PAGE_SIZE, attachmentCursorFilter, attachmentPageRows, attachmentSearch, decodeAttachmentCursor, encodeAttachmentCursor, type AttachmentPosition } from "@/lib/attachment-pages"

export type AttachmentOwner = "relationship" | "work-item" | "note"
export type AttachmentItem = { id: string; kind: "asset" | "note"; title: string; detail: string; previewUrl: string | null }
export type AttachmentChoice = Omit<AttachmentItem, "previewUrl">
export type AttachmentPage<T> = { items: T[]; nextCursor: string | null }
const linkSource = {
    relationship: { assetTable: "asset_relationships", assetColumn: "relationship_id", noteTable: "note_relationships", noteColumn: "relationship_id" },
    "work-item": { assetTable: "asset_work_items", assetColumn: "work_item_id", noteTable: "note_work_items", noteColumn: "work_item_id" },
    note: { assetTable: "note_assets", assetColumn: "note_id", noteTable: "note_notes", noteColumn: "parent_note_id" },
} as const

export async function listRecordAttachments(workspaceId: string, owner: AttachmentOwner, ownerId: string, options: { cursor?: string | null; workspaceSlug?: string } = {}): Promise<AttachmentPage<AttachmentItem>> {
    const reader = await createSupabaseServerClient()
    const scope = `${workspaceId}:${owner}:${ownerId}`
    const cursor = decodePrivateAttachmentCursor(options.cursor, scope)
    const source = linkSource[owner], noteTarget = owner === "note" ? "attached_note_id" : "note_id"
    const links = async (table: string, parent: string, target: string, position: AttachmentPosition | null | undefined) => {
        if (position === null) return { items: [], next: null }
        // Bound candidates before record policy evaluation. The parent is checked
        // by the endpoint; neither these link rows nor denied target IDs leave
        // this server. Record reads below recheck the current session via RLS.
        let query = supabaseAdmin.from(table).select(`${target},created_at`).eq("workspace_id", workspaceId).eq(parent, ownerId).order("created_at", { ascending: false }).order(target, { ascending: false }).limit(ATTACHMENT_PAGE_SIZE + 1)
        if (position) query = query.or(attachmentCursorFilter(position, "created_at", target))
        const result = await query
        if (result.error) throw new Error("Attachments could not load")
        return attachmentPageRows((result.data ?? []).map(row => { const record = row as unknown as Record<string, string>; return { id: record[target], at: record.created_at } }))
    }
    const [assetLinks, noteLinks] = await Promise.all([links(source.assetTable, source.assetColumn, "asset_id", cursor?.asset), links(source.noteTable, source.noteColumn, noteTarget, cursor?.note)])
    const assetIds = assetLinks.items.map(row => row.id), noteIds = noteLinks.items.map(row => row.id)
    const [assets, notes] = await Promise.all([
        assetIds.length ? reader.from(source.assetTable).select("assets!inner(id,workspace_id,title,content_type,asset_kind,source_kind,native_kind,storage_path,updated_at)").eq("workspace_id", workspaceId).eq(source.assetColumn, ownerId).in("asset_id", assetIds) : Promise.resolve({ data: [], error: null }),
        noteIds.length ? reader.from("notes").select("id,name,description,updated_at").eq("workspace_id", workspaceId).in("id", noteIds) : Promise.resolve({ data: [], error: null }),
    ])
    if (assets.error || notes.error) throw new Error("Attachments could not load")
    // Recheck the link as well as its target: an asset readable through another
    // relationship must not reveal its attachment to a now-revoked parent.
    const assetRows = (assets.data ?? []).flatMap(row => Array.isArray(row.assets) ? row.assets : row.assets ? [row.assets] : [])
    const assetById = new Map(assetRows.map(row => [row.id, row])), noteById = new Map((notes.data ?? []).map(row => [row.id, row]))
    const assetItems = await Promise.all(assetIds.flatMap(id => assetById.has(id) ? [assetById.get(id)!] : []).map(async asset => ({
        id: asset.id, kind: "asset" as const, title: asset.title,
        detail: asset.content_type?.split("/").at(-1)?.toUpperCase() ?? asset.asset_kind.replaceAll("_", " "),
        previewUrl: asset.content_type?.startsWith("image/") && asset.storage_path
            ? await assetPreviewUrl(workspaceId, options.workspaceSlug ?? "", asset, true)
            : null,
    })))
    const noteItems = noteIds.flatMap(id => noteById.has(id) ? [noteById.get(id)!] : []).map(note => ({ id: note.id, kind: "note" as const, title: note.name, detail: note.description.slice(0, 85), previewUrl: null }))
    return { items: [...assetItems, ...noteItems], nextCursor: encodePrivateAttachmentCursor({ asset: assetLinks.next, note: noteLinks.next }, scope) }
}

export async function listAttachmentChoices(workspaceId: string, owner: AttachmentOwner, ownerId: string, options: { cursor?: string | null; search?: string; allowAssets?: boolean } = {}): Promise<AttachmentPage<AttachmentChoice>> {
    const reader = await createSupabaseServerClient()
    const cursor = decodeAttachmentCursor(options.cursor), search = attachmentSearch(options.search ?? "")
    const read = async (kind: "asset" | "note") => {
        const position = cursor?.[kind]
        if (position === null || (kind === "asset" && options.allowAssets === false)) return { items: [], next: null }
        const name = kind === "asset" ? "title" : "name"
        let query = reader.from(kind === "asset" ? "assets" : "notes").select(kind === "asset" ? "id,title,content_type,updated_at" : "id,name,updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(ATTACHMENT_PAGE_SIZE + 1)
        if (kind === "asset") query = query.is("metadata->>archived_at", null)
        if (owner === "note" && kind === "note") query = query.neq("id", ownerId)
        if (search) query = query.ilike(name, `%${search}%`)
        if (position) query = query.or(attachmentCursorFilter(position, "updated_at", "id"))
        const result = await query
        if (result.error) throw new Error("Attachment choices could not load")
        return attachmentPageRows((result.data ?? []).map(row => { const r = row as unknown as Record<string, string>; return { id: r.id, at: r.updated_at, kind, title: r[name], detail: kind === "note" ? "Note" : r.content_type ?? "Asset" } }))
    }
    const [assets, notes] = await Promise.all([read("asset"), read("note")])
    return { items: [...assets.items, ...notes.items], nextCursor: encodeAttachmentCursor({ asset: assets.next, note: notes.next }) }
}
