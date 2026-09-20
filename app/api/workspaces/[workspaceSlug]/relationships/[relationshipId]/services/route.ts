import { unstable_rethrow } from "next/navigation"
import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { readRelationshipServices } from "@/lib/relationship-services-server"

export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }
export async function GET(request: Request, context: { params: Promise<{workspaceSlug: string; relationshipId: string}> }) {
    const { workspaceSlug, relationshipId } = await context.params
    const { workspace, user, access } = await requireWorkspacePanel(workspaceSlug, "relationships")
    await requireRelationshipAccess(access, relationshipId)
    const query = new URL(request.url).searchParams
    const offset = Number(query.get("offset") ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return Response.json({ error: "Invalid page" }, { status: 400, headers })
    try {
        const kind = query.get("kind")
        if (!kind) return Response.json(await readRelationshipServices(workspace.id, relationshipId, user.id, offset), { headers })
        if (kind === "all_time") {
            if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your account changed." }, { status: 409, headers })
            if (access.role !== "owner" && access.role !== "admin") return Response.json({ error: "Financial access required." }, { status: 403, headers })
            const { data, error } = await supabaseAdmin.rpc("relationship_recorded_revenue", { p_workspace_id: workspace.id, p_relationship_id: relationshipId })
            if (error) return Response.json({ error: "All-time value could not load." }, { status: 503, headers })
            return Response.json({ values: data }, { headers })
        }
        if (kind === "historical") {
            if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your account changed." }, { status: 409, headers })
            if (access.role !== "owner" && access.role !== "admin") return Response.json({ error: "Service import access required." }, { status: 403, headers })
            const instanceId = query.get("id") ?? ""
            if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(instanceId)) return Response.json({ error: "Invalid service." }, { status: 400, headers })
            const [instance, revenue] = await Promise.all([
                supabaseAdmin.from("relationship_service_instances").select("id").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("id", instanceId).eq("origin", "already_onboarded").eq("stage", "completed").maybeSingle(),
                supabaseAdmin.from("relationship_historical_service_revenue").select("amount_cents,version").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("instance_id", instanceId).maybeSingle(),
            ])
            if (instance.error || revenue.error) return Response.json({ error: "Historical amount could not load." }, { status: 503, headers })
            if (!instance.data) return Response.json({ error: "Completed historical service not found." }, { status: 404, headers })
            return Response.json({ amount_cents: revenue.data?.amount_cents ?? null, version: revenue.data?.version ?? 0 }, { headers })
        }
        const parameters = { p_workspace_id: workspace.id, p_user_id: user.id }
        if (kind === "generation") {
            if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your account changed." }, { status: 409, headers })
            const instanceId = query.get("id") ?? ""
            if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(instanceId)) return Response.json({ error: "Invalid service." }, { status: 400, headers })
            const result = await supabaseAdmin.rpc("read_service_sop_progress", { p_workspace: workspace.id, p_actor: user.id, p_relationship: relationshipId, p_instance: instanceId })
            if (result.error) return Response.json({ error: "Could not check work generation." }, { status: 503, headers })
            return Response.json(result.data, { headers })
        }
        if (kind === "cards" || kind === "detail") {
            if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your account changed." }, { status: 409, headers })
            const result = await supabaseAdmin.rpc("read_relationship_service_cards", { ...parameters, p_relationship_id: relationshipId, p_offset: offset, p_id: kind === "detail" ? query.get("id") ?? "" : null })
            if (result.error) throw new Error("Could not load service details")
            const { hydrateRelationshipServiceThumbnails } = await import("@/lib/relationship-services-server")
            return Response.json({ ...result.data, items: await hydrateRelationshipServiceThumbnails(result.data.items.slice(0, 30)) }, { headers })
        }
        if (kind === "timeline" || kind === "queue") {
            if (request.headers.get("x-workspace-user") !== user.id) return Response.json({error:"Your session changed."},{status:409,headers})
            const result = await supabaseAdmin.rpc(kind === "timeline" ? "read_relationship_service_plan" : "read_relationship_work_queue", {...parameters,p_relationship_id:relationshipId,p_offset:offset})
            if(result.error) return Response.json({error:"Could not load relationship work."},{status:503,headers})
            if(kind === "queue") return Response.json({...result.data,items:result.data.items.slice(0,30)},{headers})
            const {buildRelationshipServicePlan} = await import("@/lib/relationship-service-plan")
            return Response.json({userId:user.id,relationshipId,services:result.data.services.slice(0,30),hasMore:result.data.services.length>30,workTruncated:result.data.workTruncated,plan:buildRelationshipServicePlan(result.data)},{headers})
        }
        const result = kind === "catalogue" ? await supabaseAdmin.rpc("relationship_service_catalogue", { ...parameters, p_query: (query.get("q") ?? "").slice(0, 100), p_offset: offset })
            : kind === "assignees" ? await supabaseAdmin.rpc("relationship_service_assignees", { ...parameters, p_relationship_id: relationshipId, p_service_id: query.get("service") })
            : kind === "responsibility" ? await supabaseAdmin.rpc("relationship_service_responsibility_choices", { ...parameters, p_relationship_id: relationshipId })
            : ["work", "history"].includes(kind) ? await supabaseAdmin.rpc("relationship_service_activity", { ...parameters, p_relationship_id: relationshipId, p_kind: kind, p_offset: offset }) : null
        if (!result) return Response.json({ error: "Unknown section" }, { status: 400, headers })
        if (result.error) return Response.json({ error: "This section could not be loaded. Check your access and retry." }, { status: 400, headers })
        const data = kind === "catalogue" ? { items: result.data.slice(0, 30), hasMore: result.data.length > 30 } : ["assignees", "responsibility"].includes(kind ?? "") ? result.data : { ...result.data, items: result.data.items.slice(0, 30) }
        return Response.json(data, { headers })
    } catch (error) {
        unstable_rethrow(error)
        return Response.json({ error: "Could not load this section. Try again." }, { status: 503, headers })
    }
}
