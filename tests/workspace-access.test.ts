import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
    canAccessWorkspaceUrl,
    canAccessWorkspacePanel,
    WORKSPACE_PANELS,
} from "../lib/workspace-panels.ts"
import { combineWorkspaceCapabilities } from "../lib/workspace-capabilities.ts"
import {
    normalizeWorkspaceRole,
    WORKSPACE_ROLES,
    workspaceRoleLabel,
    workspaceRoleMeetsMinimum,
} from "../lib/workspace-roles.ts"

const searchRoute = readFileSync("app/api/workspaces/[workspaceSlug]/search/route.ts", "utf8")
const leadgenPanel = readFileSync("app/[workspaceSlug]/leadgen/page.tsx", "utf8")
const leadgenPollsPanel = readFileSync("app/[workspaceSlug]/leadgen/polls/page.tsx", "utf8")
const leadgenPollPanel = readFileSync("app/[workspaceSlug]/leadgen/poll/[pollId]/page.tsx", "utf8")
const workspaceTopBar = readFileSync("components/workspace/WorkspaceTopBarClient.tsx", "utf8")
const staffMigration = readFileSync("supabase/migrations/20260804090000_rename_workspace_member_role_to_staff.sql", "utf8")
const serviceAccessMigration = readFileSync("supabase/migrations/20260902170000_service_scoped_staff_access.sql", "utf8")
const servicePermissionMigration = readFileSync("supabase/migrations/20260902213000_service_staff_permission_controls.sql", "utf8")
const settingsPage = readFileSync("app/[workspaceSlug]/settings/page.tsx", "utf8")
const workspaceAccess = readFileSync("lib/workspace-access.ts", "utf8")
const workspaceTeamSettings = readFileSync("components/settings/WorkspaceTeamSettings.tsx", "utf8")
const defaultStaffAccessMigration = readFileSync("supabase/migrations/20260914170000_default_staff_work_and_comms.sql", "utf8")

test("workspace roles are Owner, Admin, and Staff with legacy member normalization", () => {
    assert.deepEqual(WORKSPACE_ROLES, ["owner", "admin", "staff"])
    assert.equal(normalizeWorkspaceRole("member"), "staff")
    assert.equal(workspaceRoleLabel("staff"), "Staff")
    assert.equal(workspaceRoleMeetsMinimum("staff", "admin"), false)
    assert.equal(workspaceRoleMeetsMinimum("admin", "staff"), true)
})

test("Staff see Library and Communications while operational roles reveal Relationships", () => {
    assert.deepEqual(WORKSPACE_PANELS.map((panel) => panel.label), [
        "Work Queue",
        "Relationships",
        "Onboarding",
        "Client Connections",
        "Communications",
        "Library",
        "Onboarding Builder",
        "Lead Gen",
        "Admin",
        "Settings",
    ])
    const byKey = new Map(WORKSPACE_PANELS.map((panel) => [panel.key, panel]))
    const baseline = [] as const
    const sellerOrManager = ["relationships.view"] as const
    const clientConnectionAssignee = ["client_connections.manage"] as const
    assert.equal(canAccessWorkspacePanel(byKey.get("relationships")!, "staff", baseline), false)
    assert.equal(canAccessWorkspacePanel(byKey.get("relationships")!, "staff", sellerOrManager), true)
    assert.equal(canAccessWorkspacePanel(byKey.get("onboarding")!, "staff", ["onboarding.manage"]), false)
    assert.equal(byKey.has("fulfilment"), false)
    assert.equal(canAccessWorkspacePanel(byKey.get("communications")!, "staff", baseline), true)
    assert.equal(canAccessWorkspacePanel(byKey.get("client-connections")!, "staff", clientConnectionAssignee), true)
    assert.equal(canAccessWorkspacePanel(byKey.get("settings")!, "staff", sellerOrManager), false)
    assert.equal(canAccessWorkspacePanel(byKey.get("client-connections")!, "admin", baseline), false)
    assert.equal(canAccessWorkspacePanel(byKey.get("client-connections")!, "admin", clientConnectionAssignee), true)
    assert.equal(WORKSPACE_PANELS.filter((panel) => panel.key !== "client-connections").every((panel) => canAccessWorkspacePanel(panel, "admin")), true)
    assert.equal(canAccessWorkspacePanel(byKey.get("library")!, "staff", baseline), true)
    assert.equal(canAccessWorkspaceUrl("/acme/sops", "acme", "staff", baseline), true)
    assert.equal(canAccessWorkspaceUrl("/acme/work-items", "acme", "staff", baseline), true)
    assert.equal(canAccessWorkspaceUrl("/acme/assets", "acme", "staff", baseline), false)
    assert.equal(canAccessWorkspaceUrl("/acme/settings", "acme", "staff", sellerOrManager), false)
    assert.equal(canAccessWorkspaceUrl("/acme/work", "acme", "staff", baseline), true)
})

