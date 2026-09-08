import type { NextRequest } from "next/server"
import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"
import { portalResourceFile, portalResourceUpload } from "@/lib/client-portal/resources"
import { getRequiredEnv } from "@/lib/env"
import { ensurePlatformDirectUploads } from "@/lib/onboarding/r2-cors"
import { signUploadReceipt, validUploadReceipt } from "@/lib/onboarding/upload-receipt"
import { createSignedClientPortalResourceUpload, inspectOnboardingUpload } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ token: string }> }
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })
const resourceFields = "id, title, content_type, file_size, created_at"
const publicResource = (row: { id: string; title: string; content_type: string | null; file_size: number | null; created_at: string }) => ({ id: row.id, name: row.title, type: row.content_type ?? "application/octet-stream", size: row.file_size ?? 0, createdAt: row.created_at })

export async function GET(request: NextRequest, context: Context) {
    const resolved = await resolveClientPortalAccessByToken((await context.params).token)
    if (!resolved) return json({ error: "This portal link is no longer available." }, 404)
    const offset = Math.floor(Math.max(0, Math.min(100_000, Number(request.nextUrl.searchParams.get("offset")) || 0)))
    const { data, error } = await supabaseAdmin.from("assets")
        .select(`${resourceFields}, asset_relationships!inner(relationship_id, workspace_id)`)
        .eq("workspace_id", resolved.workspace.id).eq("native_kind", "client_portal_resource")
        .eq("asset_relationships.workspace_id", resolved.workspace.id).eq("asset_relationships.relationship_id", resolved.relationship.id)
        .order("created_at", { ascending: false }).order("id").range(offset, offset + 25)
    if (error) return json({ error: "Resources could not be loaded. Please try again." }, 503)
    return json({ resources: (data ?? []).slice(0, 25).map(publicResource), hasMore: (data?.length ?? 0) > 25 })
}

export async function POST(request: NextRequest, context: Context) {
    const resolved = await resolveClientPortalAccessByToken((await context.params).token)
    if (!resolved) return json({ error: "This portal link is no longer available." }, 404)
    const input = await request.json().catch(() => null) as { action?: unknown; file?: unknown; upload?: unknown } | null
    const scope = { workspaceId: resolved.workspace.id, relationshipId: resolved.relationship.id, sessionId: resolved.session.id, stepKey: "client_portal_resources", fieldName: "resources" }
    if (input?.action === "prepare") {
        const file = portalResourceFile(input.file)
        if (!file) return json({ error: "Choose a non-empty file up to 500 MB with a valid filename." }, 400)
        const recent = await supabaseAdmin.from("assets").select("id", { count: "exact", head: true })
            .eq("workspace_id", scope.workspaceId).eq("native_kind", "client_portal_resource")
            .eq("metadata->>relationship_id", scope.relationshipId).gte("created_at", new Date(Date.now() - 3_600_000).toISOString())
        if (recent.error) return json({ error: "Uploads are temporarily unavailable. Please try again." }, 503)
        if ((recent.count ?? 0) >= 100) return json({ error: "You have uploaded many files recently. Please try again later." }, 429)
        try {
            await ensurePlatformDirectUploads()
            const prepared = await createSignedClientPortalResourceUpload(scope.workspaceId, scope.relationshipId, scope.sessionId, file)
            prepared.storedUpload.receipt = signUploadReceipt(scope, prepared.storedUpload, getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"))
            return json(prepared)
        } catch { return json({ error: "Could not prepare your upload. Please try again." }, 503) }
    }
    if (input?.action !== "confirm") return json({ error: "Invalid upload request." }, 400)
    const prefix = `${scope.workspaceId}/client-portal/${scope.relationshipId}/${scope.sessionId}/`
    const upload = portalResourceUpload(input.upload, prefix)
    if (!upload || !validUploadReceipt(scope, upload, getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"))) return json({ error: "This upload could not be verified. Please select the file again." }, 400)
    try { await inspectOnboardingUpload(upload) } catch { return json({ error: "The file has not finished uploading. Please retry the upload." }, 409) }

    // The unique native key makes confirmation retries safe. A retry also repairs
    // a relationship link if storage/asset persistence succeeded before a disconnect.
    const findExisting = () => supabaseAdmin.from("assets").select(resourceFields)
        .eq("workspace_id", scope.workspaceId).eq("native_kind", "client_portal_resource").eq("native_key", upload.path).maybeSingle()
    let existing = await findExisting()
    if (existing.error) return json({ error: "Could not save this resource. Please retry." }, 503)
    if (!existing.data) {
        const created = await supabaseAdmin.from("assets").insert({
            workspace_id: scope.workspaceId, title: upload.name,
            asset_kind: upload.kind === "image" || upload.kind === "video" ? "media" : upload.kind === "document" ? "document" : "file",
            source_kind: "upload", storage_path: upload.path, content_type: upload.type, file_size: upload.size,
            native_kind: "client_portal_resource", native_key: upload.path,
            metadata: { source: "client_portal", relationship_id: scope.relationshipId, portal_session_id: scope.sessionId },
        }).select(resourceFields).single()
        if (created.error?.code === "23505") existing = await findExisting()
        else existing = created
    }
    if (existing.error || !existing.data) return json({ error: "Could not save this resource. Please retry." }, 503)
    const linked = await supabaseAdmin.from("asset_relationships").upsert({
        workspace_id: scope.workspaceId, relationship_id: scope.relationshipId, asset_id: existing.data.id,
    }, { onConflict: "asset_id,relationship_id" })
    if (linked.error) return json({ error: "Your file uploaded, but could not be attached to your account. Please retry saving." }, 503)
    return json({ resource: publicResource(existing.data) }, 201)
}
