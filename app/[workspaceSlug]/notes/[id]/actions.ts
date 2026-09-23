"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { noteHref } from "@/lib/notes"
import { requireWorkspace } from "@/lib/workspaces"

export type NoteEditActionState = { ok: true } | { ok: false; error: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Old mounted forms lack authoritative baselines. Never fall back to blind updates.
export async function updateNote(_slug: string, _noteId: string, _formData: FormData): Promise<NoteEditActionState> {
    void [_slug, _noteId, _formData]
    return { ok: false, error: "This editor needs to be reloaded. Copy your draft before reloading; no changes were saved." }
}
export async function saveNoteFields(_slug: string, _noteId: string, _formData: FormData): Promise<NoteEditActionState> {
    void [_slug, _noteId, _formData]
    return { ok: false, error: "This editor needs to be reloaded. Copy your draft before reloading; no changes were saved." }
}

export async function saveNoteText(slug: string, noteId: string, field: "name" | "description", value: string, baseline: string, expectedUserId: string) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    if (user.id !== expectedUserId) return { ok: false as const, error: "Your session changed. Your draft is preserved; reload before retrying." }
    if (!uuid.test(noteId) || !["name", "description"].includes(field) || typeof value !== "string" || typeof baseline !== "string" || baseline.length > 20000 || !value.trim() || value.trim().length > (field === "name" ? 160 : 20000)) return { ok: false as const, error: "Check the note name and description." }
    const result = await supabaseAdmin.rpc("save_note_text", { p_workspace: workspace.id, p_actor: user.id, p_note: noteId, p_field: field, p_value: value, p_baseline: baseline })
    if (result.error || !result.data) return { ok: false as const, error: "This note change could not be confirmed. Your draft is preserved; retry when available." }
    const saved = result.data as { ok: boolean; version: string; value?: string }
    if (!saved.ok) return { ok: false as const, conflict: true, error: "This field changed elsewhere. Your draft is preserved; review the latest saved version." }
    revalidatePath(noteHref(slug, noteId))
    return { ok: true as const, version: saved.version }
}

export async function updateNoteRelationships(slug: string, noteId: string, selected: string[], baseline?: string[], expectedUserId?: string): Promise<NoteEditActionState> {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    if (user.id !== expectedUserId || !Array.isArray(baseline)) return { ok: false, error: "This editor needs to be reloaded. Your selection is preserved; no links were changed." }
    if (!uuid.test(noteId) || !Array.isArray(selected) || [selected, baseline].some(ids => ids.length > 20 || ids.some(id => typeof id !== "string" || !uuid.test(id)) || new Set(ids).size !== ids.length)) return { ok: false, error: "Invalid relationship selection." }
    const add = selected.filter(id => !baseline.includes(id))
    const remove = baseline.filter(id => !selected.includes(id))
    const result = await supabaseAdmin.rpc("edit_note_relationships", { p_workspace: workspace.id, p_actor: user.id, p_note: noteId, p_add: add, p_remove: remove })
    if (result.error) return { ok: false, error: result.error.code === "P0001" ? result.error.message : "The link changes could not be confirmed. Retry the same selection." }
    revalidatePath(noteHref(slug, noteId))
    return { ok: true }
}
