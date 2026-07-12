import { supabaseAdmin } from "@/lib/supabase/admin"
import { createUploadSignedUrls } from "@/lib/onboarding/uploads"
import { phaseLabel, type RelationshipPhase } from "@/lib/relationship-phases"
import type { RelationshipRecord, RelationshipWorkItemStatus } from "@/lib/relationships"
export { addCalendarDays, dateDay, dayDate, effectiveGanttRanges, ganttTimelineRange, previewScheduleCascade, rangeContainsRange } from "@/lib/relationship-gantt-schedule"
export type { ScheduleChange } from "@/lib/relationship-gantt-schedule"

export type GanttPerson = { userId: string; username: string; avatarUrl: string | null }

export type RelationshipGanttItem = {
    id: string
    title: string
    status: RelationshipWorkItemStatus
    lifecyclePhase: RelationshipPhase
    parentWorkItemId: string | null
    plannedStartDate: string | null
    plannedStartTime: string | null
    dueDate: string | null
    dueTime: string | null
    actualStartAt: string | null
    actualCompletedAt: string | null
    sortOrder: number
    updatedAt: string
    section: "relationship" | "shared"
    assignees: GanttPerson[]
}

export type RelationshipGanttDependency = {
    workItemId: string
    dependsOnWorkItemId: string
    source: "manual" | "parent_auto"
    external: boolean
}

export type RelationshipGanttMilestone = {
    id: string
    title: string
    occurredAt: string
    kind: "lead_promoted" | "invoice_paid" | "onboarding_opened" | "onboarding_completed" | "relationship_completed"
    href: string | null
}

export type RelationshipGanttPlan = {
    items: RelationshipGanttItem[]
    externalItems: RelationshipGanttItem[]
    dependencies: RelationshipGanttDependency[]
    milestones: RelationshipGanttMilestone[]
}

type RawItem = {
    id: string
    title: string
    status: RelationshipWorkItemStatus
    lifecycle_phase: RelationshipPhase
    parent_work_item_id: string | null
    planned_start_date: string | null
    planned_start_time: string | null
    due_date: string | null
    due_time: string | null
    actual_start_at: string | null
    actual_completed_at: string | null
    sort_order: number
    updated_at: string
}

type RawDependency = { work_item_id: string; depends_on_work_item_id: string; source: "manual" | "parent_auto" }

function relationshipLabel(relationship: RelationshipRecord) {
    return relationship.business_name ?? relationship.primary_person_name
}

