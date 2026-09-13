import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { validServiceSaleInput } from "@/lib/service-pos"
export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }
type Context = { params: Promise<{ workspaceSlug: string; relationshipId: string }> }
async function authorize(request: Request, context: Context) {
    const { workspaceSlug, relationshipId } = await context.params
    const { workspace, user, access } = await requireWorkspacePanel(workspaceSlug, "relationships")
    await requireRelationshipAccess(access, relationshipId)
    return { workspace, user, relationshipId, valid: request.headers.get("x-workspace-user") === user.id }
}
export async function GET(request: Request, context: Context) {
    const { workspace, user, relationshipId, valid } = await authorize(request, context)
    if (!valid) return Response.json({ error: "Your account changed. Reload the POS." }, { status: 409, headers })
    const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000)
        return Response.json({ error: "Invalid page" }, { status: 400, headers })
    const { data, error } = await supabaseAdmin.rpc("read_relationship_service_pos", {
        p_workspace_id: workspace.id,
        p_relationship_id: relationshipId,
        p_actor_user_id: user.id,
        p_offset: offset,
    })
    if (error)
        return Response.json(
            { error: error.code === "P0001" ? error.message : "Could not load the POS." },
            { status: 400, headers },
        )
    const { hydrateRelationshipServiceThumbnails } = await import("@/lib/relationship-services-server")
    return Response.json({ ...data, items: await hydrateRelationshipServiceThumbnails(data.items.slice(0, 30)), userId: user.id, relationshipId }, { headers })
}
export async function POST(request: Request, context: Context) {
    const { workspace, user, relationshipId, valid } = await authorize(request, context)
    if (!valid) return Response.json({ error: "Your account changed. Reload the POS." }, { status: 409, headers })
    const body = await request.json().catch(() => null)
    if (!validServiceSaleInput(body))
        return Response.json(
            { error: "Choose services, assignments and valid prices before reviewing." },
            { status: 400, headers },
        )
    const { data, error } = await supabaseAdmin.rpc("preview_relationship_service_sale", {
        p_workspace_id: workspace.id,
        p_relationship_id: relationshipId,
        p_actor_user_id: user.id,
        p_input: body,
    })
    if (error)
        return Response.json(
            { error: error.code === "P0001" ? error.message : "Could not review this sale." },
            { status: 400, headers },
        )
    const summaryQuote = {
        ...data,
        modules: data.modules.map((module: { definition: Record<string, unknown> }) => ({
            ...module,
            definition: { name: module.definition.name },
        })),
    }
    if (new URL(request.url).searchParams.get("preview") === "1") {
        const [
            { loadSelectedServicePreview },
            { loadWorkspacePublicBranding },
            { loadWorkspaceClientBrandAssets },
            { createPrivateUploadSignedUrl },
        ] = await Promise.all([
            import("@/lib/onboarding/configuration"),
            import("@/lib/client-branding/public-branding"),
            import("@/lib/client-branding/assets"),
            import("@/lib/onboarding/uploads"),
        ])
        const [preview, branding, assets] = await Promise.all([
            loadSelectedServicePreview(workspace.id, data),
            loadWorkspacePublicBranding(workspace.id, workspace.name),
            loadWorkspaceClientBrandAssets(workspace.id),
        ])
        return Response.json(
            {
                quote: summaryQuote,
                preview: {
                    ...preview,
                    workspaceName: workspace.name,
                    logoSrc: assets.logoPath ? await createPrivateUploadSignedUrl(assets.logoPath) : null,
                    client: {
                        name: data.client.name,
                        email: data.client.email,
                        phone: data.client.phone ?? data.client.whatsapp,
                        isTest: false,
                    },
                    privacyPolicyUrl: branding.privacyPolicyUrl,
                    termsOfServiceUrl: branding.termsOfServiceUrl,
                },
                userId: user.id,
                relationshipId,
            },
            { headers },
        )
    }
    return Response.json({ quote: summaryQuote, userId: user.id, relationshipId }, { headers })
}
