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
import { okrDisplayTitle, type WorkspaceOkrType } from "@/lib/admin/okr-title"
import { canAccessPrivateWorkspacePanels, canAccessWorkspacePanel, WORKSPACE_PANELS, workspacePanelHref } from "@/lib/workspace-panels"
import { getAal2User } from "@/lib/auth/aal"
import { noteHref } from "@/lib/notes"
import { withSearchDeadline } from "@/lib/workspace-search-server"
import { parseSearchSnapshot, type SearchSnapshot } from "@/lib/workspace-search-snapshot"
import { rankWorkspaceSearchMatch, rankWorkspaceSearchResults } from "@/lib/workspace-search-ranking"
import type { WorkspaceSearchResult as SearchResult } from "@/lib/workspace-search"

export const dynamic = "force-dynamic"

function includesQuery(values: Array<unknown>, query: string) {
    return values
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join(" ")
        .toLowerCase()
        .includes(query)
}

function result(id: string, type: string, label: string, description: string, href: string, options: Pick<SearchResult, "path" | "recordId" | "archived" | "matchReason"> = {}): SearchResult {
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
        admin_activity: adminActivity, modules, services, assets, notes, channels, activities, related } = snapshot
    const responseScope = { userId: user.id, workspaceId: workspace.id }
    if (query.length < 2) return searchResponse([], 200, undefined, responseScope)
    const canAccessPrivatePanels = canAccessPrivateWorkspacePanels(role)
    const canAccessRelationships = canAccessPrivatePanels || snapshot.capabilities.includes("relationships.view")
    const canAccessOnboarding = canAccessPrivatePanels || snapshot.capabilities.includes("onboarding.manage")
    const results = staticNavigationResults(workspace, query, snapshot, snapshot.can_sell)
    const ranks = new Map<string, number>()

    for (const relationship of relationships) {
        ranks.set(`relationship-${relationship.id}`, relationship.match_rank)
        const staffHref = canAccessOnboarding ? onboardingDetailHref(workspace.slug, relationship.id) : workspaceHref(workspace.slug, `work/${relationship.id}`)
        results.push(result(
            `relationship-${relationship.id}`,
            "Relationship",
            relationship.primary_person_name,
            relationship.business_name ?? relationship.primary_email ?? relationship.primary_phone ?? "Relationship Hub",
            canAccessRelationships ? relationshipHubHref(workspace.slug, relationship.id) : staffHref,
            {
                path: canAccessRelationships ? `${workspace.name} > Relationships` : `${workspace.name} > ${canAccessOnboarding ? "Onboarding" : "Fulfilment"}`,
                recordId: relationship.id, archived: relationship.status === "archived",
                matchReason: ({ email: "Matches email", phone: "Matches phone", notes: "Matches notes", details: "Matches relationship details" } as Record<string, string>)[relationship.match_field],
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
                recordId: item.id, archived: item.archived,
            }
        ))
    }

    if (canAccessPrivatePanels) {
        for (const okr of okrs) {
            const displayTitle = okrDisplayTitle({ objectiveType: okr.objective_type as WorkspaceOkrType | null, objective: okr.objective, deadline: okr.period_end })
            results.push(result(`okr-${okr.id}`, "OKR", displayTitle, okr.description ?? `${okr.status} objective`, `/${workspace.slug}/admin/okrs#okr-${okr.id}`, {
                path: `${workspace.name} > Admin > OKRs`, recordId: okr.id,
            }))
        }
        for (const keyResult of keyResults) {
            results.push(result(`okr-key-result-${keyResult.id}`, "Key Result", keyResult.name, keyResult.description ?? "Measurable OKR outcome", `/${workspace.slug}/admin/okrs#key-result-${keyResult.id}`, {
                path: `${workspace.name} > Admin > OKRs`, recordId: keyResult.id,
            }))
        }
        for (const event of adminActivity) {
            results.push(result(`admin-activity-${event.id}`, "Admin activity", event.summary, `${event.category} · ${event.level}`, `/${workspace.slug}/admin/activity/${event.id}`, {
                path: `${workspace.name} > Admin > Activity`, recordId: event.id,
            }))
        }
        for (const moduleRecord of modules) results.push(result(`onboarding-module-${moduleRecord.id}`, "Onboarding module", moduleRecord.name, moduleRecord.description || `${moduleRecord.status} module`, `/${workspace.slug}/onboarding-builder?module=${encodeURIComponent(moduleRecord.id)}`, { path: `${workspace.name} > Onboarding Builder`, recordId: moduleRecord.id, archived: moduleRecord.status === "archived" }))
        for (const service of services) results.push(result(`onboarding-service-${service.id}`, "Service", service.name, service.description ?? `${service.state} service`, `/${workspace.slug}/settings?service=${encodeURIComponent(service.id)}#services`, { path: `${workspace.name} > Settings > Services`, recordId: service.id, archived: service.state === "archived" }))

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
                recordId: asset.id, archived: asset.archived,
            }
        ))
    }

    for (const note of notes) {
        results.push(result(`note-${note.id}`, "Note", note.name, note.description ?? "", noteHref(workspace.slug, note.id), {
            path: `${workspace.name} > Library > Notes`, recordId: note.id,
        }))
    }

    for (const channel of channels) {
        results.push(result(
            `client-chat-${channel.relationship_id}`,
            "Contact",
            channel.external_address,
            channel.provider,
            `${communicationsHref(workspace.slug)}?mode=clients&conversation=${encodeURIComponent(channel.relationship_id)}`,
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

    for (const destination of related) {
        const kind = destination.kind
        const id = `${kind === "work_item" ? "work" : kind === "onboarding" ? "onboarding" : kind === "client_chat" ? "client-chat" : "team-chat"}-${destination.id}`
        const direct = results.find(item => item.id === id)
        if (direct) {
            const directRank = rankWorkspaceSearchMatch(query, { ids: direct.recordId ? [direct.recordId] : [], primary: [direct.label], secondary: [direct.description] })
            ranks.set(id, Math.min(ranks.get(id) ?? directRank, 4))
            continue
        }
        ranks.set(id, 4)
        const href = kind === "onboarding"
            ? `${onboardingDetailHref(workspace.slug, destination.relationship_id)}${destination.session_id ? `?session=${encodeURIComponent(destination.session_id)}` : ""}`
            : kind === "work_item" ? workItemHref(workspace.slug, destination.id)
            : kind === "client_chat" ? `${communicationsHref(workspace.slug)}?mode=clients&conversation=${encodeURIComponent(destination.relationship_id)}`
            : `${communicationsHref(workspace.slug)}?mode=team&nativeConversation=${encodeURIComponent(destination.id)}`
        const type = kind === "onboarding" ? "Onboarding" : kind === "client_chat" ? "Client chat" : kind === "team_chat" ? "Team chat" : "Work item"
        const detail = kind === "work_item"
            ? `${({ todo: "Upcoming", doing: "In progress", waiting: "Waiting", blocked: "Blocked" } as Record<string, string>)[destination.status ?? "todo"]}${destination.due_date ? ` · Due ${destination.due_date}` : ""}`
            : kind === "onboarding" ? destination.session_id ? "Open onboarding details" : "Choose an onboarding session"
            : kind === "team_chat" ? destination.title : "Open client conversation"
        results.push(result(id, type, kind === "work_item" ? destination.title : destination.relationship_name, detail, href, {
            path: `${workspace.name} > ${kind === "onboarding" ? "Onboarding" : kind === "work_item" ? "Work" : "Communications"}`,
            recordId: destination.id, matchReason: `Related to ${destination.relationship_name}`.slice(0, 200),
        }))
    }

    const ranked = rankWorkspaceSearchResults(results.map(item => {
        const match = rankWorkspaceSearchMatch(query, { ids: item.recordId ? [item.recordId] : [], primary: [item.label], secondary: [item.description] })
        return { result: item, rank: ranks.get(item.id) ?? (Number.isFinite(match) ? match : 5) }
    }))
    return searchResponse(ranked, 200, undefined, responseScope)
}
