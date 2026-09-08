import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"
import { abortResourceMultipart, completeResourceMultipart, resourcePartUrl, startResourceMultipart, validResourceTicket } from "@/lib/client-portal/resource-multipart"
import { persistPortalResource } from "@/lib/client-portal/resource-persistence"
import { portalResourceFile } from "@/lib/client-portal/resources"
import { getRequiredEnv } from "@/lib/env"
import { ensurePlatformDirectUploads } from "@/lib/onboarding/r2-cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } })

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
    const resolved = await resolveClientPortalAccessByToken((await context.params).token)
    if (!resolved) return json({ error: "This portal link is no longer available." }, 404)
    const input = await request.json().catch(() => null)
    if (!input || typeof input !== "object") return json({ error: "Invalid upload request." }, 400)
    const scope = { workspaceId: resolved.workspace.id, relationshipId: resolved.relationship.id, sessionId: resolved.session.id }
    if (input.action === "start") {
        const file = portalResourceFile(input.file)
        if (!file || typeof input.requestId !== "string" || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.requestId)) return json({ error: "This file could not be read." }, 400)
        try {
            await ensurePlatformDirectUploads()
            return json({ ticket: await startResourceMultipart(scope, { ...file, folder: input.folder === true, requestId: input.requestId }) })
        } catch { return json({ error: "Could not start the upload. Please try again." }, 503) }
    }
    if (!validResourceTicket(input.ticket, scope, getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"))) return json({ error: "This upload could not be verified." }, 400)
    try {
        if (input.action === "part") return json({ uploadUrl: await resourcePartUrl(input.ticket, input.partNumber, input.size) })
        if (input.action === "abort") { await abortResourceMultipart(input.ticket); return json({ ok: true }) }
        if (input.action === "complete") {
            const upload = await completeResourceMultipart(input.ticket, input.size, input.partCount)
            const result = await persistPortalResource(upload, scope)
            return json(result, result.error ? 503 : 201)
        }
    } catch { return json({ error: "The upload hasn’t finished yet. Please retry." }, 503) }
    return json({ error: "Invalid upload request." }, 400)
}
