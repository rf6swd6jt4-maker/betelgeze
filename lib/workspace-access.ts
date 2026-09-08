import "server-only"

import { cache } from "react"
import { notFound } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { combineWorkspaceCapabilities, WORKSPACE_CAPABILITIES, type WorkspaceCapability } from "@/lib/workspace-capabilities"
import { canAccessWorkspacePanel, workspacePanelByKey, workspacePanelHref, WORKSPACE_PANELS, type WorkspacePanelKey } from "@/lib/workspace-panels"
import type { WorkspaceRole } from "@/lib/workspace-roles"
import { requireWorkspace } from "@/lib/workspaces"

export type WorkspaceAccess = {
    workspaceId: string
    workspaceSlug: string
    userId: string
    role: WorkspaceRole
    capabilities: WorkspaceCapability[]
    allowedServiceIds: string[]
    serviceAccessSchemaReady: boolean
}

function isAdminRole(role: WorkspaceRole) {
    return role === "owner" || role === "admin"
}

const APPOINTMENT_SETTING_CAPABILITY = "appointment_setting.manage" satisfies WorkspaceCapability
const APPOINTMENT_SETTING_TEMPLATE_ID = "appointment-setting"

function serviceTemplateId(definition: unknown) {
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) return null
    const value = (definition as Record<string, unknown>).templateId ?? (definition as Record<string, unknown>).template_id
    return typeof value === "string" ? value : null
}

export const loadAppointmentSettingServiceIds = cache(async (workspaceId: string) => {
    const { data: services, error: serviceError } = await supabaseAdmin
        .from("onboarding_services")
        .select("id")
        .eq("workspace_id", workspaceId)
        .neq("state", "archived")
    if (serviceError) {
        console.error("Appointment Setting service activation could not be loaded", { workspaceId, code: serviceError.code })
        return { ids: new Set<string>(), ready: false }
    }
    const serviceIds = (services ?? []).map((service) => service.id).filter(Boolean)
    if (!serviceIds.length) return { ids: new Set<string>(), ready: true }
    // Keep the large JSON definitions scoped to active services. Fetching every
    // historical service revision in parallel removes a round trip but can cost
    // substantially more transfer and parsing time in established workspaces.
    const { data: revisions, error: revisionError } = await supabaseAdmin
        .from("onboarding_service_revisions")
        .select("service_id, definition")
        .eq("workspace_id", workspaceId)
        .in("service_id", serviceIds)
    if (revisionError) {
        console.error("Appointment Setting service revisions could not be loaded", { workspaceId, code: revisionError.code })
        return { ids: new Set<string>(), ready: false }
    }
    return {
        ids: new Set((revisions ?? [])
            .filter((revision) => serviceTemplateId(revision.definition) === APPOINTMENT_SETTING_TEMPLATE_ID)
            .map((revision) => revision.service_id)
            .filter(Boolean)),
        ready: true,
    }
})

