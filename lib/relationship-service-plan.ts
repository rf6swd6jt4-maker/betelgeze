import type { RelationshipGanttItem, RelationshipGanttPlan, GanttPerson } from "./relationship-gantt"
import { SERVICE_STAGES, type RelationshipServiceRow, type ServiceStageKey } from "./service-stages"

export type ServicePlanWork = {
    id: string; title: string; status: RelationshipGanttItem["status"]; lifecycle_phase: RelationshipGanttItem["lifecyclePhase"]
    workflow_role: string; workflow_action: string | null; parent_work_item_id: string | null
    planned_start_date: string | null; planned_start_time: string | null; due_date: string | null; due_time: string | null
    actual_start_at: string | null; actual_start_has_time: boolean; actual_completed_at: string | null; actual_completed_has_time: boolean
    sort_order: number; created_at: string; updated_at: string; service_id: string | null; native_key: string | null; shared: boolean; assignees: GanttPerson[]
}
export type ServicePlanSnapshot = {
    services: RelationshipServiceRow[]
    events: Array<{ instance_id: string; new_stage: ServiceStageKey; created_at: string; ended_at: string | null }>
    work: ServicePlanWork[]
    links: Array<{ instance_id: string; work_item_id: string }>
    dependencies: Array<{ work_item_id: string; depends_on_work_item_id: string; source: "manual" | "parent_auto"; depends_on_completed: boolean }>
    workTruncated: boolean
}
const phaseForStage: Record<ServiceStageKey, RelationshipGanttItem["lifecyclePhase"]> = {
    negotiating: "potential_client", awaiting_payment: "sold", onboarding: "onboarding", setup: "fulfilment", maintenance: "retention", completed: "completed_lost", for_later: "nurturing", declined: "completed_lost",
}
const stageForPhase: Record<string, ServiceStageKey> = { lead: "negotiating", nurturing: "negotiating", potential_client: "negotiating", sold: "awaiting_payment", invoiced: "awaiting_payment", onboarding: "onboarding", onboarding_review: "onboarding", fulfilment: "setup", retention: "maintenance", completed_lost: "completed" }
export const servicePlanRootId = (id: string) => `service:${id}`
const stageId = (id: string, stage: string) => `${servicePlanRootId(id)}:${stage}`

function workItem(work: ServicePlanWork): RelationshipGanttItem {
    return { id: work.id, title: work.title, status: work.status, lifecyclePhase: work.lifecycle_phase,
        workflowRole: work.workflow_role, workflowAction: work.workflow_action, parentWorkItemId: work.parent_work_item_id,
        plannedStartDate: work.planned_start_date, plannedStartTime: work.planned_start_time, dueDate: work.due_date, dueTime: work.due_time,
        actualStartAt: work.actual_start_at, actualStartHasTime: work.actual_start_has_time, actualCompletedAt: work.actual_completed_at,
        actualCompletedHasTime: work.actual_completed_has_time, sortOrder: work.sort_order, createdAt: work.created_at, updatedAt: work.updated_at,
        section: work.shared ? "shared" : "relationship", assignees: work.assignees }
}

