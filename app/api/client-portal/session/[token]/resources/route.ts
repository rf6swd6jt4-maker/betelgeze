import type { NextRequest } from "next/server"
import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"
import { portalResourceFile, portalResourceUpload } from "@/lib/client-portal/resources"
import { getRequiredEnv } from "@/lib/env"
import { ensurePlatformDirectUploads } from "@/lib/onboarding/r2-cors"
import { signUploadReceipt, validUploadReceipt } from "@/lib/onboarding/upload-receipt"
import { createSignedClientPortalResourceUpload, inspectOnboardingUpload } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { persistPortalResource, publicResource, resourceFields } from "@/lib/client-portal/resource-persistence"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ token: string }> }
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })


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
    const input = await request.json().catch(() => null) as { action?: unknown; file?: unknown; upload?: unknown; requestId?: unknown } | null
    const scope = { workspaceId: resolved.workspace.id, relationshipId: resolved.relationship.id, sessionId: resolved.session.id, stepKey: "client_portal_resources", fieldName: "resources" }
    if (input?.action === "prepare") {
        const file = portalResourceFile(input.file)
        if (!file) return json({ error: "This file could not be read. Please choose it again." }, 400)
        try {
            await ensurePlatformDirectUploads()
            const prepared = await createSignedClientPortalResourceUpload(scope.workspaceId, scope.relationshipId, scope.sessionId, file, typeof input.requestId === "string" ? input.requestId : undefined)
            prepared.storedUpload.receipt = signUploadReceipt(scope, prepared.storedUpload, getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"))
            return json(prepared)
        } catch { return json({ error: "Could not prepare your upload. Please try again." }, 503) }
    }
    if (input?.action !== "confirm") return json({ error: "Invalid upload request." }, 400)
    const prefix = `${scope.workspaceId}/client-portal/${scope.relationshipId}/${scope.sessionId}/`
    const upload = portalResourceUpload(input.upload, prefix)
    if (!upload || !validUploadReceipt(scope, upload, getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"))) return json({ error: "This upload could not be verified. Please select the file again." }, 400)
    try { await inspectOnboardingUpload(upload) } catch { return json({ error: "The file has not finished uploading. Please retry the upload." }, 409) }

    const result = await persistPortalResource(upload, scope)
    return json(result, result.error ? 503 : 201)
}
