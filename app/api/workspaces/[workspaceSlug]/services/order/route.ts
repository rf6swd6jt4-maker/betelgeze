import { unstable_rethrow } from "next/navigation"
import { validServiceOrder, type ReorderedServices } from "@/lib/onboarding/service-order"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
        return Response.json({ ok: false, error: "Invalid save origin." }, { status: 403, headers })
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
        return Response.json({ ok: false, error: "Invalid save format." }, { status: 415, headers })
    }
    if (Number(request.headers.get("content-length")) > 400_000) {
        return Response.json({ ok: false, error: "The service order is too large." }, { status: 413, headers })
    }

    let body: unknown
    try {
        const raw = await request.text()
        if (new TextEncoder().encode(raw).length > 400_000) return Response.json({ ok: false, error: "The service order is too large." }, { status: 413, headers })
        body = JSON.parse(raw)
    } catch {
        return Response.json({ ok: false, error: "Invalid save format." }, { status: 400, headers })
    }
    const serviceIds = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).serviceIds : null
    if (!validServiceOrder(serviceIds)) return Response.json({ ok: false, error: "Choose each service exactly once." }, { status: 400, headers })

    const { workspaceSlug } = await context.params
    const started = performance.now()
    try {
        const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
        const args = {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_service_ids: serviceIds,
        }
        const { data, error } = await supabaseAdmin.rpc("reorder_onboarding_services", args)
        const outcome = error
            ? { ok: false as const, error: error.message.trim().slice(0, 400) }
            : { ok: true as const, data: (Array.isArray(data) && data.length === 1 ? data[0] : data) as ReorderedServices }
        return Response.json(outcome, {
            status: outcome.ok ? 200 : 400,
            headers: { ...headers, "Server-Timing": `commit;dur=${(performance.now() - started).toFixed(1)}` },
        })
    } catch (error) {
        unstable_rethrow(error)
        return Response.json({ ok: false, error: "The service order could not be confirmed. Your order is preserved for retry." }, { status: 503, headers })
    }
}
