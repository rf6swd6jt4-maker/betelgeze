"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { noteHref } from "@/lib/notes"
import { workspaceHref } from "@/lib/relationships"
import { requireWorkspace } from "@/lib/workspaces"

export type NoteEditActionState = { ok: true } | { ok: false; error: string }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function formText(formData: FormData, name: string) {
    return String(formData.get(name) ?? "").trim()
}

function formIds(formData: FormData, name: string) {
    const submitted = formData.getAll(name).map(String).filter(Boolean)
    const valid = [...new Set(submitted.filter((id) => uuidPattern.test(id)))].slice(0, 20)
    return { submitted, valid }
}

export async function updateNote(slug: string, noteId: string, formData: FormData): Promise<NoteEditActionState> {
    const { workspace } = await requireWorkspace(slug, "admin")
    if (!uuidPattern.test(noteId)) return { ok: false, error: "This note is unavailable." }
    const name = formText(formData, "name")
    const description = formText(formData, "description")
    if (!name || name.length > 160) return { ok: false, error: "Add a note name of 160 characters or fewer." }
    if (!description || description.length > 20_000) return { ok: false, error: "Add a note description of 20,000 characters or fewer." }

    const relationships = formIds(formData, "relationship_ids")
    const assets = formIds(formData, "asset_ids")
    if (relationships.valid.length !== relationships.submitted.length || assets.valid.length !== assets.submitted.length) {
        return { ok: false, error: "One or more selected links are invalid." }
    }

    const [noteResult, relationshipsResult, assetsResult, currentRelationships, currentAssets] = await Promise.all([
        supabaseAdmin.from("notes").select("id").eq("workspace_id", workspace.id).eq("id", noteId).maybeSingle(),
        relationships.valid.length
            ? supabaseAdmin.from("relationships").select("id").eq("workspace_id", workspace.id).neq("status", "archived").in("id", relationships.valid)
            : Promise.resolve({ data: [], error: null }),
        assets.valid.length
            ? supabaseAdmin.from("assets").select("id").eq("workspace_id", workspace.id).in("id", assets.valid)
            : Promise.resolve({ data: [], error: null }),
        supabaseAdmin.from("note_relationships").select("relationship_id").eq("workspace_id", workspace.id).eq("note_id", noteId),
        supabaseAdmin.from("note_assets").select("asset_id").eq("workspace_id", workspace.id).eq("note_id", noteId),
    ])
    if (noteResult.error || !noteResult.data) return { ok: false, error: "This note is unavailable." }
    if (relationshipsResult.error || (relationshipsResult.data ?? []).length !== relationships.valid.length) return { ok: false, error: "One or more relationships are archived or unavailable." }
    if (assetsResult.error || (assetsResult.data ?? []).length !== assets.valid.length) return { ok: false, error: "One or more assets are unavailable." }
    if (currentRelationships.error || currentAssets.error) return { ok: false, error: "The existing note links could not be checked." }

    const relationshipSet = new Set(relationships.valid)
    const assetSet = new Set(assets.valid)
    const existingRelationshipIds = (currentRelationships.data ?? []).map((link) => link.relationship_id)
    const existingAssetIds = (currentAssets.data ?? []).map((link) => link.asset_id)
    const relationshipAdds = relationships.valid.filter((id) => !existingRelationshipIds.includes(id))
    const assetAdds = assets.valid.filter((id) => !existingAssetIds.includes(id))
    const relationshipRemovals = existingRelationshipIds.filter((id) => !relationshipSet.has(id))
    const assetRemovals = existingAssetIds.filter((id) => !assetSet.has(id))

    const [relationshipAddResult, assetAddResult] = await Promise.all([
        relationshipAdds.length ? supabaseAdmin.from("note_relationships").insert(relationshipAdds.map((relationshipId) => ({ workspace_id: workspace.id, note_id: noteId, relationship_id: relationshipId }))) : Promise.resolve({ error: null }),
        assetAdds.length ? supabaseAdmin.from("note_assets").insert(assetAdds.map((assetId) => ({ workspace_id: workspace.id, note_id: noteId, asset_id: assetId }))) : Promise.resolve({ error: null }),
    ])
    if (relationshipAddResult.error || assetAddResult.error) return { ok: false, error: "The new note links could not be saved." }

    const [relationshipRemoveResult, assetRemoveResult] = await Promise.all([
        relationshipRemovals.length ? supabaseAdmin.from("note_relationships").delete().eq("workspace_id", workspace.id).eq("note_id", noteId).in("relationship_id", relationshipRemovals) : Promise.resolve({ error: null }),
        assetRemovals.length ? supabaseAdmin.from("note_assets").delete().eq("workspace_id", workspace.id).eq("note_id", noteId).in("asset_id", assetRemovals) : Promise.resolve({ error: null }),
    ])
    if (relationshipRemoveResult.error || assetRemoveResult.error) return { ok: false, error: "The removed note links could not be saved." }

    const { data: updated, error } = await supabaseAdmin.from("notes").update({ name, description }).eq("workspace_id", workspace.id).eq("id", noteId).select("id").maybeSingle()
    if (error || !updated) return { ok: false, error: "The note could not be updated." }

    revalidatePath(noteHref(slug, noteId))
    revalidatePath(workspaceHref(slug, "notes"))
    for (const relationshipId of new Set([...existingRelationshipIds, ...relationships.valid])) revalidatePath(`/${slug}/relationships/${relationshipId}`)
    return { ok: true }
}


