import { Suspense } from "react"
import type { RelationshipRecord } from "@/lib/relationships"
import { loadAppointmentSettingServiceIds, requireRelationshipAccess, type WorkspaceAccess } from "@/lib/workspace-access"
import { loadWorkspaceMemberProfiles } from "@/lib/teams/server"
import { readRelationshipServices } from "@/lib/relationship-services-server"
import { relationshipContextShortcuts } from "@/lib/relationship-context"
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
        const [serviceResult, people, appointmentServices] = await Promise.all([
            readRelationshipServices(access.workspaceId, relationship.id, access.userId),
            loadWorkspaceMemberProfiles(access.workspaceId),
            loadAppointmentSettingServiceIds(access.workspaceId),
        ])
        const services = serviceResult.items
        context.servicesHasMore = serviceResult.hasMore
        const person = (id: string | null) => {
            const member = people.find((candidate) => candidate.id === id)
            return member ? { id: member.id, name: member.name, avatarSrc: member.avatarSrc } : id ? { id, name: "Assigned member unavailable", avatarSrc: null } : null
        }
        context.manager = person(relationship.fulfilment_manager_user_id)
        context.services = services.map((service) => ({
            id: service.id,
            name: service.name, stage: service.stage,
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
