// Rolling-release reader for browser tabs running the previous client bundle.
import "server-only"

import { notFound } from "next/navigation"
import { loadRelationshipContext } from "@/components/workspace/ClientContextPanel"
import { loadNativeRelationshipDeal } from "@/lib/workspace-native-relationship-detail"
import { loadOnboardingServiceRevisionDisplays } from "@/lib/onboarding/service-revisions"
import { relationshipServiceDisplayName } from "@/lib/onboarding/service-display"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { countOpenWorkItemsByRelationship, getRelationship, listRelationshipsForWorkspace, relationshipLocationLabel } from "@/lib/relationships"
import { effectiveGanttRanges, getRelationshipGanttPlan } from "@/lib/relationship-gantt"
import { accessibleRelationshipIds, requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function loadLegacyNativeRelationships(workspaceSlug: string, relationshipId?: string) {
    const { workspace, user, role, access } = await requireWorkspacePanel(workspaceSlug, "relationships")
    const identity = { userId: user.id, workspaceId: workspace.id, workspaceSlug: workspace.slug }
    if (relationshipId) {
        await requireRelationshipAccess(access, relationshipId)
        const relationship = await getRelationship(workspace.id, relationshipId)
        if (!relationship) notFound()
        const [deal, plan, context] = await Promise.all([
            loadNativeRelationshipDeal({ workspaceId: workspace.id, workspaceSlug, workspaceName: workspace.name, userId: user.id, role, relationship }),
            getRelationshipGanttPlan(workspaceSlug, relationship),
            loadRelationshipContext({ workspaceSlug, relationship, access }),
        ])
        const ranges = effectiveGanttRanges(plan.items)
        return {
            ...identity, kind: "relationship-detail" as const, context, deal, plan,
            record: { id: relationship.id, name: relationship.primary_person_name, businessName: relationship.business_name, phase: relationship.lifecycle_phase, updatedAt: relationship.updated_at, isTest: relationship.source_metadata.is_test === true },
            facts: { open: plan.items.filter((item) => !["done", "canceled"].includes(item.status)).length, unscheduled: plan.items.filter((item) => !ranges.has(item.id)).length },
            canArchive: role === "owner" || role === "admin",
            setup: relationship.lifecycle_phase === "retention" && ["creator_dm", "messaging_confirmation"].includes(String(relationship.source_metadata.portal_handoff)) ? {
                manualHandoff: relationship.source_metadata.portal_handoff === "creator_dm", pending: relationship.source_metadata.external_messaging_pending === true,
                canRequest: role === "owner" || role === "admin" || relationship.seller_user_id === user.id, provider: relationship.communication_primary_provider,
            } : null,
        }
    }
    const allowed = await accessibleRelationshipIds(access)
    const [all, counts] = await Promise.all([listRelationshipsForWorkspace(workspace.id), countOpenWorkItemsByRelationship(workspace.id)])
    const rows = all.filter((row) => row.status !== "archived" && (allowed === null || allowed.has(row.id)))
    const clientIds = [...new Set(rows.flatMap((row) => row.client_id ? [row.client_id] : []))]
    const relationshipIds = rows.filter((row) => !row.fallback).map((row) => row.id)
    const [clients, channels, services] = await Promise.all([
        clientIds.length ? supabaseAdmin.from("clients").select("id, created_by, is_test").eq("workspace_id", workspace.id).in("id", clientIds) : { data: [], error: null },
        clientIds.length ? supabaseAdmin.from("client_communication_channels").select("client_id, external_address").eq("workspace_id", workspace.id).in("client_id", clientIds).eq("provider", "meta_whatsapp").eq("is_active", true) : { data: [], error: null },
        relationshipIds.length ? supabaseAdmin.from("relationship_services").select("relationship_id, service_key, service_revision_id").eq("workspace_id", workspace.id).in("relationship_id", relationshipIds).order("created_at") : { data: [], error: null },
    ])
    if (clients.error || channels.error || services.error) throw new Error("Could not load relationship references")
    const clientById = new Map((clients.data ?? []).map((client) => [client.id, client]))
    const channelById = new Map((channels.data ?? []).map((channel) => [channel.client_id, channel.external_address]))
    const creatorId = (row: typeof rows[number]) => {
        const id = row.source_metadata.created_by ?? row.source_metadata.promoted_by ?? (row.client_id ? clientById.get(row.client_id)?.created_by : null)
        return typeof id === "string" ? id : null
    }
    const creatorIds = [...new Set(rows.flatMap((row) => creatorId(row) ? [creatorId(row)!] : []))]
    const [profiles, revisions] = await Promise.all([
        creatorIds.length ? supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", creatorIds) : { data: [], error: null },
        loadOnboardingServiceRevisionDisplays(workspace.id, (services.data ?? []).map((service) => service.service_revision_id)),
    ])
    if (profiles.error) throw new Error("Could not load relationship creators")
    const profileById = new Map((profiles.data ?? []).map((profile) => [profile.user_id, profile]))
    const servicesByRelationship = new Map<string, Map<string, NonNullable<typeof services.data>[number]>>()
    for (const service of services.data ?? []) {
        const byKey = servicesByRelationship.get(service.relationship_id) ?? new Map()
        if (!byKey.has(service.service_key)) byKey.set(service.service_key, service)
        servicesByRelationship.set(service.relationship_id, byKey)
    }
    return { ...identity, kind: "relationships" as const, context: null, rows: rows.map((row) => {
        const creator = profileById.get(creatorId(row) ?? "")
        const phone = row.primary_phone
        const displayPhone = (value: string | null | undefined) => value?.replace(/^(?:sms|whatsapp):/i, "") ?? null
        const sms = phone?.toLowerCase().startsWith("whatsapp:") ? null : displayPhone(phone)
        const whatsapp = displayPhone(row.client_id ? channelById.get(row.client_id) : null) ?? (phone?.toLowerCase().startsWith("whatsapp:") ? displayPhone(phone) : null)
        const distinctServices = [...(servicesByRelationship.get(row.id)?.values() ?? [])]
        return {
            id: row.id, name: row.primary_person_name, businessName: row.business_name, phase: row.lifecycle_phase, email: row.primary_email, sms, whatsapp,
            contactRole: row.primary_contact_role, location: relationshipLocationLabel(row), updatedAt: row.updated_at, createdAt: row.created_at,
            isTest: Boolean(row.source_metadata.is_test || (row.client_id && clientById.get(row.client_id)?.is_test)), openWork: counts.get(row.id) ?? 0,
            services: distinctServices.map((service) => ({ key: `${service.service_key}:${service.service_revision_id ?? "legacy"}`, label: relationshipServiceDisplayName(service, revisions) })),
            creator: creator ? { username: creator.username, avatar: creator.avatar_path ? profileAvatarUrl(creator.username, creator.avatar_path) : null } : null,
        }
    }) }
}

export type LegacyNativeRelationshipsSnapshot = Awaited<ReturnType<typeof loadLegacyNativeRelationships>>
