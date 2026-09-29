import type { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import {
    communicationsHref,
    assetHref,
    onboardingDetailHref,
    relationshipHubHref,
    relationshipSearchHaystack,
    workItemHref,
    workspaceHref,
} from "@/lib/relationships"
import { shortId } from "@/lib/ui/relative-time"
import { okrDisplayTitle, type WorkspaceOkrType } from "@/lib/admin/okr-title"
import { canAccessPrivateWorkspacePanels, canAccessWorkspacePanel, WORKSPACE_PANELS, workspacePanelHref } from "@/lib/workspace-panels"
import { normalizeWorkspaceRole } from "@/lib/workspaces"
import { getAal2User } from "@/lib/auth/aal"
import { loadDeliveryScope, loadWorkspaceAccess, workspaceAccessHasCapability, type WorkspaceAccess } from "@/lib/workspace-access"
import { noteHref } from "@/lib/notes"
import { createSearchReader, withSearchDeadline } from "@/lib/workspace-search-server"
import type { WorkspaceSearchResult as SearchResult } from "@/lib/workspace-search"

export const dynamic = "force-dynamic"

function includesQuery(values: Array<unknown>, query: string) {
    return values
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join(" ")
        .toLowerCase()
        .includes(query)
}

function result(id: string, type: string, label: string, description: string, href: string, options: Pick<SearchResult, "path" | "recordId"> = {}): SearchResult {
    return { id, type, label, description, href, ...options }
}

function staticNavigationResults(workspace: { name: string; slug: string }, query: string, access: WorkspaceAccess, canSell: boolean): SearchResult[] {
    const settingsPath = `${workspace.name} > Settings`
    const libraryPath = `${workspace.name} > Library`
    const canAccessPrivatePanels = canAccessPrivateWorkspacePanels(access.role)
    const canAccessLibrary = canAccessPrivatePanels
    const panelEntries = WORKSPACE_PANELS
        .filter((panel) => canAccessWorkspacePanel(panel, access.role, access.capabilities))
        .map((panel) => ({
            id: `panel-${panel.key}`,
            type: "Panel",
            label: panel.label,
            description: panel.description,
            href: workspacePanelHref(workspace.slug, panel),
            path: `${workspace.name} > ${panel.label}`,
            keywords: [...panel.keywords],
        }))
    const entries = [
        ...panelEntries,
        { id: "tab-sops", type: "Tab", label: "SOPs", description: "Team procedures and supporting files", href: workspaceHref(workspace.slug, "sops"), path: `${libraryPath} > SOPs`, keywords: ["sop", "procedures", "instructions"] },
        ...(canAccessLibrary ? [
            { id: "tab-work-items", type: "Tab", label: "Work Items", description: "Workspace-native task IDs and work item list", href: workspaceHref(workspace.slug, "work-items"), path: `${libraryPath} > Work Items`, keywords: ["tasks", "work item ids", "work ids"] },
            { id: "tab-assets", type: "Tab", label: "Assets", description: "Workspace asset IDs and file gallery", href: workspaceHref(workspace.slug, "assets"), path: `${libraryPath} > Assets`, keywords: ["files", "uploads", "asset ids", "gallery"] },
            { id: "tab-notes", type: "Tab", label: "Notes", description: "Call notes and durable relationship context", href: workspaceHref(workspace.slug, "notes"), path: `${libraryPath} > Notes`, keywords: ["call notes", "context", "notes"] },
            { id: "action-new-note", type: "Action", label: "Add Note", description: "Create a note and link relationships or assets", href: workspaceHref(workspace.slug, "notes?create=note"), path: `${libraryPath} > Notes > New`, keywords: ["new note", "call note", "add context"] },
        ] : []),
        ...(canSell ? [{ id: "action-new-relationship", type: "Action", label: "Start New Relationship", description: "Create a relationship manually at any lifecycle stage", href: workspaceHref(workspace.slug, "relationships?create=relationship"), path: `${workspace.name} > Relationships > New`, keywords: ["manual relationship", "new relationship", "add relationship", "manual client", "new client", "add client"] }] : []),
        ...(canAccessPrivatePanels ? [
            { id: "settings-workspace", type: "Settings", label: "Workspace", description: "Edit the workspace name", href: workspaceHref(workspace.slug, "settings#workspace"), path: `${settingsPath} > Workspace`, keywords: ["name", "identity"] },
            { id: "settings-services", type: "Settings", label: "Services", description: "Service catalogue, prices, assignees, and onboarding module assignments", href: workspaceHref(workspace.slug, "settings#services"), path: `${settingsPath} > Services`, keywords: ["catalogue", "pricing", "service modules"] },
            { id: "settings-onboarding", type: "Settings", label: "Onboarding Settings", description: "Mandatory modules, bookends, client help, and custom domain", href: workspaceHref(workspace.slug, "settings#onboarding"), path: `${settingsPath} > Onboarding`, keywords: ["mandatory modules", "welcome", "completion", "builder"] },
            { id: "settings-agency-branding", type: "Settings", label: "Agency Branding", description: "Client-facing identity, policies, metadata, and colours", href: workspaceHref(workspace.slug, "settings#agency-branding"), path: `${settingsPath} > Agency Branding`, keywords: ["display name", "privacy policy", "terms of service", "metadata", "page title", "colours", "colors", "theme", "client portal branding"] },
            { id: "settings-onboarding-domain", type: "Settings", label: "Onboarding Domain", description: "Verified client onboarding hostname", href: workspaceHref(workspace.slug, "settings#onboarding-domain"), path: `${settingsPath} > Onboarding Domain`, keywords: ["custom domain", "hostname"] },
            { id: "settings-client-portal-domain", type: "Settings", label: "Client Portal Domain", description: "Verified client portal hostname", href: workspaceHref(workspace.slug, "settings#client-portal-domain"), path: `${settingsPath} > Client Portal > Client Portal Domain`, keywords: ["custom domain", "hostname", "portal"] },
            { id: "settings-connections", type: "Settings", label: "Connections", description: "Stripe and WhatsApp credentials", href: workspaceHref(workspace.slug, "settings#connections"), path: `${settingsPath} > Connections`, keywords: ["stripe", "whatsapp", "meta"] },
            { id: "settings-users", type: "Settings", label: "Users", description: "Access and invitations", href: workspaceHref(workspace.slug, "settings#users"), path: `${settingsPath} > Users`, keywords: ["team", "staff", "invite"] },
            { id: "settings-teams", type: "Settings", label: "Teams", description: "Fulfilment teams, Maintenance routing, and shared team chats", href: workspaceHref(workspace.slug, "settings#teams"), path: `${settingsPath} > Teams`, keywords: ["fulfilment team", "maintenance team", "responsible officers", "global officer", "maintenance routing", "failure assignee"] },
        ] : []),
    ]

    return entries
        .filter((entry) => includesQuery([entry.label, entry.description, entry.path, ...entry.keywords], query))
        .map((entry) => ({
            id: entry.id,
            type: entry.type,
            label: entry.label,
            description: entry.description,
            href: entry.href,
            path: entry.path,
        }))
        .slice(0, 6)
}

async function requireSearchWorkspace(workspaceSlug: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const supabase = await createSupabaseServerClient()
    signal.throwIfAborted()
    const user = await getAal2User(supabase)
    signal.throwIfAborted()
    if (!user) return null

    const { data: workspace, error: workspaceError } = await supabaseAdmin
        .from("workspaces")
        .select("id, slug, name, status")
        .eq("slug", workspaceSlug)
        .eq("status", "active")
        .abortSignal(signal).maybeSingle()

    signal.throwIfAborted()
    if (workspaceError) throw new Error("Could not verify workspace")
    if (!workspace) return null

    const { data: membership, error: membershipError } = await supabaseAdmin
        .from("workspace_memberships")
        .select("role")
        .eq("workspace_id", workspace.id)
        .eq("user_id", user.id)
        .abortSignal(signal).maybeSingle()

    signal.throwIfAborted()
    if (membershipError) throw new Error("Could not verify membership")
    const role = normalizeWorkspaceRole(membership?.role)
    return membership && role ? {
        workspace: workspace as { id: string; slug: string; name: string; status: string },
        role,
        userId: user.id,
    } : null
}

function searchResponse(results: SearchResult[], status = 200, error?: string, scope?: { userId: string; workspaceId: string }) {
    return Response.json({ results, ...(error ? { error } : {}), ...(scope ? { scope } : {}) }, {
        status,
        headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" },
    })
}

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    try {
        return await withSearchDeadline(request.signal, (signal) => search(request, context, signal))
    } catch (error) {
        // No partial discovery after a failed authorization or category read.
        const timedOut = error instanceof DOMException && error.name === "TimeoutError"
        return searchResponse([], timedOut ? 504 : 503, timedOut ? "Search timed out" : "Search unavailable")
    }
}

