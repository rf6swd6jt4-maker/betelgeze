"use server"

import { randomBytes } from "node:crypto"
import { loadRelationshipLinks } from "@/lib/relationship-links"
import { whatsappOnboardingTemplateComponents } from "@/lib/client-messages/whatsapp-onboarding-template"
import { processWorkspaceOnboardingOutbox } from "@/lib/onboarding/outbox"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getWhatsAppClientPortalTemplate, getWorkspaceProviderConfig } from "@/lib/workspace-integrations"
import { requireWorkspace } from "@/lib/workspaces"
import { after } from "next/server"

type MessagingChoice = {
    provider: string
    address: string
    state: string
    enabled?: boolean
}

async function portalWhatsAppReadiness(
    workspace: { id: string; slug: string },
    relationshipId: string,
    existingLinks?: Awaited<ReturnType<typeof loadRelationshipLinks>>,
) {
    const links = existingLinks ?? await loadRelationshipLinks(workspace, relationshipId)
    if (!links.portal) return { ready: false as const, reason: "Generate an active portal link after onboarding first." }
    try {
        const [choices, config] = await Promise.all([
            supabaseAdmin.rpc("relationship_messaging_choices", { p_workspace_id: workspace.id, p_relationship_id: relationshipId }),
            getWorkspaceProviderConfig(workspace.id, "meta_whatsapp"),
        ])
        if (choices.error) throw choices.error
        const choice = (choices.data as MessagingChoice[]).find((item) => (
            item.provider === "meta_whatsapp"
            && item.enabled !== false
            && ["active", "inactive"].includes(item.state)
            && Boolean(item.address)
        ))
        if (!choice) return { ready: false as const, reason: "Add the client's WhatsApp number before sending the portal link." }
        const template = await getWhatsAppClientPortalTemplate(config)
        whatsappOnboardingTemplateComponents(template, links.portal.url)
        return { ready: true as const, reason: null, choice }
    } catch {
        return { ready: false as const, reason: "The approved client portal WhatsApp template is unavailable. Check Settings → Connections." }
    }
}

export async function generateRelationshipPortalLink(slug: string, relationshipId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const before = await loadRelationshipLinks(workspace, relationshipId)
    if (before.portal) return { ok: true as const, links: before }
    if (!before.canGeneratePortal) return { ok: false as const, error: "A service must be past onboarding before a portal link can be generated." }
    const existing = await supabaseAdmin.from("client_portal_sessions").select("id,status").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).maybeSingle()
    if (existing.error) return { ok: false as const, error: "The existing portal session could not be checked." }
    const token = randomBytes(32).toString("hex")
    const { error } = existing.data
        ? await supabaseAdmin.from("client_portal_sessions").update({ session_token: token, status: "active", token_revoked_at: null }).eq("workspace_id", workspace.id).eq("id", existing.data.id).eq("status", "revoked")
        : await supabaseAdmin.from("client_portal_sessions").insert({ workspace_id: workspace.id, relationship_id: relationshipId, session_token: token, status: "active" })
    // Concurrent clicks may race the unique relationship key. Read the winner.
    const after = await loadRelationshipLinks(workspace, relationshipId)
    if (!after.portal) return { ok: false as const, error: error?.message ?? "The portal link could not be generated." }
    return { ok: true as const, links: after }
}

export async function checkRelationshipPortalWhatsAppReadiness(slug: string, relationshipId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const readiness = await portalWhatsAppReadiness(workspace, relationshipId)
    return readiness.ready
        ? { ready: true as const, reason: null }
        : readiness
}

export async function sendRelationshipPortalLinkOnWhatsApp(slug: string, relationshipId: string, requestId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return { ok: false as const, error: "Try sending again." }
    const links = await loadRelationshipLinks(workspace, relationshipId)
    if (!links.portal) return { ok: false as const, error: "Generate an active portal link after onboarding first." }
    const readiness = await portalWhatsAppReadiness(workspace, relationshipId, links)
    if (!readiness.ready) return { ok: false as const, error: readiness.reason }
    const relationship = await supabaseAdmin.from("relationships").select("client_id,primary_phone,status").eq("workspace_id", workspace.id).eq("id", relationshipId).maybeSingle()
    if (relationship.error || !relationship.data || relationship.data.status === "archived") return { ok: false as const, error: "This relationship is unavailable." }
    const { data, error } = await supabaseAdmin.from("onboarding_delivery_outbox").upsert({
        workspace_id: workspace.id, relationship_id: relationshipId, portal_session_id: links.portal.id,
        correlation_id: requestId, kind: "client_portal_link", destination: relationship.data.primary_phone || `relationship:${relationshipId}`,
        payload: { client_id: relationship.data.client_id, message: "Your client portal is ready.", delivery_choices: [{ provider: "meta_whatsapp", address: readiness.choice.address }] },
        idempotency_key: `manual-client-portal-link:${requestId}`,
    }, { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true }).select("id,status").maybeSingle()
    if (error) return { ok: false as const, error: "The portal link could not be queued." }
    // Give the explicit action one immediate provider attempt without making
    // the button wait behind a workspace backlog. The durable queue and the
    // post-response worker own any remaining work and retries.
    await processWorkspaceOnboardingOutbox(workspace.id, 1)
    const delivery = data?.id
        ? await supabaseAdmin.from("onboarding_delivery_outbox").select("status").eq("workspace_id", workspace.id).eq("id", data.id).maybeSingle()
        : await supabaseAdmin.from("onboarding_delivery_outbox").select("status").eq("workspace_id", workspace.id).eq("idempotency_key", `manual-client-portal-link:${requestId}`).maybeSingle()
    if (delivery.error || !delivery.data) return { ok: true as const, status: data?.status ?? "queued" }
    if (delivery.data.status === "failed") return { ok: false as const, error: "WhatsApp did not accept the portal link. Check Communications before retrying." }
    if (delivery.data.status !== "sent") {
        after(async () => {
            await processWorkspaceOnboardingOutbox(workspace.id, 25)
        })
    }
    return { ok: true as const, status: delivery.data.status }
}
