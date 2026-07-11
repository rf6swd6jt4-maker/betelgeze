export type GanttScheduleItem = {
    id: string
    title: string
    status: string
    parentWorkItemId: string | null
    plannedStartDate: string | null
    plannedStartTime: string | null
    dueDate: string | null
    dueTime: string | null
    updatedAt: string
}

export type GanttScheduleDependency = { workItemId: string; dependsOnWorkItemId: string }

export type ScheduleChange = {
    id: string
    title: string
    plannedStartDate: string | null
    plannedStartTime: string | null
    dueDate: string | null
    dueTime: string | null
    expectedUpdatedAt: string
}

const DAY_MS = 86_400_000

export function dateDay(value: string) {
    return Math.floor(new Date(`${value.slice(0, 10)}T00:00:00Z`).getTime() / DAY_MS)
}

export function dayDate(day: number) {
    return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

export function addCalendarDays(value: string, days: number) {
    return dayDate(dateDay(value) + days)
}

export function effectiveGanttRanges<T extends GanttScheduleItem>(items: T[]) {
    const children = new Map<string, T[]>()
    const byId = new Map(items.map((item) => [item.id, item]))
    for (const item of items) if (item.parentWorkItemId && byId.has(item.parentWorkItemId)) children.set(item.parentWorkItemId, [...(children.get(item.parentWorkItemId) ?? []), item])
    const ranges = new Map<string, { start: string; end: string; derived: boolean }>()
    const visit = (item: T): { start: string; end: string; derived: boolean } | null => {
        const childRanges = (children.get(item.id) ?? []).map(visit).filter((range): range is { start: string; end: string; derived: boolean } => Boolean(range))
        const own = item.plannedStartDate ? { start: item.plannedStartDate, end: item.dueDate ?? item.plannedStartDate, derived: false } : null
        const range = childRanges.length ? {
            start: childRanges.map((value) => value.start).sort()[0],
            end: childRanges.map((value) => value.end).sort().at(-1)!,
            derived: true,
        } : own
        if (range) ranges.set(item.id, range)
        return range
    }
    for (const item of items) if (!item.parentWorkItemId || !byId.has(item.parentWorkItemId)) visit(item)
    return ranges
}

export function previewScheduleCascade<T extends GanttScheduleItem>(
    items: T[],
    dependencies: GanttScheduleDependency[],
    requested: { id: string; plannedStartDate: string; dueDate: string },
) {
    const drafts = new Map(items.map((item) => [item.id, { ...item }]))
    const primary = drafts.get(requested.id)
    if (!primary) return []
    primary.plannedStartDate = requested.plannedStartDate
    primary.dueDate = requested.dueDate
    const changed = new Set([primary.id])
    const children = new Map<string, string[]>()
    for (const item of drafts.values()) if (item.parentWorkItemId) children.set(item.parentWorkItemId, [...(children.get(item.parentWorkItemId) ?? []), item.id])

    const shiftItem = (id: string, delta: number): boolean => {
        const item = drafts.get(id)
        if (!item || ["done", "canceled"].includes(item.status)) return false
        const childIds = children.get(id) ?? []
        if (childIds.length) return childIds.map((childId) => shiftItem(childId, delta)).some(Boolean)
        if (!item.plannedStartDate) return false
        const originalStart = item.plannedStartDate
        item.plannedStartDate = addCalendarDays(originalStart, delta)
        item.dueDate = addCalendarDays(item.dueDate ?? originalStart, delta)
        changed.add(item.id)
        return true
    }

    const shiftTimedItem = (id: string, earliestDate: string, earliestTime: string): boolean => {
        const item = drafts.get(id)
        if (!item || !item.plannedStartDate || !item.plannedStartTime || ["done", "canceled"].includes(item.status)) return false
        const start = Date.parse(`${item.plannedStartDate}T${item.plannedStartTime}:00Z`)
        const end = Date.parse(`${item.dueDate ?? item.plannedStartDate}T${item.dueTime ?? item.plannedStartTime}:00Z`)
        const earliest = Date.parse(`${earliestDate}T${earliestTime}:00Z`)
        if (start >= earliest) return false
        const duration = Math.max(0, end - start)
        const nextStart = new Date(earliest)
        const nextEnd = new Date(earliest + duration)
        item.plannedStartDate = nextStart.toISOString().slice(0, 10)
        item.plannedStartTime = nextStart.toISOString().slice(11, 16)
        item.dueDate = nextEnd.toISOString().slice(0, 10)
        item.dueTime = nextEnd.toISOString().slice(11, 16)
        changed.add(item.id)
        return true
    }

    for (let pass = 0; pass < items.length + 1; pass += 1) {
        let shifted = false
        const ranges = effectiveGanttRanges([...drafts.values()])
        for (const edge of dependencies) {
            let predecessor = ranges.get(edge.dependsOnWorkItemId)
            const dependent = ranges.get(edge.workItemId)
            let ancestorId = drafts.get(edge.workItemId)?.parentWorkItemId ?? null
            let predecessorIsAncestor = false
            while (ancestorId) {
                if (ancestorId === edge.dependsOnWorkItemId) { predecessorIsAncestor = true; break }
                ancestorId = drafts.get(ancestorId)?.parentWorkItemId ?? null
            }
            if (predecessorIsAncestor) {
                const predecessorItem = drafts.get(edge.dependsOnWorkItemId)
                predecessor = predecessorItem?.plannedStartDate ? {
                    start: predecessorItem.plannedStartDate,
                    end: predecessorItem.dueDate ?? predecessorItem.plannedStartDate,
                    derived: false,
                } : undefined
            }
            if (!predecessor || !dependent) continue
            const predecessorItem = drafts.get(edge.dependsOnWorkItemId)
            const dependentItem = drafts.get(edge.workItemId)
            if (dependent.start === predecessor.end && predecessorItem?.dueTime && dependentItem?.plannedStartTime) {
                shifted = shiftTimedItem(edge.workItemId, predecessor.end, predecessorItem.dueTime) || shifted
                continue
            }
            if (dependent.start >= predecessor.end) continue
            shifted = shiftItem(edge.workItemId, dateDay(predecessor.end) - dateDay(dependent.start)) || shifted
        }
        if (!shifted) break
    }

    return [...changed].flatMap((id): ScheduleChange[] => {
        const item = drafts.get(id)
        return item ? [{
            id: item.id,
            title: item.title,
            plannedStartDate: item.plannedStartDate,
            plannedStartTime: item.plannedStartTime,
            dueDate: item.dueDate,
            dueTime: item.dueTime,
            expectedUpdatedAt: item.updatedAt,
        }] : []
    })
}