export async function saveNoteFields(slug: string, noteId: string, formData: FormData): Promise<NoteEditActionState> {
    const { workspace } = await requireWorkspace(slug, "admin")
    if (!uuidPattern.test(noteId)) return { ok: false, error: "This note is unavailable." }
    const name = formText(formData, "name")
    const description = formText(formData, "description")
    if (!name || name.length > 160) return { ok: false, error: "Add a note name of 160 characters or fewer." }
    if (!description || description.length > 20_000) return { ok: false, error: "Add a note description of 20,000 characters or fewer." }
    const { data, error } = await supabaseAdmin.from("notes").update({ name, description }).eq("workspace_id", workspace.id).eq("id", noteId).select("id").maybeSingle()
    if (error || !data) return { ok: false, error: "The note could not be saved." }
    revalidatePath(noteHref(slug, noteId))
    return { ok: true }
}

export async function updateNoteRelationships(slug: string, noteId: string, selected: string[]): Promise<NoteEditActionState> {
    const { workspace } = await requireWorkspace(slug, "admin")
    if (!uuidPattern.test(noteId) || selected.length > 20 || selected.some(id => !uuidPattern.test(id)) || new Set(selected).size !== selected.length) return { ok: false, error: "Invalid relationship selection." }
    const [note, available, current] = await Promise.all([
        supabaseAdmin.from("notes").select("id").eq("workspace_id", workspace.id).eq("id", noteId).maybeSingle(),
        selected.length ? supabaseAdmin.from("relationships").select("id").eq("workspace_id", workspace.id).neq("status", "archived").in("id", selected) : Promise.resolve({ data: [], error: null }),
        supabaseAdmin.from("note_relationships").select("relationship_id").eq("workspace_id", workspace.id).eq("note_id", noteId),
    ])
    if (note.error || !note.data || available.error || available.data?.length !== selected.length || current.error) return { ok: false, error: "One or more linked relationships are unavailable." }
    const prior = (current.data ?? []).map(item => item.relationship_id)
    const add = selected.filter(id => !prior.includes(id))
    const remove = prior.filter(id => !selected.includes(id))
    if (add.length) {
        const result = await supabaseAdmin.from("note_relationships").insert(add.map(id => ({ workspace_id: workspace.id, note_id: noteId, relationship_id: id })))
        if (result.error) return { ok: false, error: "The relationships could not be linked." }
    }
    if (remove.length) {
        const result = await supabaseAdmin.from("note_relationships").delete().eq("workspace_id", workspace.id).eq("note_id", noteId).in("relationship_id", remove)
        if (result.error) return { ok: false, error: "The relationships could not be unlinked." }
    }
    revalidatePath(noteHref(slug, noteId))
    return { ok: true }
}
