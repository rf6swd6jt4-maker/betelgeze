import "server-only"

import { notFound } from "next/navigation"
import { ADMIN_ACTIVITY_CATEGORIES, decodeAdminActivityCursor, encodeAdminActivityCursor, getAdminActivityEvent, getAdminActivityFacets, listAdminActivityPage, listAdminActivitySince, listCorrelatedAdminActivity, type AdminActivityCategory, type AdminActivityEvent, type AdminActivityLevel } from "@/lib/admin/activity"
import { sanitizeAdminActivityPayload } from "@/lib/admin/activity-sanitizer"
import { ACTIVITY_RANGES, buildAdminActivityMetricBundle, type AdminActivityRange } from "@/lib/admin/activity-metrics"
import { listMaintenanceWorkItems } from "@/lib/admin/maintenance"
import { getWorkspaceOkr, listWorkspaceOkrs } from "@/lib/admin/okrs"
import { adminPeople } from "@/lib/admin/people"
import { listAdminWorkItems } from "@/lib/admin/work-items"
import { adminWorkItemDisplay } from "@/lib/admin/work-item-display"
import { okrAttention } from "@/lib/admin/work-priority"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

function safeMetadata(value: unknown) {
    const result = sanitizeAdminActivityPayload(value)
    return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {}
}

function activitySummary(event: AdminActivityEvent) {
    const metadata = safeMetadata(event.metadata)
    return {
        id: event.id, category: event.category, level: event.level, summary: event.summary, event_key: event.event_key,
        source_href: event.source_href, entity_id: event.entity_id, entity_type: event.entity_type, actor_user_id: event.actor_user_id,
        occurred_at: event.occurred_at,
        details: Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && typeof value !== "object").slice(0, 4).map(([key, value]) => `${key.replace(/_/g, " ")}: ${String(value)}`).join(" · "),
    }
}

async function actorProfiles(ids: string[]) {
    const uniqueIds = [...new Set(ids)]
    const profiles = uniqueIds.length ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", uniqueIds) : { data: [], error: null }
    if (profiles.error) throw new Error("Could not load activity actors")
    return Object.fromEntries((profiles.data ?? []).map((person) => [person.user_id, { name: person.username, avatarSrc: person.avatar_path ? profileAvatarUrl(person.username, person.avatar_path) : null }]))
}

export async function loadNativeAdminTrends(workspaceSlug: string) {
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const now = new Date()
    const since = new Date(now.getTime() - 33 * 24 * 60 * 60 * 1000).toISOString()
    const events = await listAdminActivitySince(workspace.id, since, now.toISOString())
    return { userId: user.id, workspaceId: workspace.id, workspaceSlug: workspace.slug, metrics: buildAdminActivityMetricBundle(events, now) }
}

