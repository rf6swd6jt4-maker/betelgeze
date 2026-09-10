import { Suspense } from "react"
import type { RelationshipRecord } from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { fullyAccessibleRelationshipIds, loadAppointmentSettingServiceIds, requireRelationshipAccess, type WorkspaceAccess } from "@/lib/workspace-access"
import { loadWorkspaceMemberProfiles } from "@/lib/teams/server"
import { loadOnboardingServiceRevisionDisplays } from "@/lib/onboarding/service-revisions"
import { relationshipServiceDisplayName } from "@/lib/onboarding/service-display"
import { relationshipContextCanShowService, relationshipContextShortcuts } from "@/lib/relationship-context"
import type { WorkspaceTabRelationshipContext } from "@/lib/workspace-tabs"
import { RelationshipContextBridge } from "./RelationshipContextBridge"

type Props = {
    workspaceSlug: string
    relationship: RelationshipRecord | null
    access: WorkspaceAccess
    metrics?: WorkspaceTabRelationshipContext["metrics"]
}

export async function loadRelationshipContext({ relationship, access, metrics = [] }: Props) {
    if (!relationship || relationship.workspace_id !== access.workspaceId) return null
    await requireRelationshipAccess(access, relationship.id)
    // Send only the staff reference fields across the frame boundary.
    const context: WorkspaceTabRelationshipContext = {
        id: relationship.id, primary_person_name: relationship.primary_person_name,
        primary_email: relationship.primary_email, primary_phone: relationship.primary_phone,
        business_name: relationship.business_name, website_url: relationship.website_url,
        industry_value: relationship.industry_value, location_value: relationship.location_value,
        source_label: relationship.source_label, primary_contact_role: relationship.primary_contact_role,
        notes_summary: relationship.notes_summary, lifecycle_phase: relationship.lifecycle_phase, metrics,
        allowedDestinations: relationshipContextShortcuts(access.capabilities, false),
    }
    try {
        const [serviceResult, people, fullIds, appointmentServices] = await Promise.all([
            supabaseAdmin.from("relationship_services").select("service_key, service_id, service_revision_id, assignee_user_id")
                .eq("workspace_id", access.workspaceId).eq("relationship_id", relationship.id).order("created_at"),
            loadWorkspaceMemberProfiles(access.workspaceId),
            fullyAccessibleRelationshipIds(access),
            loadAppointmentSettingServiceIds(access.workspaceId),
        ])
        if (serviceResult.error) throw new Error("Could not load relationship services")
        const services = (serviceResult.data ?? []).filter((service) => relationshipContextCanShowService(service, {
            fullRelationship: !fullIds || fullIds.has(relationship.id), allowedServiceIds: access.allowedServiceIds, userId: access.userId,
        }))
        const revisions = await loadOnboardingServiceRevisionDisplays(access.workspaceId, services.map((service) => service.service_revision_id))
        const person = (id: string | null) => {
            const member = people.find((candidate) => candidate.id === id)
            return member ? { id: member.id, name: member.name, avatarSrc: member.avatarSrc } : id ? { id, name: "Assigned member unavailable", avatarSrc: null } : null
        }
        context.manager = person(relationship.fulfilment_manager_user_id)
        context.services = services.map((service) => ({
            id: service.service_id ?? service.service_key,
            name: relationshipServiceDisplayName(service, revisions),
            assignee: person(service.assignee_user_id),
        }))
        const appointmentSettingAvailable = relationship.lifecycle_phase === "retention" && relationship.status !== "archived"
            && services.some((service) => appointmentServices.ids.has(service.service_id)
                && (access.role !== "staff" || access.allowedServiceIds.includes(service.service_id)))
        context.allowedDestinations = relationshipContextShortcuts(access.capabilities, appointmentSettingAvailable)
    } catch {
        context.teamUnavailable = true
    }
    return context
}

async function LoadedContext(props: Props) {
    const context = await loadRelationshipContext(props)
    return context ? <RelationshipContextBridge workspaceSlug={props.workspaceSlug} contextPayload={context} workspaceCapabilities={props.access.capabilities} /> : null
}

export function ClientContextPanel(props: Props) {
    return <Suspense fallback={<aside className="hidden w-80 shrink-0 lg:block" aria-label="Loading relationship context" />}>
        <LoadedContext {...props} />
    </Suspense>
}
