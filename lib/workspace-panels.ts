import type { WorkspaceRole } from "@/lib/workspace-roles"
import type { WorkspaceCapability } from "@/lib/workspace-capabilities"

export type WorkspacePanelDefinition = {
    key: string
    label: string
    route: string
    activeRoutes?: readonly string[]
    capability: WorkspaceCapability
    minimumRole?: "admin"
    allMembers?: boolean
    requiresService?: boolean
    description: string
    keywords: readonly string[]
    standalone?: boolean
}

// Retain the historical identity and authorization while removing discovery.
const LEADGEN_PANEL = { key: "leadgen", label: "Lead Gen", route: "leadgen", capability: "leadgen.manage", minimumRole: "admin", description: "Lead generation dashboard", keywords: ["leads", "lead generation"] } as const satisfies WorkspacePanelDefinition

export const WORKSPACE_PANELS = [
    { key: "queue", label: "Work Queue", route: "queue", capability: "fulfilment.manage", allMembers: true, description: "Your next ready work across clients and services", keywords: ["home", "my work", "priority", "tasks"] },
    { key: "relationships", label: "Relationships", route: "relationships", capability: "relationships.view", description: "Relationship Hub list", keywords: ["dashboard", "crm", "people", "accounts"] },
    { key: "onboarding", label: "Onboarding", route: "onboarding", capability: "onboarding.manage", description: "Relationship onboarding status and submissions", keywords: ["forms", "submissions", "portal"] },
    { key: "client-connections", label: "Client Connections", route: "client-connections", capability: "client_connections.manage", requiresService: true, description: "Connect client accounts to agency services", keywords: ["connections", "integrations", "GHL", "HighLevel", "client accounts"] },
    { key: "communications", label: "Communications", route: "communications", capability: "communications.manage", allMembers: true, description: "Relationship communication summaries", keywords: ["messages", "chat", "whatsapp", "communication"] },
    { key: "library", label: "Library", route: "work-items", activeRoutes: ["work-items", "sops", "assets", "notes"], capability: "library.manage", allMembers: true, description: "Workspace procedures, work items, assets and notes", keywords: ["tasks", "files", "uploads", "gallery", "sop", "procedures", "call notes", "context"] },
    { key: "onboarding-builder", label: "Onboarding Builder", route: "onboarding-builder", capability: "onboarding_builder.manage", minimumRole: "admin", standalone: true, description: "Build workspace onboarding modules and session structure", keywords: ["onboarding modules", "session builder", "forms builder", "form fields", "welcome", "completion", "visual builder"] },
    { key: "admin", label: "Admin", route: "admin", capability: "admin.manage", minimumRole: "admin", description: "Private OKRs, activity, maintenance, and automation-failure follow-up", keywords: ["admin tools", "okr", "objectives", "key results", "metrics", "activity console", "automation history", "maintenance", "automation failures", "admin work items", "goals"] },
    { key: "settings", label: "Settings", route: "settings", capability: "settings.manage", minimumRole: "admin", description: "Unified workspace settings", keywords: ["workspace settings", "services", "agency branding", "onboarding colours"] },
] as const satisfies readonly WorkspacePanelDefinition[]
// Retain authorization and saved URLs alongside the personal queue.
// This legacy destination is deliberately absent from navigation and search.
const LEGACY_FULFILMENT_PANEL = { key: "fulfilment", label: "Fulfilment", route: "work", capability: "fulfilment.manage", allMembers: true, description: "Fulfilment relationship work items", keywords: ["tasks", "project management", "queue", "fulfilment"] } as const satisfies WorkspacePanelDefinition
const LEGACY_APPOINTMENT_PANEL = { key: "appointment-setting", label: "Appointment Setting", route: "appointment-setting", capability: "appointment_setting.manage", requiresService: true, description: "Legacy appointment table", keywords: [] } as const satisfies WorkspacePanelDefinition
export type WorkspacePanel = (typeof WORKSPACE_PANELS)[number] | typeof LEGACY_FULFILMENT_PANEL | typeof LEGACY_APPOINTMENT_PANEL | typeof LEADGEN_PANEL
export type WorkspacePanelKey = WorkspacePanel["key"]

export function canAccessPrivateWorkspacePanels(role: WorkspaceRole) {
    return role === "owner" || role === "admin"
}

export function canAccessWorkspacePanel(
    panel: Pick<WorkspacePanelDefinition, "capability" | "minimumRole" | "requiresService" | "allMembers">,
    role: WorkspaceRole,
    capabilities: ReadonlySet<WorkspaceCapability> | readonly WorkspaceCapability[] = []
) {
    const capabilitySet = new Set(capabilities)
    if (panel.allMembers) return true
    if (panel.requiresService && !capabilitySet.has(panel.capability)) return false
    if (canAccessPrivateWorkspacePanels(role)) return true
    if (panel.minimumRole === "admin") return false
    return capabilitySet.has(panel.capability)
}

export function workspacePanelByKey(key: WorkspacePanelKey) {
    return key === "leadgen" ? LEADGEN_PANEL : key === "fulfilment" ? LEGACY_FULFILMENT_PANEL : key === "appointment-setting" ? LEGACY_APPOINTMENT_PANEL : WORKSPACE_PANELS.find((panel) => panel.key === key)!
}

export function workspacePanelForUrl(value: string, workspaceSlug: string) {
    const pathname = new URL(value, "http://localhost").pathname
    const prefix = `/${workspaceSlug}/`
    if (!pathname.startsWith(prefix)) return null
    const route = pathname.slice(prefix.length).split("/")[0]
    if (route === LEADGEN_PANEL.route) return LEADGEN_PANEL
    if (route === LEGACY_FULFILMENT_PANEL.route) return LEGACY_FULFILMENT_PANEL
    if (route === LEGACY_APPOINTMENT_PANEL.route) return LEGACY_APPOINTMENT_PANEL
    return WORKSPACE_PANELS.find((panel) => panel.route === route || ("activeRoutes" in panel && (panel.activeRoutes as readonly string[]).includes(route))) ?? null
}

export function canAccessWorkspaceUrl(
    value: string,
    workspaceSlug: string,
    role: WorkspaceRole,
    capabilities: ReadonlySet<WorkspaceCapability> | readonly WorkspaceCapability[] = []
) {
    if (canAccessPrivateWorkspacePanels(role)) return true
    const pathname = new URL(value, "http://localhost").pathname.replace(/\/$/, "")
    const root = `/${workspaceSlug}`
    if (pathname === root || pathname === `${root}/no-access`) return true
    const suffix = pathname.startsWith(`${root}/`) ? pathname.slice(root.length + 1) : ""
    if (/^work-items\/[^/]+$/.test(suffix) || /^assets\/[^/]+$/.test(suffix) || /^notes\/[^/]+$/.test(suffix)) {
        const set = new Set(capabilities)
        return set.has("onboarding.manage") || set.has("fulfilment.manage")
    }
    if (suffix === "assets" || suffix === "notes") return false
    const panel = workspacePanelForUrl(value, workspaceSlug)
    return panel ? canAccessWorkspacePanel(panel, role, capabilities) : false
}

export function workspacePanelHref(workspaceSlug: string, panel: Pick<WorkspacePanel, "route">) {
    return `/${workspaceSlug}/${panel.route}`
}
