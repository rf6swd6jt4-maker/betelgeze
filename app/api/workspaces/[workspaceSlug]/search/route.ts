import type { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import {
    communicationsHref,
    assetHref,
    onboardingDetailHref,
    relationshipHubHref,
    workItemHref,
    workspaceHref,
} from "@/lib/relationships"
import { shortId } from "@/lib/ui/relative-time"
import { okrDisplayTitle, type WorkspaceOkrType } from "@/lib/admin/okr-title"
import { canAccessPrivateWorkspacePanels, canAccessWorkspacePanel, WORKSPACE_PANELS, workspacePanelHref } from "@/lib/workspace-panels"
import { getAal2User } from "@/lib/auth/aal"
import { noteHref } from "@/lib/notes"
import { withSearchDeadline } from "@/lib/workspace-search-server"
import { parseSearchSnapshot, type SearchSnapshot } from "@/lib/workspace-search-snapshot"
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

function staticNavigationResults(workspace: { name: string; slug: string }, query: string, access: Pick<SearchSnapshot, "role" | "capabilities">, canSell: boolean): SearchResult[] {
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
    signal.throwIfAborted()
    const supabase = await createSupabaseServerClient()
    signal.throwIfAborted()
    const user = await getAal2User(supabase)
    signal.throwIfAborted()
    if (!user) return searchResponse([], 401)
    const query = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase()
    if (query.length > 200) return searchResponse([], 400, "Search query is too long")

    // One snapshot verifies active workspace/membership, derives only search's
    // permissions, matches authorized rows, and limits the projection in SQL.
    // The actor always comes from the freshly verified AAL2 session.
    const { data, error } = await supabaseAdmin.rpc("search_workspace_records", {
        p_workspace_slug: workspaceSlug, p_user_id: user.id, p_query: query,
    }).abortSignal(signal)
    signal.throwIfAborted()
    if (error) throw new Error("Search read unavailable")
    if (data === null) return searchResponse([], 401)
    const snapshot = parseSearchSnapshot(data, workspaceSlug)
    const { workspace, role, relationships, work_items: workItems, okrs, key_results: keyResults,
        admin_activity: adminActivity, modules, services, clients, assets, notes, channels, activities } = snapshot
    const responseScope = { userId: user.id, workspaceId: workspace.id }
    if (query.length < 2) return searchResponse([], 200, undefined, responseScope)
    const canAccessPrivatePanels = canAccessPrivateWorkspacePanels(role)
    const canAccessRelationships = canAccessPrivatePanels || snapshot.capabilities.includes("relationships.view")
    const canAccessOnboarding = canAccessPrivatePanels || snapshot.capabilities.includes("onboarding.manage")
    const results = staticNavigationResults(workspace, query, snapshot, snapshot.can_sell)

    for (const relationship of relationships) {
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

    for (const item of workItems) {
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
        for (const okr of okrs) {
            const displayTitle = okrDisplayTitle({ objectiveType: okr.objective_type as WorkspaceOkrType | null, objective: okr.objective, deadline: okr.period_end })
            results.push(result(`okr-${okr.id}`, "OKR", displayTitle, okr.description ?? `${okr.status} objective`, `/${workspace.slug}/admin/okrs#okr-${okr.id}`, {
                path: `${workspace.name} > Admin > OKRs`, recordId: shortId(okr.id),
            }))
        }
        for (const keyResult of keyResults) {
            results.push(result(`okr-key-result-${keyResult.id}`, "Key Result", keyResult.name, keyResult.description ?? "Measurable OKR outcome", `/${workspace.slug}/admin/okrs#key-result-${keyResult.id}`, {
                path: `${workspace.name} > Admin > OKRs`, recordId: shortId(keyResult.id),
            }))
        }
        for (const event of adminActivity) {
            results.push(result(`admin-activity-${event.id}`, "Admin activity", event.summary, `${event.category} · ${event.level}`, `/${workspace.slug}/admin/activity/${event.id}`, {
                path: `${workspace.name} > Admin > Activity`, recordId: shortId(event.id),
            }))
        }
        for (const moduleRecord of modules) results.push(result(`onboarding-module-${moduleRecord.id}`, "Onboarding module", moduleRecord.name, moduleRecord.description || `${moduleRecord.status} module`, `/${workspace.slug}/onboarding-builder?module=${encodeURIComponent(moduleRecord.id)}`, { path: `${workspace.name} > Onboarding Builder`, recordId: shortId(moduleRecord.id) }))
        for (const service of services) results.push(result(`onboarding-service-${service.id}`, "Service", service.name, service.description ?? `${service.state} service`, `/${workspace.slug}/settings?service=${encodeURIComponent(service.id)}#services`, { path: `${workspace.name} > Settings > Services`, recordId: shortId(service.id) }))
        for (const client of clients) results.push(result(
            `client-${client.id}`, "Relationship", client.name ?? client.email ?? "Unnamed client",
            client.email ?? client.phone ?? "Onboarding relationship", onboardingDetailHref(workspace.slug, client.relationship_id),
            { path: `${workspace.name} > Onboarding`, recordId: client.id }
        ))
    }

    for (const asset of assets) {
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

    for (const note of notes) {
        results.push(result(`note-${note.id}`, "Note", note.name, note.description ?? "", noteHref(workspace.slug, note.id), {
            path: `${workspace.name} > Library > Notes`, recordId: shortId(note.id),
        }))
    }

    for (const channel of channels) {
        results.push(result(
            `contact-${channel.relationship_id}-${channel.provider}`,
            "Contact",
            channel.external_address,
            channel.provider,
            `${communicationsHref(workspace.slug)}?conversation=${encodeURIComponent(channel.relationship_id)}`,
            { path: `${workspace.name} > Communications` }
        ))
    }

    for (const activity of activities) {
        results.push(result(
            `activity-${activity.id}`,
            "Activity",
            activity.activity_text,
            activity.activity_type,
            onboardingDetailHref(workspace.slug, activity.relationship_id),
            {
                path: `${workspace.name} > Onboarding > Recent Activity`,
                recordId: activity.id,
            }
        ))
    }

    return searchResponse(results.slice(0, 20), 200, undefined, responseScope)
}
