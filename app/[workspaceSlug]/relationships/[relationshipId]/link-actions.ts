"use server"

import { randomBytes } from "node:crypto"
import { loadRelationshipLinks } from "@/lib/relationship-links"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getWorkspaceProviderConfig } from "@/lib/workspace-integrations"
import { requireWorkspace } from "@/lib/workspaces"

export async function generateRelationshipPortalLink(slug: string, relationshipId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const before = await loadRelationshipLinks(workspace, relationshipId)
    if (before.portal) return { ok: true as const, links: before }
    if (!before.canGeneratePortal) return { ok: false as const, error: "A service must be past onboarding before a portal link can be generated." }
    const existing = await supabaseAdmin.from("client_portal_sessions").select("id,status").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).maybeSingle()
    if (existing.error) return { ok: false as const, error: "The existing portal session could not be checked." }
    const token = randomBytes(32).toString("hex")
    const { error } = existing.data
        ? await supabaseAdmin.from("client_portal_sessions").update({ session_token: token, status: "active", token_revoked_at: null, last_accessed_at: null }).eq("workspace_id", workspace.id).eq("id", existing.data.id).eq("status", "revoked")
        : await supabaseAdmin.from("client_portal_sessions").insert({ workspace_id: workspace.id, relationship_id: relationshipId, session_token: token, status: "active" })
    // Concurrent clicks may race the unique relationship key. Read the winner.
    const after = await loadRelationshipLinks(workspace, relationshipId)
    if (!after.portal) return { ok: false as const, error: error?.message ?? "The portal link could not be generated." }
    return { ok: true as const, links: after }
}

export async function checkRelationshipPortalWhatsAppReadiness(slug: string, relationshipId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const links = await loadRelationshipLinks(workspace, relationshipId)
    if (!links.portal) return { ready: false as const, reason: "Generate an active portal link first." }
    try {
        const { data, error } = await supabaseAdmin.rpc("relationship_messaging_choices", { p_workspace_id: workspace.id, p_relationship_id: relationshipId })
        if (error) throw error
        const choice = (data as Array<{ provider: string; address: string; state: string; confirmedAt: string | null }>).find(item => item.provider === "meta_whatsapp" && item.state === "active" && item.confirmedAt)
        if (!choice) return { ready: false as const, reason: "Confirm the client's WhatsApp connection first." }
        const config = await getWorkspaceProviderConfig(workspace.id, "meta_whatsapp")
        if (config.waba_id !== "1928719317836909" || !/^https:\/\/portal\.scaylup\.com\/[0-9a-f]{64}$/i.test(links.portal.url)) return { ready: false as const, reason: "The approved portal WhatsApp template is unavailable for this workspace or URL." }
        return { ready: true as const, reason: null }
    } catch { return { ready: false as const, reason: "WhatsApp readiness could not be checked." } }
}

export async function sendRelationshipPortalLinkOnWhatsApp(slug: string, relationshipId: string, requestId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return { ok: false as const, error: "Try sending again." }
    const links = await loadRelationshipLinks(workspace, relationshipId)
    if (!links.portal) return { ok: false as const, error: "Generate an active portal link first." }
    const readiness = await checkRelationshipPortalWhatsAppReadiness(slug, relationshipId)
    if (!readiness.ready) return { ok: false as const, error: readiness.reason }
    const [choices, relationship] = await Promise.all([
        supabaseAdmin.rpc("relationship_messaging_choices", { p_workspace_id: workspace.id, p_relationship_id: relationshipId }),
        supabaseAdmin.from("relationships").select("client_id,primary_phone,status").eq("workspace_id", workspace.id).eq("id", relationshipId).maybeSingle(),
    ])
    if (choices.error || relationship.error || !relationship.data || relationship.data.status === "archived") return { ok: false as const, error: "This relationship is unavailable." }
    const choice = (choices.data as Array<{ provider: string; address: string; state: string; confirmedAt: string | null }>).find(item => item.provider === "meta_whatsapp" && item.state === "active" && item.confirmedAt)
    if (!choice) return { ok: false as const, error: "The confirmed WhatsApp connection is unavailable." }
    const { data, error } = await supabaseAdmin.from("onboarding_delivery_outbox").upsert({
        workspace_id: workspace.id, relationship_id: relationshipId, portal_session_id: links.portal.id,
        correlation_id: requestId, kind: "client_portal_link", destination: relationship.data.primary_phone || `relationship:${relationshipId}`,
        payload: { client_id: relationship.data.client_id, message: "Your client portal is ready.", delivery_choices: [{ provider: "meta_whatsapp", address: choice.address }] },
        idempotency_key: `manual-client-portal-link:${requestId}`,
    }, { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true }).select("id,status").maybeSingle()
    if (error) return { ok: false as const, error: "The portal link could not be queued." }
    return { ok: true as const, status: data?.status ?? "queued" }
}
