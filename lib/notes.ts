import { supabaseAdmin } from "@/lib/supabase/admin"

export type WorkspaceNote = {
    id: string
    workspace_id: string
    name: string
    description: string
    created_by: string | null
    created_at: string
    updated_at: string
}

export type NoteRelationshipLink = {
    relationship_id: string
    relationship: { id: string; primary_person_name: string; business_name: string | null } | null
}

export type NoteAssetLink = {
    asset_id: string
    asset: { id: string; title: string; asset_kind: string } | null
}

export function noteHref(workspaceSlug: string, noteId: string) {
    return `/${workspaceSlug}/notes/${noteId}`
}

export async function listWorkspaceNotes(workspaceId: string) {
    const { data, error } = await supabaseAdmin
        .from("notes")
        .select("id,workspace_id,name,description,created_by,created_at,updated_at,note_relationships(relationship_id),note_assets(asset_id)")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(120)
    if (error) throw new Error(error.message)
    return (data ?? []) as Array<WorkspaceNote & { note_relationships: Array<{ relationship_id: string }>; note_assets: Array<{ asset_id: string }> }>
}

export async function getWorkspaceNote(workspaceId: string, noteId: string) {
    const { data, error } = await supabaseAdmin
        .from("notes")
        .select("id,workspace_id,name,description,created_by,created_at,updated_at")
        .eq("workspace_id", workspaceId)
        .eq("id", noteId)
        .maybeSingle()
    if (error) throw new Error(error.message)
    return data as WorkspaceNote | null
}

export async function listNoteRelationships(workspaceId: string, noteId: string) {
    const { data, error } = await supabaseAdmin
        .from("note_relationships")
        .select("relationship_id,relationship:relationships(id,primary_person_name,business_name)")
        .eq("workspace_id", workspaceId)
        .eq("note_id", noteId)
        .order("created_at")
        .limit(20)
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as NoteRelationshipLink[]
}

export async function listNoteAssets(workspaceId: string, noteId: string) {
    const { data, error } = await supabaseAdmin
        .from("note_assets")
        .select("asset_id,asset:assets(id,title,asset_kind)")
        .eq("workspace_id", workspaceId)
        .eq("note_id", noteId)
        .order("created_at")
        .limit(20)
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as NoteAssetLink[]
}