async function search(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }, signal: AbortSignal) {
    const { workspaceSlug } = await context.params
    const access = await requireSearchWorkspace(workspaceSlug, signal)
    if (!access) return searchResponse([], 401)
    const { workspace, role, userId } = access
    const responseScope = { userId, workspaceId: workspace.id }
    const query = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase()
    if (query.length < 2) return searchResponse([], 200, undefined, responseScope)
    if (query.length > 200) return searchResponse([], 400, "Search query is too long")

    const canAccessPrivatePanels = canAccessPrivateWorkspacePanels(role)
    const accessPromise = loadWorkspaceAccess({ workspaceId: workspace.id, workspaceSlug: workspace.slug, userId, role })
    const scopePromise = canAccessPrivatePanels ? Promise.resolve(null) : loadDeliveryScope(workspace.id, userId)
    // Observe rejection immediately; the scope joins the content reads below.
    // It must pass before publication, without delaying independent record reads.
    void scopePromise.catch(() => {})
    const workspaceAccess = await accessPromise
    signal.throwIfAborted()
    if (!workspaceAccess.serviceAccessSchemaReady) throw new Error("Could not verify workspace permissions")
    const canAccessRelationships = workspaceAccessHasCapability(workspaceAccess, "relationships.view")
    const canAccessOnboarding = workspaceAccessHasCapability(workspaceAccess, "onboarding.manage")
    const navigation = staticNavigationResults(workspace, query, workspaceAccess, true)
    const read = createSearchReader(signal)
    const privateRead = <T,>(query: () => Parameters<typeof read<T>>[0]) => canAccessPrivatePanels ? read(query()) : Promise.resolve([] as NonNullable<T>)

    // Preserve candidate windows and assembly order. Stage III can replace these
    // readers without replacing cancellation, error handling or the result owner.
    const [scope, canonicalRelationships, clients, publicWorkItems, privateWorkItems, channels, seller,
        okrs, keyResults, adminActivity, modules, moduleRevisions, services, serviceRevisions, activities, assets, notes] = await Promise.all([
        scopePromise,
        read(supabaseAdmin.from("relationships").select("id, client_id, primary_person_name, primary_email, primary_phone, business_name, website_url, industry_value, location_value, source_label, primary_contact_role, notes_summary, updated_at").eq("workspace_id", workspace.id).order("updated_at", { ascending: false })),
        read(supabaseAdmin.from("clients").select("id, relationship_id, name, email, phone, created_at").eq("workspace_id", workspace.id).is("archived_at", null).order("created_at", { ascending: false })),
        read(supabaseAdmin.from("work_items").select("id, title, description, lifecycle_phase, kind, visibility, area").eq("workspace_id", workspace.id).eq("visibility", "workspace").limit(80)),
        privateRead(() => supabaseAdmin.from("work_items").select("id, title, description, lifecycle_phase, kind, visibility, area").eq("workspace_id", workspace.id).eq("visibility", "admins_only").limit(80)),
        workspaceAccessHasCapability(workspaceAccess, "communications.manage")
            ? read(supabaseAdmin.rpc("read_search_contact_channels", { p_workspace_id: workspace.id, p_user_id: userId })) as Promise<Array<{ relationship_id: string; external_address: string; provider: string }>>
            : Promise.resolve([]),
        navigation.some((item) => item.id === "action-new-relationship")
            ? read(supabaseAdmin.rpc("workspace_user_can_sell", { p_workspace_id: workspace.id, p_user_id: userId }))
            : Promise.resolve(false),
        privateRead(() => supabaseAdmin.from("workspace_okrs").select("id, objective, objective_type, description, status, period_end").eq("workspace_id", workspace.id).limit(60)),
        privateRead(() => supabaseAdmin.from("workspace_okr_key_results").select("id, name, description, unit, comparator").eq("workspace_id", workspace.id).limit(100)),
        privateRead(() => supabaseAdmin.from("workspace_admin_activity").select("id, category, level, event_key, summary, entity_type, entity_id").eq("workspace_id", workspace.id).order("occurred_at", { ascending: false }).limit(100)),
        privateRead(() => supabaseAdmin.from("onboarding_modules").select("id, internal_code, status").eq("workspace_id", workspace.id).limit(100)),
        privateRead(() => supabaseAdmin.from("onboarding_module_revisions").select("module_id, status, definition").eq("workspace_id", workspace.id).order("updated_at", { ascending: false }).limit(200)),
        privateRead(() => supabaseAdmin.from("onboarding_services").select("id, internal_code, state").eq("workspace_id", workspace.id).limit(100)),
        privateRead(() => supabaseAdmin.from("onboarding_service_revisions").select("service_id, name, description").eq("workspace_id", workspace.id).order("published_at", { ascending: false }).limit(200)),
        privateRead(() => supabaseAdmin.from("client_activity").select("id, client_id, activity_text, activity_type").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(60)),
        privateRead(() => supabaseAdmin.from("assets").select("id, asset_kind, source_kind, title, description").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(80)),
        privateRead(() => supabaseAdmin.from("notes").select("id,name,description").eq("workspace_id", workspace.id).order("updated_at", { ascending: false }).limit(80)),
    ])
    signal.throwIfAborted()
    if (!canAccessPrivatePanels && (!scope || !Array.isArray(scope.relationships) || !Array.isArray(scope.work_items))) {
        throw new Error("Invalid search access scope")
    }
    const wrappedClientIds = new Set(canonicalRelationships.map((item) => item.client_id).filter(Boolean))
    const allRelationships = [...canonicalRelationships, ...clients.filter((client) => !wrappedClientIds.has(client.id)).map((client) => ({
        id: client.id, client_id: client.id,
        primary_person_name: client.name?.trim() || client.email?.trim() || client.phone?.trim() || "Unknown relationship",
        primary_email: client.email, primary_phone: client.phone, business_name: client.name,
        website_url: null, industry_value: null, location_value: null, source_label: "Legacy onboarding",
        primary_contact_role: null, notes_summary: null, updated_at: client.created_at,
    }))].sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
    const allowedRelationshipIds = scope ? new Set(scope.relationships) : null
    const allowedWorkItemIds = scope ? new Set(scope.work_items) : null
    const relationships = allRelationships.filter((relationship) => !allowedRelationshipIds || allowedRelationshipIds.has(relationship.id))
    const results: SearchResult[] = navigation.filter((item) => item.id !== "action-new-relationship" || seller === true)

    for (const relationship of relationships.filter((item) => relationshipSearchHaystack(item).includes(query) || includesQuery([item.id], query)).slice(0, 8)) {
        const staffHref = canAccessOnboarding ? onboardingDetailHref(workspace.slug, relationship.id) : workspaceHref(workspace.slug, `work/${relationship.id}`)
        results.push(result(
            `relationship-${relationship.id}`,
            "Relationship",
            relationship.primary_person_name,
            relationship.business_name ?? relationship.primary_email ?? relationship.primary_phone ?? "Relationship Hub",
            canAccessRelationships ? relationshipHubHref(workspace.slug, relationship.id) : staffHref,
            {
                path: canAccessRelationships ? `${workspace.name} > Relationships` : `${workspace.name} > ${canAccessOnboarding ? "Onboarding" : "Fulfilment"}`,
                recordId: shortId(relationship.id),
            }
        ))
    }

    const relationshipByClientId = new Map(relationships.map((relationship) => [relationship.client_id, relationship]).filter((entry): entry is [string, typeof relationships[number]] => Boolean(entry[0])))

    const workItems = [...publicWorkItems, ...privateWorkItems]

    for (const item of workItems.filter((item) => (canAccessPrivatePanels || (item.visibility === "workspace" && item.area !== "admin" && allowedWorkItemIds?.has(item.id))) && includesQuery([item.id, item.title, item.description, item.lifecycle_phase], query)).slice(0, 6)) {
        const isPrivate = item.visibility === "admins_only"
        results.push(result(
            `work-${item.id}`,
            item.kind === "maintenance" ? "Maintenance" : item.kind === "okr_action" ? "OKR action" : "Work item",
            item.title,
            item.description ?? (isPrivate ? "Admin work item" : "Workspace work item"),
            workItemHref(workspace.slug, item.id),
            {
                path: isPrivate
                    ? `${workspace.name} > Admin > ${item.kind === "maintenance" ? "Maintenance" : "Work"}`
                    : `${workspace.name} > Library > Work Items`,
                recordId: shortId(item.id),
            }
        ))
    }

    if (canAccessPrivatePanels) {
        for (const okr of okrs.filter((item) => includesQuery([item.id, item.objective, item.objective_type, item.description, item.status], query)).slice(0, 6)) {
            const displayTitle = okrDisplayTitle({ objectiveType: okr.objective_type as WorkspaceOkrType | null, objective: okr.objective, deadline: okr.period_end })
            results.push(result(`okr-${okr.id}`, "OKR", displayTitle, okr.description ?? `${okr.status} objective`, `/${workspace.slug}/admin/okrs#okr-${okr.id}`, {
                path: `${workspace.name} > Admin > OKRs`, recordId: shortId(okr.id),
            }))
        }
        for (const keyResult of keyResults.filter((item) => includesQuery([item.id, item.name, item.description, item.unit, item.comparator], query)).slice(0, 6)) {
            results.push(result(`okr-key-result-${keyResult.id}`, "Key Result", keyResult.name, keyResult.description ?? "Measurable OKR outcome", `/${workspace.slug}/admin/okrs#key-result-${keyResult.id}`, {
                path: `${workspace.name} > Admin > OKRs`, recordId: shortId(keyResult.id),
            }))
        }
        for (const event of adminActivity.filter((item) => includesQuery([item.id, item.category, item.level, item.event_key, item.summary, item.entity_type, item.entity_id], query)).slice(0, 6)) {
            results.push(result(`admin-activity-${event.id}`, "Admin activity", event.summary, `${event.category} · ${event.level}`, `/${workspace.slug}/admin/activity/${event.id}`, {
                path: `${workspace.name} > Admin > Activity`, recordId: shortId(event.id),
            }))
        }
        {
            const latestByModule = new Map<string, (typeof moduleRevisions)[number]>()
            for (const revision of moduleRevisions) if (!latestByModule.has(revision.module_id)) latestByModule.set(revision.module_id, revision)
            for (const moduleMatch of modules.flatMap((item) => {
                const revision = latestByModule.get(item.id)
                const definition = revision?.definition && typeof revision.definition === "object" && !Array.isArray(revision.definition) ? revision.definition as Record<string, unknown> : {}
                const name = typeof definition.name === "string" ? definition.name : item.internal_code
                const description = typeof definition.description === "string" ? definition.description : "Reusable onboarding module"
                return includesQuery([item.id, item.internal_code, name, description], query) ? [{ item, revision, name, description }] : []
            }).slice(0, 6)) results.push(result(`onboarding-module-${moduleMatch.item.id}`, "Onboarding module", moduleMatch.name, moduleMatch.description || `${moduleMatch.revision?.status ?? moduleMatch.item.status} module`, `/${workspace.slug}/onboarding-builder?module=${encodeURIComponent(moduleMatch.item.id)}`, { path: `${workspace.name} > Onboarding Builder`, recordId: shortId(moduleMatch.item.id) }))
        }
        {
            const latestByService = new Map<string, (typeof serviceRevisions)[number]>()
            for (const revision of serviceRevisions) if (!latestByService.has(revision.service_id)) latestByService.set(revision.service_id, revision)
            for (const service of services.flatMap((item) => {
                const revision = latestByService.get(item.id)
                const name = revision?.name ?? item.internal_code
                return includesQuery([item.id, item.internal_code, name, revision?.description], query) ? [{ item, revision, name }] : []
            }).slice(0, 6)) results.push(result(`onboarding-service-${service.item.id}`, "Service", service.name, service.revision?.description ?? `${service.item.state} service`, `/${workspace.slug}/settings?service=${encodeURIComponent(service.item.id)}#services`, { path: `${workspace.name} > Settings > Services`, recordId: shortId(service.item.id) }))
        }
    }

    if (canAccessPrivatePanels) {
        for (const client of clients.slice(0, 80).filter((client) => Boolean(relationshipByClientId.get(client.id) || client.relationship_id && (!allowedRelationshipIds || allowedRelationshipIds.has(client.relationship_id))) && includesQuery([client.id, client.name, client.email, client.phone], query)).slice(0, 6)) {
            const relationship = relationshipByClientId.get(client.id)
            results.push(result(
                `client-${client.id}`,
                "Relationship",
                client.name ?? client.email ?? "Unnamed client",
                client.email ?? client.phone ?? "Onboarding relationship",
                relationship ? onboardingDetailHref(workspace.slug, relationship.id) : client.relationship_id ? onboardingDetailHref(workspace.slug, client.relationship_id) : workspaceHref(workspace.slug, "onboarding"),
                {
                    path: `${workspace.name} > Onboarding`,
                    recordId: client.id,
                }
            ))
        }
    }

    for (const asset of assets.filter((asset) => includesQuery([asset.id, asset.asset_kind, asset.source_kind, asset.title, asset.description], query)).slice(0, 6)) {
        results.push(result(
            `asset-${asset.id}`,
            "Asset",
            asset.title,
            "Workspace asset",
            assetHref(workspace.slug, asset.id),
            {
                path: `${workspace.name} > Library > Assets`,
                recordId: shortId(asset.id),
            }
        ))
    }

    for (const note of notes.filter((note) => includesQuery([note.id, note.name, note.description], query)).slice(0, 6)) {
        results.push(result(`note-${note.id}`, "Note", note.name, note.description, noteHref(workspace.slug, note.id), {
            path: `${workspace.name} > Library > Notes`, recordId: shortId(note.id),
        }))
    }

    for (const channel of channels.filter((channel) => includesQuery([channel.external_address, channel.provider], query)).slice(0, 4)) {
        results.push(result(
            `contact-${channel.relationship_id}-${channel.provider}`,
            "Contact",
            channel.external_address,
            channel.provider,
            `${communicationsHref(workspace.slug)}?conversation=${encodeURIComponent(channel.relationship_id)}`,
            { path: `${workspace.name} > Communications` }
        ))
    }

    for (const activity of activities.filter((activity) => relationshipByClientId.has(activity.client_id) && includesQuery([activity.id, activity.client_id, activity.activity_text, activity.activity_type], query)).slice(0, 4)) {
        const relationship = relationshipByClientId.get(activity.client_id)
        results.push(result(
            `activity-${activity.id}`,
            "Activity",
            activity.activity_text,
            activity.activity_type,
            relationship ? onboardingDetailHref(workspace.slug, relationship.id) : workspaceHref(workspace.slug, "onboarding"),
            {
                path: `${workspace.name} > Onboarding > Recent Activity`,
                recordId: activity.id,
            }
        ))
    }

    return searchResponse(results.slice(0, 20), 200, undefined, responseScope)
}