export async function getRelationshipGanttPlan(workspaceSlug: string, relationship: RelationshipRecord): Promise<RelationshipGanttPlan> {
    const [itemsResult, linksResult, dependenciesResult, assigneesResult, sessionsResult, salesResult] = await Promise.all([
        supabaseAdmin.from("work_items").select("id, title, status, lifecycle_phase, parent_work_item_id, planned_start_date, planned_start_time, due_date, due_time, actual_start_at, actual_completed_at, sort_order, updated_at").eq("workspace_id", relationship.workspace_id),
        supabaseAdmin.from("work_item_relationships").select("work_item_id, relationship_id, link_source, inherited_from_work_item_id").eq("workspace_id", relationship.workspace_id),
        supabaseAdmin.from("work_item_dependencies").select("work_item_id, depends_on_work_item_id, source").eq("workspace_id", relationship.workspace_id),
        supabaseAdmin.from("work_item_assignees").select("work_item_id, user_id").eq("workspace_id", relationship.workspace_id),
        supabaseAdmin.from("relationship_onboarding_sessions").select("id, status, created_at, completed_at").eq("workspace_id", relationship.workspace_id).eq("relationship_id", relationship.id).order("created_at"),
        relationship.client_id
            ? supabaseAdmin.from("client_sales").select("id, status, updated_at, stripe_hosted_invoice_url").eq("workspace_id", relationship.workspace_id).eq("client_id", relationship.client_id).is("deleted_at", null).order("updated_at")
            : Promise.resolve({ data: [], error: null }),
    ])

    const rawItems = (itemsResult.data ?? []) as RawItem[]
    const rawById = new Map(rawItems.map((item) => [item.id, item]))
    const links = (linksResult.data ?? []) as Array<{ work_item_id: string; relationship_id: string; link_source: "explicit" | "inherited"; inherited_from_work_item_id: string | null }>
    const linksByItem = new Map<string, typeof links>()
    for (const link of links) linksByItem.set(link.work_item_id, [...(linksByItem.get(link.work_item_id) ?? []), link])
    const linkedIds = new Set(links.filter((link) => link.relationship_id === relationship.id).map((link) => link.work_item_id))

    // Include descendants of linked roots for compatibility with work created before inheritance provenance.
    let expanded = true
    while (expanded) {
        expanded = false
        for (const item of rawItems) {
            if (item.parent_work_item_id && linkedIds.has(item.parent_work_item_id) && !linkedIds.has(item.id)) {
                linkedIds.add(item.id)
                expanded = true
            }
        }
    }

    const rootFor = (item: RawItem) => {
        let current = item
        const seen = new Set<string>()
        while (current.parent_work_item_id && !seen.has(current.id)) {
            seen.add(current.id)
            const parent = rawById.get(current.parent_work_item_id)
            if (!parent) break
            current = parent
        }
        return current
    }

    const includedIds = new Set(linkedIds)
    const relevantDependencies = ((dependenciesResult.data ?? []) as RawDependency[]).filter((edge) => linkedIds.has(edge.work_item_id))
    const externalIds = new Set(relevantDependencies.map((edge) => edge.depends_on_work_item_id).filter((id) => !linkedIds.has(id)))
    for (const id of externalIds) includedIds.add(id)

    const relevantAssignees = (assigneesResult.data ?? []).filter((row) => includedIds.has(row.work_item_id))
    const userIds = [...new Set(relevantAssignees.map((row) => row.user_id))]
    const profilesResult = userIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", userIds)
        : { data: [] }
    const profiles = profilesResult.data ?? []
    const avatarUrls = await createUploadSignedUrls(profiles.map((profile) => profile.avatar_path).filter((path): path is string => Boolean(path)))
    const peopleById = new Map(profiles.map((profile) => [profile.user_id, {
        userId: profile.user_id,
        username: profile.username,
        avatarUrl: profile.avatar_path ? avatarUrls.get(profile.avatar_path) ?? null : null,
    }]))
    const peopleByItem = new Map<string, GanttPerson[]>()
    for (const row of relevantAssignees) {
        const person = peopleById.get(row.user_id)
        if (person) peopleByItem.set(row.work_item_id, [...(peopleByItem.get(row.work_item_id) ?? []), person])
    }

    const mapItem = (item: RawItem, section: "relationship" | "shared"): RelationshipGanttItem => ({
        id: item.id,
        title: item.title,
        status: item.status,
        lifecyclePhase: item.lifecycle_phase,
        parentWorkItemId: item.parent_work_item_id,
        plannedStartDate: item.planned_start_date,
        plannedStartTime: item.planned_start_time,
        dueDate: item.due_date,
        dueTime: item.due_time,
        actualStartAt: item.actual_start_at,
        actualCompletedAt: item.actual_completed_at,
        sortOrder: item.sort_order,
        updatedAt: item.updated_at,
        section,
        assignees: peopleByItem.get(item.id) ?? [],
    })

    const items = rawItems.filter((item) => linkedIds.has(item.id)).map((item) => {
        const root = rootFor(item)
        const rootRelationshipIds = new Set((linksByItem.get(root.id) ?? []).map((link) => link.relationship_id))
        return mapItem(item, rootRelationshipIds.size === 1 && rootRelationshipIds.has(relationship.id) ? "relationship" : "shared")
    })
    const externalItems = rawItems.filter((item) => externalIds.has(item.id)).map((item) => mapItem(item, "shared"))

    const milestones: RelationshipGanttMilestone[] = []
    if (relationship.leadgen_company_id || relationship.source_type === "leadgen") {
        milestones.push({ id: `lead-${relationship.id}`, title: "Lead promoted", occurredAt: relationship.created_at, kind: "lead_promoted", href: `/${workspaceSlug}/leadgen` })
    }
    for (const sale of salesResult.data ?? []) {
        if (["paid", "test_paid", "paid_awaiting_whatsapp_confirm", "whatsapp_confirmed", "onboarding_created", "onboarding_link_sent"].includes(String(sale.status))) {
            milestones.push({ id: `invoice-${sale.id}`, title: "Invoice paid", occurredAt: sale.updated_at, kind: "invoice_paid", href: sale.stripe_hosted_invoice_url ?? null })
        }
    }
    for (const session of sessionsResult.data ?? []) {
        milestones.push({ id: `onboarding-open-${session.id}`, title: "Onboarding opened", occurredAt: session.created_at, kind: "onboarding_opened", href: `/${workspaceSlug}/onboarding/${relationship.id}` })
        if (session.status === "completed" && session.completed_at) milestones.push({ id: `onboarding-complete-${session.id}`, title: "Onboarding completed", occurredAt: session.completed_at, kind: "onboarding_completed", href: `/${workspaceSlug}/onboarding/${relationship.id}` })
    }
    const completedAt = typeof relationship.source_metadata.completed_at === "string" ? relationship.source_metadata.completed_at : null
    if (relationship.lifecycle_phase === "completed_lost" && completedAt) milestones.push({ id: `relationship-complete-${relationship.id}`, title: `${relationshipLabel(relationship)} completed`, occurredAt: completedAt, kind: "relationship_completed", href: `/${workspaceSlug}/relationships/${relationship.id}` })

    return {
        items,
        externalItems,
        dependencies: relevantDependencies.map((edge) => ({ workItemId: edge.work_item_id, dependsOnWorkItemId: edge.depends_on_work_item_id, source: edge.source, external: externalIds.has(edge.depends_on_work_item_id) })),
        milestones: milestones.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    }
}

export function ganttPhaseLabel(phase: RelationshipPhase) {
    return phaseLabel(phase)
}
