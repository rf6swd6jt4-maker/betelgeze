import type { StoredUpload } from "@/lib/onboarding/forms"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const resourceFields = "id, title, content_type, file_size, created_at"
export const publicResource = (row: { id: string; title: string; content_type: string | null; file_size: number | null; created_at: string }) => ({ id: row.id, name: row.title, type: row.content_type ?? "application/octet-stream", size: row.file_size ?? 0, createdAt: row.created_at })

export async function persistPortalResource(upload: StoredUpload, scope: { workspaceId: string; relationshipId: string; sessionId: string }) {
    // The unique native key makes confirmation retries safe, including repair of a partial link save.
    const findExisting = () => supabaseAdmin.from("assets").select(resourceFields)
        .eq("workspace_id", scope.workspaceId).eq("native_kind", "client_portal_resource").eq("native_key", upload.path).maybeSingle()
    let existing = await findExisting()
    if (existing.error) return { error: "Could not save this resource. Please retry." }
    if (!existing.data) {
        const created = await supabaseAdmin.from("assets").insert({
            workspace_id: scope.workspaceId, title: upload.name,
            asset_kind: /^(image|video|audio)\//.test(upload.type) ? "media" : /pdf|document|spreadsheet|presentation/.test(upload.type) ? "document" : "file",
            source_kind: "upload", storage_path: upload.path, content_type: upload.type, file_size: upload.size,
            native_kind: "client_portal_resource", native_key: upload.path,
            metadata: { source: "client_portal", relationship_id: scope.relationshipId, portal_session_id: scope.sessionId },
        }).select(resourceFields).single()
        if (created.error?.code === "23505") existing = await findExisting()
        else existing = created
    }
    if (existing.error || !existing.data) return { error: "Could not save this resource. Please retry." }
    const linked = await supabaseAdmin.from("asset_relationships").upsert({
        workspace_id: scope.workspaceId, relationship_id: scope.relationshipId, asset_id: existing.data.id,
    }, { onConflict: "asset_id,relationship_id" })
    if (linked.error) return { error: "Your file uploaded, but could not be attached to your account. Please retry saving." }
    return { resource: publicResource(existing.data) }
}
