import { requireWorkspaceAccess } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { loadWorkspaceOperations } from "@/lib/teams/operations"

export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspaceAccess(workspaceSlug)
    const permission = await supabaseAdmin.rpc("workspace_user_can_sell", { p_workspace_id: workspace.id, p_user_id: user.id })
    if (permission.error || permission.data !== true) return Response.json({ error: "Your account is not enabled for selling." }, { status: 403 })
    try {
        const [operations, services, revisions] = await Promise.all([
            loadWorkspaceOperations(workspace.id),
            supabaseAdmin.from("onboarding_services").select("id, internal_code").eq("workspace_id", workspace.id).eq("state", "active"),
            supabaseAdmin.from("onboarding_service_revisions").select("id, service_id, name, revision_number, definition").eq("workspace_id", workspace.id).order("revision_number", { ascending: false }),
        ])
        if (services.error || revisions.error) throw new Error("Service choices could not be loaded.")
        return Response.json({
            managers: operations.people.filter((person) => person.canManage).map((person) => ({ id: person.id, name: person.name })),
            services: (services.data ?? []).flatMap((service) => {
                const revision = revisions.data?.find((item) => item.service_id === service.id)
                if (!revision) return []
                const definition = revision.definition as Record<string, unknown> | null
                return [{ id: service.id, revisionId: revision.id, name: revision.name,
                    appointmentSetting: (definition?.templateId ?? definition?.template_id) === "appointment-setting",
                    people: operations.people.filter((person) => operations.eligible.some((item) => item.service_id === service.id && item.user_id === person.id)).map((person) => ({ id: person.id, name: person.name })),
                }]
            }).sort((a, b) => a.name.localeCompare(b.name)),
        }, { headers: { "Cache-Control": "private, no-store" } })
    } catch {
        return Response.json({ error: "Service and team choices could not be loaded. Please retry." }, { status: 503 })
    }
}