export async function loadNativeAdmin(workspaceSlug: string, section: "work" | "okrs" | "okr-detail" | "maintenance" | "activity" | "activity-detail", query = new URLSearchParams()) {
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const identity = { userId: user.id, workspaceId: workspace.id, workspaceSlug: workspace.slug, context: null }
    if (section === "work") {
        const [okrs, people] = await Promise.all([listWorkspaceOkrs(workspace.id), adminPeople(workspace.id)])
        const workItems = (await listAdminWorkItems(workspace.id, okrs, new Date())).map(adminWorkItemDisplay)
        return { ...identity, kind: "admin-work" as const, workItems, names: Object.fromEntries(people.names), avatarUrls: Object.fromEntries(people.avatarUrls) }
    }
    if (section === "okrs" || section === "okr-detail") {
        const focusId = section === "okr-detail" ? query.get("id") : null
        if (section === "okr-detail" && (!focusId || !await getWorkspaceOkr(workspace.id, focusId))) notFound()
        const now = new Date()
        const [allOkrs, people, links] = await Promise.all([
            listWorkspaceOkrs(workspace.id), adminPeople(workspace.id),
            supabaseAdmin.from("work_items").select("id, title, status, priority, due_date, execution_owner_id").eq("workspace_id", workspace.id).order("priority").order("updated_at", { ascending: false }).limit(250),
        ])
        if (links.error) throw new Error("Could not load OKR work options")
        const okrs = allOkrs.filter((okr) => okr.objective_type !== "aspirational").map((okr) => ({ ...okr, key_results: okr.status === "active" ? [...okr.key_results].sort((left, right) => {
            const leftAttention = okrAttention({ progress: left.progress, periodStart: okr.period_start, periodEnd: okr.period_end, now })
            const rightAttention = okrAttention({ progress: right.progress, periodStart: okr.period_start, periodEnd: okr.period_end, now })
            if (!Number.isFinite(leftAttention) && !Number.isFinite(rightAttention)) return left.sort_order - right.sort_order
            if (!Number.isFinite(leftAttention)) return -1
            if (!Number.isFinite(rightAttention)) return 1
            return rightAttention - leftAttention || left.sort_order - right.sort_order
        }) : okr.key_results })).sort((left, right) => {
            const leftClosed = left.status === "completed" || left.status === "cancelled" ? 1 : 0
            const rightClosed = right.status === "completed" || right.status === "cancelled" ? 1 : 0
            return leftClosed - rightClosed || left.period_end.localeCompare(right.period_end)
        })
        return { ...identity, kind: "admin-okrs" as const, focusId, okrs, ownerOptions: people.ownerOptions, workItems: links.data ?? [], names: Object.fromEntries(people.names), today: now.toISOString().slice(0, 10) }
    }
    if (section === "maintenance") {
        const [items, members] = await Promise.all([listMaintenanceWorkItems(workspace.id), supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspace.id).in("role", ["owner", "admin"])])
        if (members.error) throw new Error("Could not load maintenance assignees")
        const people = await actorProfiles((members.data ?? []).map((member) => member.user_id))
        return { ...identity, kind: "admin-maintenance" as const, people, items: items.map((item) => ({
            id: item.id, title: item.title, status: item.status, priority: item.priority, maintenance_category: item.maintenance_category,
            severity: item.severity, occurrence_count: item.occurrence_count, first_occurred_at: item.first_occurred_at, last_occurred_at: item.last_occurred_at,
            native_href: item.native_href, assignee_ids: item.assignee_ids,
        })) }
    }
    if (section === "activity-detail") {
        const id = query.get("id")
        const event = id ? await getAdminActivityEvent(workspace.id, id) : null
        if (!event) notFound()
        const [timeline, actors] = await Promise.all([event.correlation_id ? listCorrelatedAdminActivity(workspace.id, event.correlation_id) : [event], actorProfiles(event.actor_user_id ? [event.actor_user_id] : [])])
        const actor = event.actor_user_id ? actors[event.actor_user_id] : null
        const metadata = safeMetadata(event.metadata)
        const diagnostics = safeMetadata(event.diagnostics)
        return {
            ...identity, kind: "admin-activity-detail" as const,
            event: { ...activitySummary(event), actor_kind: event.actor_kind, correlation_id: event.correlation_id, causation_event_id: event.causation_event_id, metric_classification: event.metric_classification, failure_fingerprint: event.failure_fingerprint, maintenance_work_item_id: event.maintenance_work_item_id },
            timeline: timeline.map(activitySummary), metadata, diagnostics,
            actorName: actor?.name ?? (event.actor_kind === "client" ? "Client" : event.actor_kind === "automation" || !event.actor_user_id ? "Betelgeze automation" : "Workspace user"), actorAvatar: actor?.avatarSrc ?? null,
        }
    }
    const requestedCategory = query.get("category")
    const category = ADMIN_ACTIVITY_CATEGORIES.includes(requestedCategory as AdminActivityCategory) ? requestedCategory as AdminActivityCategory : null
    const requestedLevel = query.get("level")
    const level = ["info", "warning", "error"].includes(requestedLevel ?? "") ? requestedLevel as AdminActivityLevel : null
    const range: AdminActivityRange = Object.hasOwn(ACTIVITY_RANGES, query.get("range") ?? "") ? query.get("range") as AdminActivityRange : "24h"
    const [page, facets] = await Promise.all([listAdminActivityPage(workspace.id, { limit: 100, category, level, cursor: decodeAdminActivityCursor(query.get("cursor")) }), getAdminActivityFacets(workspace.id, category, level)])
    const actors = await actorProfiles(page.events.flatMap((event) => event.actor_user_id ? [event.actor_user_id] : []))
    return { ...identity, kind: "admin-activity" as const, category, level, range, facets, actors, events: page.events.map(activitySummary), nextCursor: page.nextCursor ? encodeAdminActivityCursor(page.nextCursor) : null }
}

export type NativeAdminSnapshot = Awaited<ReturnType<typeof loadNativeAdmin>>