/** View-only grouping. Virtual stage rows never become work IDs or editable dates. */
export function buildRelationshipServicePlan(snapshot: ServicePlanSnapshot): RelationshipGanttPlan {
    const services = snapshot.services.slice(0, 30)
    const items: RelationshipGanttItem[] = []
    const dependencies: RelationshipGanttPlan["dependencies"] = []
    const legacyStages = snapshot.work.filter(w => w.workflow_role === "lifecycle_stage")
    const legacyServices = services.filter(s => s.legacy)
    const workById = new Map(snapshot.work.map(w => [w.id, w]))
    const links = new Map<string, string[]>()
    for (const link of snapshot.links) links.set(link.work_item_id, [...(links.get(link.work_item_id) ?? []), link.instance_id])
    for (const service of services) {
        const root = servicePlanRootId(service.id)
        const assignees = service.assignee_user_id ? [{userId: service.assignee_user_id, username: service.assignee_name, avatarUrl: null}] : []
        const template: RelationshipGanttItem = { id: root, title: service.name, status: service.stage === "completed" ? "done" : service.stage === "declined" ? "canceled" : "doing",
            lifecyclePhase: phaseForStage[service.stage ?? "negotiating"], workflowRole: "service_instance", workflowAction: null, parentWorkItemId: null,
            plannedStartDate: null, plannedStartTime: null, dueDate: null, dueTime: null, actualStartAt: null, actualStartHasTime: true,
            actualCompletedAt: null, actualCompletedHasTime: true, sortOrder: items.length, createdAt: service.created_at, updatedAt: service.created_at,
            section: "relationship", assignees, virtual: true, serviceInstanceId: service.id, serviceStage: service.stage, serviceRoot: true }
        items.push(template)
        const normal = SERVICE_STAGES.filter(s => !["for_later", "declined"].includes(s.key))
        const stages = service.stage === "for_later" || service.stage === "declined" ? [...normal.slice(0,1), SERVICE_STAGES.find(s => s.key === service.stage)!] : normal
        let previous: string | null = null
        for (const [index, stage] of stages.entries()) {
            const event = snapshot.events.find(e => e.instance_id === service.id && e.new_stage === stage.key)
            const old = service.legacy ? legacyStages.filter(w => stageForPhase[w.lifecycle_phase] === stage.key).sort((a,b) => a.sort_order-b.sort_order) : []
            const observedStart = event?.created_at ?? old.find(w => w.actual_start_at)?.actual_start_at ?? null
            const observedEnd = event?.ended_at ?? (old.length && old.every(w => ["done","canceled"].includes(w.status)) ? old.map(w => w.actual_completed_at).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null : null)
            const isCurrent = service.stage === stage.key
            const completed = Boolean(observedEnd) || isCurrent && ["completed","declined"].includes(stage.key)
            const row: RelationshipGanttItem = { ...template, id: stageId(service.id,stage.key), title: stage.label, serviceRoot: false,
                workflowRole: "lifecycle_stage", parentWorkItemId: root, sortOrder: index, serviceStage: stage.key,
                lifecyclePhase: phaseForStage[stage.key], status: completed ? "done" : isCurrent ? "doing" : "todo",
                actualStartAt: observedStart, actualCompletedAt: observedEnd ?? (completed ? observedStart : null),
                plannedStartDate: old.find(w => w.planned_start_date)?.planned_start_date ?? null, dueDate: old.map(w => w.due_date).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null,
                timelineNote: service.legacy ? "Existing relationship lifecycle, shown for this service" : service.origin === "already_onboarded" ? "Recorded service history; earlier delivery dates are not inferred" : "Recorded service stage history" }
            items.push(row)
            // Future ghosts follow the current stage. Missing earlier stages stay undated.
            if (previous && index > stages.findIndex(s => s.key === service.stage) && service.stage && !["completed","declined","for_later"].includes(service.stage)) dependencies.push({workItemId: row.id, dependsOnWorkItemId: previous, source:"manual", external:false})
            previous = row.id
        }
        // The overview span includes only recorded/project dates, never invented history.
        const children = items.filter(i => i.parentWorkItemId === root)
        const starts = children.map(i => i.actualStartAt ?? (i.plannedStartDate ? `${i.plannedStartDate}T00:00:00Z` : null)).filter((s): s is string => Boolean(s)).sort()
        if (starts.length) {
            template.actualStartAt = starts[0]
            template.actualCompletedAt = ["completed","declined"].includes(service.stage ?? "") ? children.map(i => i.actualCompletedAt).filter((s): s is string => Boolean(s)).sort().at(-1) ?? starts[0] : null
        }
    }
    const real: RelationshipGanttItem[] = []
    const ownerByWork = new Map<string,string | null>()
    const resolveOwner = (work: ServicePlanWork, seen = new Set<string>()): string | null => {
        if (ownerByWork.has(work.id)) return ownerByWork.get(work.id)!
        if (seen.has(work.id) || work.shared) return null
        seen.add(work.id)
        const explicit = links.get(work.id) ?? []
        const matches = explicit.length ? services.filter(s => explicit.includes(s.id)) : legacyServices.filter(s => (work.service_id && s.service_id === work.service_id) || work.native_key?.endsWith(`:${s.id.slice(7)}`))
        const parent = work.parent_work_item_id ? workById.get(work.parent_work_item_id) : null
        const owner = matches.length === 1 ? matches[0].id : matches.length > 1 ? null : parent && parent.workflow_role !== "lifecycle_stage" ? resolveOwner(parent,seen) : legacyServices.length === 1 && services.length === 1 ? legacyServices[0].id : null
        ownerByWork.set(work.id,owner)
        return owner
    }
    for (const work of snapshot.work) {
        // Legacy stage summaries are represented once per assigned service above.
        if (work.workflow_role === "lifecycle_stage" && legacyServices.length) continue
        const item = workItem(work)
        const owner = resolveOwner(work)
        const parent = work.parent_work_item_id ? workById.get(work.parent_work_item_id) : null
        item.section = owner ? "relationship" : "shared"
        if (owner) {
            item.serviceInstanceId = owner
            item.parentWorkItemId = parent && parent.workflow_role !== "lifecycle_stage" && resolveOwner(parent) === owner ? parent.id : stageId(owner,stageForPhase[work.lifecycle_phase] ?? "setup")
        } else item.parentWorkItemId = parent && parent.workflow_role !== "lifecycle_stage" && !resolveOwner(parent) ? parent.id : null
        real.push(item)
    }
    items.push(...real)
    const ids = new Set(items.map(i => i.id))
    dependencies.push(...snapshot.dependencies.filter(d => ids.has(d.work_item_id) && ids.has(d.depends_on_work_item_id)).map(d => ({workItemId:d.work_item_id,dependsOnWorkItemId:d.depends_on_work_item_id,source:d.source,external:false})))
    return { items, externalItems: [], dependencies, milestones: [] }
}

export type RelationshipQueueItem = { id: string; title: string; status: string; workflow_action: string | null; due_date: string | null; planned_start_date: string | null; updated_at: string; queue_state: "Ready" | "In progress" | "Scheduled" | "Waiting" | "Blocked"; assignees: GanttPerson[] }
export type RelationshipQueuePage = {items: RelationshipQueueItem[];hasMore:boolean}