export async function loadWorkspaceAccess(input: {
    workspaceId: string
    workspaceSlug: string
    userId: string
    role: WorkspaceRole
}): Promise<WorkspaceAccess> {
    const appointmentSettingServices = await loadAppointmentSettingServiceIds(input.workspaceId)
    if (isAdminRole(input.role)) {
        return {
            ...input,
            capabilities: WORKSPACE_CAPABILITIES.filter((capability) => (
                capability !== APPOINTMENT_SETTING_CAPABILITY || appointmentSettingServices.ids.size > 0
            )),
            allowedServiceIds: [],
            serviceAccessSchemaReady: appointmentSettingServices.ready,
        }
    }

    const [assignmentResult, capabilityResult, rolesResult, permissionsResult, allocatedServices, responsibilities] = await Promise.all([
        supabaseAdmin
            .from("workspace_member_service_access")
            .select("service_id")
            .eq("workspace_id", input.workspaceId)
            .eq("user_id", input.userId),
        supabaseAdmin
            .from("workspace_service_capabilities")
            .select("service_id, capability")
            .eq("workspace_id", input.workspaceId),
        supabaseAdmin.from("workspace_operational_roles").select("can_sell, can_manage").eq("workspace_id", input.workspaceId).eq("user_id", input.userId).maybeSingle(),
        supabaseAdmin.from("workspace_operational_permissions").select("position, capability").eq("workspace_id", input.workspaceId),
        supabaseAdmin.from("relationship_services").select("service_id").eq("workspace_id", input.workspaceId).eq("assignee_user_id", input.userId),
        supabaseAdmin.from("relationships").select("seller_user_id, fulfilment_manager_user_id").eq("workspace_id", input.workspaceId).or(`seller_user_id.eq.${input.userId},fulfilment_manager_user_id.eq.${input.userId}`),
    ])
    const { data: assignments, error: assignmentError } = assignmentResult

    if (assignmentError || rolesResult.error || permissionsResult.error || allocatedServices.error || responsibilities.error) {
        console.error("Workspace service access could not be loaded", {
            workspaceId: input.workspaceId,
            userId: input.userId,
            code: assignmentError?.code,
        })
        return { ...input, capabilities: [], allowedServiceIds: [], serviceAccessSchemaReady: false }
    }

    const allowedServiceIds = [...new Set([...(assignments ?? []), ...(allocatedServices.data ?? [])].map((item) => item.service_id).filter(Boolean))]
    const { data: allGrants, error: capabilityError } = capabilityResult

    if (capabilityError) {
        console.error("Workspace service capabilities could not be loaded", {
            workspaceId: input.workspaceId,
            userId: input.userId,
            code: capabilityError.code,
        })
        return { ...input, capabilities: [], allowedServiceIds, serviceAccessSchemaReady: false }
    }

    const allowedServiceIdSet = new Set(allowedServiceIds)
    const assignedAppointmentSettingService = allowedServiceIds.some((serviceId) => appointmentSettingServices.ids.has(serviceId))
    const operational = (permissionsResult.data ?? []).filter((p) => p.position === "seller" ? rolesResult.data?.can_sell || responsibilities.data?.some((r) => r.seller_user_id === input.userId) : rolesResult.data?.can_manage || responsibilities.data?.some((r) => r.fulfilment_manager_user_id === input.userId)).map((p) => p.capability)
    const capabilities = combineWorkspaceCapabilities([["communications.manage", ...operational], ...(allGrants ?? []).filter((grant) => allowedServiceIdSet.has(grant.service_id)).map((item) => [item.capability])]).filter((capability) => (
        capability !== APPOINTMENT_SETTING_CAPABILITY || assignedAppointmentSettingService
    ))

    return { ...input, capabilities, allowedServiceIds, serviceAccessSchemaReady: appointmentSettingServices.ready }
}

export async function requireWorkspaceAccess(slug: string) {
    const membership = await requireWorkspace(slug)
    const access = await loadWorkspaceAccess({
        workspaceId: membership.workspace.id,
        workspaceSlug: membership.workspace.slug,
        userId: membership.user.id,
        role: membership.role,
    })
    return { ...membership, access }
}

export function workspaceAccessHasCapability(access: WorkspaceAccess, capability: WorkspaceCapability) {
    if (capability === APPOINTMENT_SETTING_CAPABILITY) return access.capabilities.includes(capability)
    return isAdminRole(access.role) || access.capabilities.includes(capability)
}

export async function requireWorkspaceCapability(slug: string, capability: WorkspaceCapability) {
    const context = await requireWorkspaceAccess(slug)
    if (!workspaceAccessHasCapability(context.access, capability)) notFound()
    return context
}

export async function requireWorkspacePanel(slug: string, panelKey: WorkspacePanelKey) {
    const context = await requireWorkspaceAccess(slug)
    const panel = workspacePanelByKey(panelKey)
    if (!canAccessWorkspacePanel(panel, context.role, context.access.capabilities)) notFound()
    return context
}

export function defaultWorkspaceHref(access: WorkspaceAccess) {
    const panel = WORKSPACE_PANELS.find((candidate) => canAccessWorkspacePanel(candidate, access.role, access.capabilities))
    return panel ? workspacePanelHref(access.workspaceSlug, panel) : `/${access.workspaceSlug}/no-access`
}

