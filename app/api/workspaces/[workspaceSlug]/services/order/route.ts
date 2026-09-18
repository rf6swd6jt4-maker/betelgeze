import { unstable_rethrow } from "next/navigation"
import { recordAdminActivity } from "@/lib/admin/activity"
import { validServiceOrder, type ReorderedServices } from "@/lib/onboarding/service-order"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }

type ServiceRevision = {
    id: string
    service_id: string
    revision_number: number
    display_priority: number
    definition: Record<string, unknown> | null
}

function latestRevisions(rows: ServiceRevision[]) {
    const latest = new Map<string, ServiceRevision>()
    for (const row of rows) {
        const current = latest.get(row.service_id)
        if (!current || row.revision_number > current.revision_number) latest.set(row.service_id, row)
    }
    return latest
}

async function reorderWithoutRpc(workspaceId: string, actorUserId: string, serviceIds: string[]): Promise<{ ok: true; data: ReorderedServices } | { ok: false; error: string }> {
    const { data: services, error: servicesError } = await supabaseAdmin
        .from("onboarding_services")
        .select("id")
        .eq("workspace_id", workspaceId)
    const availableIds = new Set((services ?? []).map((service) => service.id))
    if (servicesError) throw servicesError
    if (availableIds.size !== serviceIds.length || serviceIds.some((id) => !availableIds.has(id))) {
        return { ok: false, error: "The service list changed. Refresh and try again." }
    }

    const { data: revisionRows, error: revisionsError } = await supabaseAdmin
        .from("onboarding_service_revisions")
        .select("id, service_id, revision_number, display_priority, definition")
        .eq("workspace_id", workspaceId)
        .in("service_id", serviceIds)
    if (revisionsError) throw revisionsError
    const revisions = latestRevisions((revisionRows ?? []) as ServiceRevision[])
    if (revisions.size !== serviceIds.length) {
        return { ok: false, error: "Every service must have a current revision before it can be reordered." }
    }

    const originals = serviceIds.map((serviceId) => revisions.get(serviceId)!)
    const updates = await Promise.all(originals.map((revision, index) => {
        const displayPriority = serviceIds.length - index
        return supabaseAdmin
            .from("onboarding_service_revisions")
            .update({
                display_priority: displayPriority,
                definition: { ...(revision.definition ?? {}), displayPriority },
            })
            .eq("workspace_id", workspaceId)
            .eq("id", revision.id)
            .eq("revision_number", revision.revision_number)
            .select("id")
            .maybeSingle()
    }))
    const failed = updates.some(({ data, error }) => error || !data)
    if (failed) {
        await Promise.all(originals.map((revision) => supabaseAdmin
            .from("onboarding_service_revisions")
            .update({ display_priority: revision.display_priority, definition: revision.definition ?? {} })
            .eq("workspace_id", workspaceId)
            .eq("id", revision.id)))
        throw new Error("A service revision changed while its order was being saved")
    }

    const { data: confirmedRows, error: confirmationError } = await supabaseAdmin
        .from("onboarding_service_revisions")
        .select("id, service_id, revision_number, display_priority, definition")
        .eq("workspace_id", workspaceId)
        .in("service_id", serviceIds)
    if (confirmationError) throw confirmationError
    const confirmed = latestRevisions((confirmedRows ?? []) as ServiceRevision[])
    const confirmedOrder = [...confirmed.values()]
        .sort((left, right) => right.display_priority - left.display_priority)
        .map((revision) => revision.service_id)
    if (confirmed.size !== serviceIds.length || confirmedOrder.some((id, index) => id !== serviceIds[index])) {
        await Promise.all(originals.map((revision) => supabaseAdmin
            .from("onboarding_service_revisions")
            .update({ display_priority: revision.display_priority, definition: revision.definition ?? {} })
            .eq("workspace_id", workspaceId)
            .eq("id", revision.id)))
        throw new Error("The service order changed before it could be confirmed")
    }

    await recordAdminActivity({
        workspaceId,
        category: "services",
        eventKey: "services.order.changed",
        summary: "Service onboarding order changed",
        entityType: "onboarding_service_order",
        entityId: workspaceId,
        actorUserId,
        actorKind: "staff",
        metadata: { service_count: serviceIds.length, save_path: "revision_fallback" },
    })
    return { ok: true, data: { service_count: serviceIds.length } }
}

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
        const schemaUnavailable = error && (error.code === "42883" || error.code === "PGRST202" || error.message.toLowerCase().includes("schema cache"))
        const outcome = schemaUnavailable
            ? await reorderWithoutRpc(workspace.id, user.id, serviceIds)
            : error
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
