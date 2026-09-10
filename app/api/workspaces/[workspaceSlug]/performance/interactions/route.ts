import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { sanitizeWorkspacePerformanceSample } from "@/lib/workspace-performance-contract"

export const dynamic = "force-dynamic"

const MAX_PAYLOAD_BYTES = 32_768

async function boundedBody(request: Request) {
    const reader = request.body?.getReader()
    if (!reader) return ""
    const decoder = new TextDecoder()
    let length = 0
    let text = ""
    try {
        for (;;) {
            const chunk = await reader.read()
            if (chunk.done) return text + decoder.decode()
            length += chunk.value.byteLength
            if (length > MAX_PAYLOAD_BYTES) {
                await reader.cancel()
                return null
            }
            text += decoder.decode(chunk.value, { stream: true })
        }
    } finally {
        reader.releaseLock()
    }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const origin = request.headers.get("origin")
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
        return Response.json({ error: "Invalid request origin." }, { status: 403 })
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        return Response.json({ error: "Expected JSON." }, { status: 415 })
    }
    const raw = await boundedBody(request)
    if (raw === null) return Response.json({ error: "Performance payload is too large." }, { status: 413 })
    let input: unknown
    try { input = JSON.parse(raw) } catch { return Response.json({ error: "Invalid performance payload." }, { status: 400 }) }
    const values = input && typeof input === "object" && "samples" in input ? input.samples : null
    if (!Array.isArray(values) || values.length === 0 || values.length > 20) {
        return Response.json({ error: "Expected one to twenty measurements." }, { status: 400 })
    }
    const samples = values.map(sanitizeWorkspacePerformanceSample)
    if (samples.some((sample) => sample === null)) return Response.json({ error: "Invalid measurement." }, { status: 400 })
    const { workspaceSlug } = await context.params
    const { workspace } = await requireWorkspace(workspaceSlug)
    const rows = samples.flatMap((sample) => sample ? [{
        workspace_id: workspace.id,
        sample_id: sample.sampleId,
        operation: sample.operation,
        command_name: sample.command,
        route_section: sample.routeSection,
        deployment_sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 64) || null,
        measurement: sample,
    }] : [])
    const { error } = await supabaseAdmin.from("workspace_interaction_metrics").upsert(rows, { onConflict: "workspace_id,sample_id", ignoreDuplicates: true })
    if (error) {
        console.warn("Workspace interaction measurements could not be stored", { code: error.code })
        return Response.json({ accepted: false }, { status: 202, headers: { "Cache-Control": "no-store" } })
    }
    return Response.json({ accepted: true, count: rows.length }, { headers: { "Cache-Control": "no-store" } })
}
