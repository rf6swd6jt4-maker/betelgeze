import type { WorkspaceCapability } from "./workspace-capabilities"

export type RelationshipContextPerson = { id: string; name: string; avatarSrc: string | null }
export type RelationshipContextService = { id: string; name: string; assignee: RelationshipContextPerson | null }
export type RelationshipContextDestination = "relationships" | "onboarding" | "fulfilment" | "appointment-setting"

export const relationshipContextDestinations: Array<{ key: RelationshipContextDestination; path: string; label: string; capability: WorkspaceCapability }> = [
    { key: "relationships", path: "relationships", label: "Relationship summary", capability: "relationships.view" },
    { key: "onboarding", path: "onboarding", label: "Onboarding", capability: "onboarding.manage" },
    { key: "fulfilment", path: "work", label: "Fulfilment", capability: "fulfilment.manage" },
    { key: "appointment-setting", path: "appointment-setting", label: "Appointment Setting", capability: "appointment_setting.manage" },
]

export function relationshipContextShortcuts(capabilities: WorkspaceCapability[], appointmentSettingAvailable: boolean) {
    return relationshipContextDestinations.filter((destination) => capabilities.includes(destination.capability)
        && (destination.key !== "appointment-setting" || appointmentSettingAvailable)).map((destination) => destination.key)
}

export function relationshipContextCanShowService(service: { service_id: string | null; assignee_user_id: string | null }, access: { fullRelationship: boolean; allowedServiceIds: string[]; userId: string }) {
    return access.fullRelationship || Boolean(service.service_id && access.allowedServiceIds.includes(service.service_id))
        || service.assignee_user_id === access.userId
}

export function relationshipContactHref(kind: "Email" | "Phone" | "Website", value: string) {
    const clean = value.trim()
    if (!clean || /[\r\n]/.test(clean)) return null
    if (kind === "Email") return `mailto:${encodeURIComponent(clean)}`
    if (kind === "Phone") {
        const number = clean.replace(/[^+\d]/g, "")
        return /\d/.test(number) ? `tel:${number}` : null
    }
    try {
        const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(clean) ? clean : `https://${clean}`)
        return ["http:", "https:"].includes(url.protocol) && url.hostname ? url.href : null
    } catch { return null }
}