test("Client Connections activates for setup assignees while Appointment Setting services remain detectable", () => {
    const clientConnectionsPanel = WORKSPACE_PANELS.find((panel) => panel.key === "client-connections")!
    assert.equal("requiresService" in clientConnectionsPanel && clientConnectionsPanel.requiresService, true)
    assert.match(workspaceAccess, /APPOINTMENT_SETTING_TEMPLATE_ID = "appointment-setting"/)
    assert.match(workspaceAccess, /\.neq\("state", "archived"\)/)
    assert.match(workspaceAccess, /allowedServiceIds\.some\(\(serviceId\) => appointmentSettingServices\.ids\.has\(serviceId\)\)/)
    assert.match(workspaceAccess, /\? \[APPOINTMENT_SETTING_CAPABILITY\] : \[\]/)
    assert.match(workspaceAccess, /clientConnectionAssignments\.data\?\.length \? \[CLIENT_CONNECTIONS_CAPABILITY\]/)
})

test("workspace capability normalization remains deterministic", () => {
    assert.deepEqual(combineWorkspaceCapabilities([
        ["communications.manage", "onboarding.manage"],
        ["fulfilment.manage", "appointment_setting.manage", "onboarding.manage"],
        ["client_connections.manage"],
    ]), ["onboarding.manage", "fulfilment.manage", "appointment_setting.manage", "client_connections.manage", "communications.manage"])
})

test("workspace access defaults every member to Work Queue without changing delivery permissions", () => {
    assert.match(workspaceAccess, /baseCapabilities = \["fulfilment\.manage", "communications\.manage"\]/)
    assert.match(workspaceAccess, /const workPanel = workspacePanelByKey\("queue"\)/)
    assert.doesNotMatch(workspaceAccess, /from\("workspace_service_capabilities"\)/)
    assert.doesNotMatch(workspaceAccess, /from\("workspace_operational_permissions"\)/)
    assert.doesNotMatch(workspaceTeamSettings, /Position permissions|Service fulfilment permissions|Edit permissions/)
    assert.match(defaultStaffAccessMigration, /when p_capability in \('fulfilment\.manage', 'communications\.manage'\) then true/)
    assert.match(defaultStaffAccessMigration, /operational\.can_sell or operational\.can_manage/)
    assert.match(defaultStaffAccessMigration, /create or replace function public\.workspace_shell_bootstrap/)
})

test("mobile workspace navigation scrolls within the dynamic viewport", () => {
    assert.match(workspaceTopBar, /h-\[calc\(100dvh-3\.5rem\)\]/)
    assert.match(workspaceTopBar, /touch-pan-y flex-col gap-2 overflow-y-auto overscroll-contain/)
    assert.match(workspaceTopBar, /md:overflow-visible md:overscroll-auto/)
})

test("search calls top-level destinations panels and hides all private records from staff", () => {
    assert.match(searchRoute, /type: "Panel"/)
    assert.doesNotMatch(searchRoute, /type: "Page"/)
    assert.match(searchRoute, /canAccessPrivatePanels && !companyError/)
    assert.match(searchRoute, /canAccessPrivatePanels && !pollError/)
    assert.match(searchRoute, /canAccessWorkspacePanel\(panel, access\.role, access\.capabilities\)/)
    assert.match(searchRoute, /accessibleRelationshipIds\(workspaceAccess\)/)
    assert.match(searchRoute, /accessibleWorkItemIds\(workspaceAccess/)
})

test("private Lead Gen routes require admin access", () => {
    for (const source of [leadgenPanel, leadgenPollsPanel, leadgenPollPanel]) {
        assert.match(source, /requireWorkspace\(workspaceSlug, "admin"\)/)
    }
})

test("staff migration updates stored roles and closes the old role constraints", () => {
    assert.match(staffMigration, /set role = 'staff'/)
    assert.match(staffMigration, /check \(role in \('owner', 'admin', 'staff'\)\)/)
    assert.match(staffMigration, /default array\['owner', 'admin', 'staff'\]/)
})

test("service access migration assigns capabilities and enforces record scope", () => {
    assert.match(serviceAccessMigration, /workspace_service_capabilities/)
    assert.match(serviceAccessMigration, /workspace_member_service_access/)
    assert.match(serviceAccessMigration, /workspace_invitation_service_access/)
    assert.match(serviceAccessMigration, /appointment_setting\.manage/)
    assert.match(serviceAccessMigration, /workspace_user_can_access_relationship/)
    assert.match(serviceAccessMigration, /workspace_user_can_access_work_item/)
    assert.match(serviceAccessMigration, /as restrictive for select to authenticated/)
    assert.match(serviceAccessMigration, /alter table public\.workspace_integrations enable row level security/)
    assert.match(serviceAccessMigration, /service scoped staff onboarding blocks/)
    assert.match(serviceAccessMigration, /staff cannot access legacy relationship assets/)
    assert.match(serviceAccessMigration, /staff cannot access client portal sessions/)
})

test("service permission migration makes service grants editable and requires every Staff member to have a service", () => {
    assert.match(servicePermissionMigration, /set_workspace_service_capabilities/)
    assert.match(servicePermissionMigration, /multiple assignments combine grants/i)
    assert.match(servicePermissionMigration, /create constraint trigger workspace_memberships_require_staff_service/)
    assert.match(servicePermissionMigration, /create constraint trigger workspace_member_service_access_requires_one/)
    assert.match(servicePermissionMigration, /STAFF_SERVICE_ACCESS_REQUIRED/)
    assert.match(servicePermissionMigration, /after insert on public\.onboarding_service_revisions/)
    assert.doesNotMatch(settingsPage, /WorkspaceUserAccessEditor|updateWorkspaceUserRole|Edit access/)
})
