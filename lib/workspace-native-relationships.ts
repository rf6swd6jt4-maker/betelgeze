import "server-only"

import { readRelationshipServices, summarizeRelationshipServices, relationshipBackgroundDraft } from "@/lib/relationship-services-server"
import { workspacePerformanceEnabled } from "@/lib/workspace-native"
import { notFound } from "next/navigation"
import { loadRelationshipContext } from "@/components/workspace/ClientContextPanel"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { countOpenWorkItemsByRelationship, getRelationship, listRelationshipsForWorkspace, relationshipLocationLabel } from "@/lib/relationships"
import { accessibleRelationshipIds, requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function loadNativeRelationships(workspaceSlug: string, relationshipId?: string, authorized?: Awaited<ReturnType<typeof requireWorkspacePanel>>) {
    const { workspace, user, role, access } = authorized ?? await requireWorkspacePanel(workspaceSlug, "relationships")
    const identity = { userId: user.id, workspaceId: workspace.id, workspaceSlug: workspace.slug }
    if (relationshipId) {
        await requireRelationshipAccess(access, relationshipId)
        const relationship = await getRelationship(workspace.id, relationshipId)
        if (!relationship) notFound()
        const [services, context, seller, full] = await Promise.all([
            readRelationshipServices(workspace.id, relationshipId, user.id),
            loadRelationshipContext({ workspaceSlug, relationship, access }),
            supabaseAdmin.rpc("workspace_user_can_sell", { p_workspace_id: workspace.id, p_user_id: user.id }),
            supabaseAdmin.rpc("workspace_user_fully_covers_relationship", { p_workspace_id: workspace.id, p_relationship_id: relationshipId, p_user_id: user.id }),
        ])
        if (seller.error || full.error) throw new Error("Could not verify relationship permissions")
        const admin = role === "owner" || role === "admin"
        return {
            ...identity, kind: "relationship-detail" as const, context, services,
            background: relationshipBackgroundDraft(relationship),
            backgroundCommandsEnabled: workspacePerformanceEnabled(workspace.id, user.id, process.env.WORKSPACE_RELATIONSHIP_DRAFT_COMMANDS, process.env.WORKSPACE_PERFORMANCE_USERS),
            canEdit: admin || relationship.seller_user_id === user.id || relationship.fulfilment_manager_user_id === user.id || (!relationship.pos_started_at && seller.data === true),
            canAdd: relationship.status !== "archived" && (admin || seller.data === true), canImport: admin, canSeeHistory: full.data === true,
            legacy: relationship.source_metadata.service_instances !== true,
            record: { id: relationship.id, name: relationship.primary_person_name, businessName: relationship.business_name, phase: relationship.lifecycle_phase, updatedAt: relationship.updated_at, isTest: relationship.source_metadata.is_test === true },
            canArchive: admin,
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
        summarizeRelationshipServices(workspace.id, user.id, relationshipIds),
    ])
    if (clients.error || channels.error) throw new Error("Could not load relationship references")
    const clientById = new Map((clients.data ?? []).map((client) => [client.id, client]))
    const channelById = new Map((channels.data ?? []).map((channel) => [channel.client_id, channel.external_address]))
    const creatorId = (row: typeof rows[number]) => {
        const id = row.source_metadata.created_by ?? row.source_metadata.promoted_by ?? (row.client_id ? clientById.get(row.client_id)?.created_by : null)
        return typeof id === "string" ? id : null
    }
    const creatorIds = [...new Set(rows.flatMap((row) => creatorId(row) ? [creatorId(row)!] : []))]
    // The Clients table names each client's manager. Their profiles ride on the creators' lookup: one query, as before.
    const profileIds = [...new Set([...creatorIds, ...rows.flatMap((row) => row.fulfilment_manager_user_id ? [row.fulfilment_manager_user_id] : [])])]
    const profiles = profileIds.length ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", profileIds) : { data: [], error: null }
    if (profiles.error) throw new Error("Could not load relationship creators")
    const profileById = new Map((profiles.data ?? []).map((profile) => [profile.user_id, profile]))
    const servicesByRelationship = new Map(services.map(row => [row.relationship_id, row]))
    return { ...identity, kind: "relationships" as const, context: null, rows: rows.map((row) => {
        const creator = profileById.get(creatorId(row) ?? "")
        const phone = row.primary_phone
        const displayPhone = (value: string | null | undefined) => value?.replace(/^(?:sms|whatsapp):/i, "") ?? null
        const sms = phone?.toLowerCase().startsWith("whatsapp:") ? null : displayPhone(phone)
        const whatsapp = displayPhone(row.client_id ? channelById.get(row.client_id) : null) ?? (phone?.toLowerCase().startsWith("whatsapp:") ? displayPhone(phone) : null)
        const summary = servicesByRelationship.get(row.id)
        const manager = row.fulfilment_manager_user_id ? profileById.get(row.fulfilment_manager_user_id) : null
        return {
            id: row.id, name: row.primary_person_name, businessName: row.business_name, phase: row.lifecycle_phase, email: row.primary_email, sms, whatsapp,
            contactRole: row.primary_contact_role, location: relationshipLocationLabel(row), updatedAt: row.updated_at, createdAt: row.created_at,
            isTest: Boolean(row.source_metadata.is_test || (row.client_id && clientById.get(row.client_id)?.is_test)), openWork: counts.get(row.id) ?? 0,
            services: summary?.services ?? [], serviceStages: summary?.stages ?? [], serviceCount: summary?.count ?? 0,
            creator: creator ? { username: creator.username, avatar: creator.avatar_path ? profileAvatarUrl(creator.username, creator.avatar_path) : null } : null,
            managed: Boolean(row.fulfilment_manager_user_id),
            manager: manager ? { username: manager.username, avatar: manager.avatar_path ? profileAvatarUrl(manager.username, manager.avatar_path) : null } : null,
        }
    }) }
}

export type NativeRelationshipsSnapshot = Awaited<ReturnType<typeof loadNativeRelationships>>