const loadDeliveryScope = cache(async (workspaceId: string, userId: string) => {
    const { data, error } = await supabaseAdmin.rpc("workspace_delivery_access_scope", { p_workspace_id: workspaceId, p_user_id: userId })
    if (error) throw new Error("Could not verify client delivery access.")
    return data as { relationships: string[]; full_relationships: string[]; work_items: string[] }
})
const loadRelationshipScope = cache(async (access: WorkspaceAccess) => {
    const scope = await loadDeliveryScope(access.workspaceId, access.userId)
    return { accessibleIds: new Set(scope.relationships), fullyAccessibleIds: new Set(scope.full_relationships) }
})

export async function accessibleRelationshipIds(access: WorkspaceAccess): Promise<Set<string> | null> {
    if (isAdminRole(access.role)) return null
    return (await loadRelationshipScope(access)).accessibleIds
}

export async function fullyAccessibleRelationshipIds(access: WorkspaceAccess): Promise<Set<string> | null> {
    if (isAdminRole(access.role)) return null
    return (await loadRelationshipScope(access)).fullyAccessibleIds
}

export async function workspaceAccessCanRelationship(access: WorkspaceAccess, relationshipId: string) {
    if (isAdminRole(access.role)) return true
    const ids = await accessibleRelationshipIds(access)
    return Boolean(ids?.has(relationshipId))
}

export async function requireRelationshipAccess(access: WorkspaceAccess, relationshipId: string) {
    if (!await workspaceAccessCanRelationship(access, relationshipId)) notFound()
}

export async function accessibleWorkItemIds(access: WorkspaceAccess, relationshipIds?: Set<string> | null): Promise<Set<string> | null> {
    if (isAdminRole(access.role)) return null
    const scope = await loadDeliveryScope(access.workspaceId, access.userId)
    void relationshipIds
    return new Set(scope.work_items)
}

export async function requireWorkItemAccess(access: WorkspaceAccess, workItemId: string) {
    if (!await workspaceAccessCanWorkItem(access, workItemId)) notFound()
}

export async function workspaceAccessCanWorkItem(access: WorkspaceAccess, workItemId: string) {
    const ids = await accessibleWorkItemIds(access)
    return !ids || ids.has(workItemId)
}

export async function accessibleAssetIds(access: WorkspaceAccess, relationshipIds?: Set<string> | null, workItemIds?: Set<string> | null): Promise<Set<string> | null> {
    if (isAdminRole(access.role)) return null
    const relationshipScope = await loadRelationshipScope(access)
    const scopedRelationshipIds = relationshipIds === undefined
        ? relationshipScope.accessibleIds
        : new Set([...relationshipScope.accessibleIds].filter((id) => relationshipIds?.has(id)))
    const fullyScopedRelationshipIds = new Set([...relationshipScope.fullyAccessibleIds].filter((id) => scopedRelationshipIds.has(id)))
    const scopedWorkItemIds = workItemIds === undefined ? await accessibleWorkItemIds(access, scopedRelationshipIds) : workItemIds
    const relationshipIdList = [...fullyScopedRelationshipIds]
    const workItemIdList = [...(scopedWorkItemIds ?? [])]
    const [relationshipLinks, workItemLinks] = await Promise.all([
        relationshipIdList.length
            ? supabaseAdmin.from("asset_relationships").select("asset_id").eq("workspace_id", access.workspaceId).in("relationship_id", relationshipIdList)
            : Promise.resolve({ data: [] as Array<{ asset_id: string }>, error: null }),
        workItemIdList.length
            ? supabaseAdmin.from("asset_work_items").select("asset_id").eq("workspace_id", access.workspaceId).in("work_item_id", workItemIdList)
            : Promise.resolve({ data: [] as Array<{ asset_id: string }>, error: null }),
    ])
    if (relationshipLinks.error || workItemLinks.error) return new Set()
    return new Set([
        ...(relationshipLinks.data ?? []).map((item) => item.asset_id),
        ...(workItemLinks.data ?? []).map((item) => item.asset_id),
    ])
}

export async function requireAssetAccess(access: WorkspaceAccess, assetId: string) {
    if (!await workspaceAccessCanAsset(access, assetId)) notFound()
}

export async function workspaceAccessCanAsset(access: WorkspaceAccess, assetId: string) {
    const ids = await accessibleAssetIds(access)
    return !ids || ids.has(assetId)
}
