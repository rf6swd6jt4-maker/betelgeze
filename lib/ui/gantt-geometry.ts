export function ganttDragDayDelta(pixelDelta: number, dayWidth: number) {
    if (!Number.isFinite(pixelDelta) || !Number.isFinite(dayWidth) || dayWidth <= 0) return 0
    return Math.round(pixelDelta / dayWidth)
}

export type GanttScale = "quarter_hour" | "hour" | "three_hour" | "day" | "week" | "month"

export type GanttTimingItem = {
    id: string
    status: string
    parentWorkItemId: string | null
    plannedStartDate: string | null
    plannedStartTime: string | null
    dueDate: string | null
    dueTime: string | null
    actualStartAt: string | null
    actualStartHasTime: boolean
    actualCompletedAt: string | null
    actualCompletedHasTime: boolean
}

export type GanttDisplayRange = {
    start: number
    end: number | null
    derived: boolean
    open: boolean
    futureOpen: boolean
}

export type GanttProjectedBarGeometry = {
    left: number
    right: number
    width: number
    truthfulRight: number
    overflow: boolean
}

const DAY_MS = 86_400_000

function minuteTime(value: string | null) {
    if (!value) return 0
    const [hours, minutes] = value.slice(0, 5).split(":").map(Number)
    return Number.isInteger(hours) && Number.isInteger(minutes) ? hours * 60 + minutes : 0
}

function dateDay(value: string) {
    return Math.floor(Date.parse(`${value.slice(0, 10)}T00:00:00Z`) / DAY_MS)
}

function localIsoDay(value: string, hasTime: boolean, end: boolean) {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return null
    const day = Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) / DAY_MS
    if (!hasTime) return day + (end ? 1 : 0)
    return day + (parsed.getHours() * 60 + parsed.getMinutes()) / 1440
}

function plannedDay(date: string | null, time: string | null, end: boolean) {
    if (!date) return null
    return dateDay(date) + (time ? minuteTime(time) / 1440 : end ? 1 : 0)
}

export function ganttExplicitDisplayRange(item: GanttTimingItem, nowDay: number): GanttDisplayRange | null {
    const start = item.actualStartAt
        ? localIsoDay(item.actualStartAt, item.actualStartHasTime, false)
        : plannedDay(item.plannedStartDate, item.plannedStartTime, false)
    if (start === null) return null
    const end = item.actualCompletedAt
        ? localIsoDay(item.actualCompletedAt, item.actualCompletedHasTime, true)
        : plannedDay(item.dueDate, item.dueTime, true)
    if (end !== null) return { start, end: Math.max(start, end), derived: false, open: false, futureOpen: false }
    const incomplete = !["done", "canceled"].includes(item.status)
    return {
        start,
        end: incomplete && start <= nowDay ? nowDay : null,
        derived: false,
        open: incomplete && start <= nowDay,
        futureOpen: incomplete && start > nowDay,
    }
}

export function ganttDisplayRanges(items: GanttTimingItem[], nowDay: number) {
    const byId = new Map(items.map((item) => [item.id, item]))
    const children = new Map<string, string[]>()
    for (const item of items) if (item.parentWorkItemId && byId.has(item.parentWorkItemId)) children.set(item.parentWorkItemId, [...(children.get(item.parentWorkItemId) ?? []), item.id])
    const output = new Map<string, GanttDisplayRange>()
    const resolving = new Set<string>()
    const resolve = (id: string): GanttDisplayRange | null => {
        if (output.has(id)) return output.get(id)!
        if (resolving.has(id)) return null
        const item = byId.get(id)
        if (!item) return null
        resolving.add(id)
        const explicit = ganttExplicitDisplayRange(item, nowDay)
        if (explicit) output.set(id, explicit)
        else {
            const childRanges = (children.get(id) ?? []).flatMap((childId) => {
                const range = resolve(childId)
                return range ? [range] : []
            })
            if (childRanges.length) output.set(id, {
                start: Math.min(...childRanges.map((range) => range.start)),
                end: Math.max(...childRanges.map((range) => range.end ?? range.start)),
                derived: true,
                open: false,
                futureOpen: false,
            })
        }
        resolving.delete(id)
        return output.get(id) ?? null
    }
    for (const item of items) resolve(item.id)
    return output
}

export function ganttDependencyGhostRanges(
    items: GanttTimingItem[],
    dependencies: Array<{ workItemId: string; dependsOnWorkItemId: string }>,
    explicitRanges: Map<string, GanttDisplayRange>,
    nowDay: number,
    scale: GanttScale,
) {
    const output = new Map<string, GanttDisplayRange>()
    const byId = new Map(items.map((item) => [item.id, item]))
    for (let pass = 0; pass <= dependencies.length; pass += 1) {
        let changed = false
        for (const edge of dependencies) {
            const item = byId.get(edge.workItemId)
            if (!item || explicitRanges.has(item.id) || output.has(item.id)) continue
            let ancestorId = item.parentWorkItemId
            let predecessorIsAncestor = false
            while (ancestorId) {
                if (ancestorId === edge.dependsOnWorkItemId) { predecessorIsAncestor = true; break }
                ancestorId = byId.get(ancestorId)?.parentWorkItemId ?? null
            }
            if (predecessorIsAncestor) continue
            const predecessor = output.get(edge.dependsOnWorkItemId) ?? explicitRanges.get(edge.dependsOnWorkItemId)
            if (!predecessor) continue
            const start = predecessor.open ? nowDay : predecessor.end ?? predecessor.start
            output.set(item.id, { start, end: ganttAdvanceIntervals(start, scale, 1), derived: false, open: false, futureOpen: false })
            changed = true
        }
        if (!changed) break
    }
    return output
}

function scaleStepDays(scale: GanttScale) {
    if (scale === "quarter_hour") return 15 / 1440
    if (scale === "hour") return 1 / 24
    if (scale === "three_hour") return 3 / 24
    if (scale === "day") return 1
    if (scale === "week") return 7
    return null
}

function utcParts(day: number) {
    const date = new Date(Math.floor(day) * DAY_MS)
    return { year: date.getUTCFullYear(), month: date.getUTCMonth(), date: date.getUTCDate(), fraction: day - Math.floor(day) }
}

function addCalendarMonths(day: number, months: number) {
    const parts = utcParts(day)
    const date = new Date(Date.UTC(parts.year, parts.month + months, 1))
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(parts.date, lastDay))
    return date.getTime() / DAY_MS + parts.fraction
}

export function ganttAdvanceIntervals(day: number, scale: GanttScale, intervals: number) {
    const step = scaleStepDays(scale)
    if (step !== null) return day + step * intervals
    const whole = Math.floor(intervals)
    const afterWhole = addCalendarMonths(day, whole)
    if (intervals === whole) return afterWhole
    const afterNext = addCalendarMonths(afterWhole, 1)
    return afterWhole + (afterNext - afterWhole) * (intervals - whole)
}

export function ganttNextGridDivider(day: number, scale: GanttScale) {
    const step = scaleStepDays(scale)
    if (step !== null && scale !== "week") return (Math.floor(day / step + 1e-8) + 1) * step
    if (scale === "week") {
        const wholeDay = Math.floor(day)
        const weekday = new Date(wholeDay * DAY_MS).getUTCDay()
        const daysToMonday = (8 - weekday) % 7 || 7
        return wholeDay + daysToMonday
    }
    const parts = utcParts(day)
    return Date.UTC(parts.year, parts.month + 1, 1) / DAY_MS
}

export function ganttPreviousGridDivider(day: number, scale: GanttScale) {
    const step = scaleStepDays(scale)
    if (step !== null && scale !== "week") return Math.floor((day + 1e-8) / step) * step
    if (scale === "week") {
        const wholeDay = Math.floor(day)
        const weekday = new Date(wholeDay * DAY_MS).getUTCDay()
        return wholeDay - ((weekday + 6) % 7)
    }
    const parts = utcParts(day)
    return Date.UTC(parts.year, parts.month, 1) / DAY_MS
}

export function ganttOpenTrailEnd(visualRightDay: number, scale: GanttScale) {
    const divider = ganttNextGridDivider(visualRightDay, scale)
    return divider + (ganttAdvanceIntervals(divider, scale, 1) - divider) / 2
}

export function ganttProjectDay(day: number, rangeStart: number, dayWidth: number, gutter = 0) {
    return gutter + (day - rangeStart) * dayWidth
}

export function ganttProjectedBarGeometry({ range, scale, rangeStart, dayWidth, gutter = 0, inset = 0, contentWidth = 0 }: {
    range: GanttDisplayRange
    scale: GanttScale
    rangeStart: number
    dayWidth: number
    gutter?: number
    inset?: number
    contentWidth?: number
}): GanttProjectedBarGeometry {
    const endDay = range.end ?? (range.futureOpen ? ganttAdvanceIntervals(range.start, scale, 1.5) : range.start)
    const left = ganttProjectDay(range.start, rangeStart, dayWidth, gutter) + inset
    const truthfulRight = Math.max(left + 1, ganttProjectDay(endDay, rangeStart, dayWidth, gutter) - inset)
    const right = range.open ? Math.max(truthfulRight, left + contentWidth) : truthfulRight
    return { left, right, width: Math.max(1, right - left), truthfulRight, overflow: range.open && right > truthfulRight + .5 }
}

export function ganttGridDividers(rangeStart: number, rangeDays: number, scale: GanttScale) {
    const output: number[] = []
    let divider = ganttNextGridDivider(rangeStart - 1e-6, scale)
    for (let count = 0; divider <= rangeStart + rangeDays + 1e-6 && count < 12_000; count += 1) {
        output.push(divider)
        const next = ganttNextGridDivider(divider + 1e-7, scale)
        if (next <= divider) break
        divider = next
    }
    return output
}

export function ganttStableTopologicalOrder<T extends { id: string }>(items: T[], dependencies: Array<{ workItemId: string; dependsOnWorkItemId: string }>, compare: (left: T, right: T) => number) {
    const byId = new Map(items.map((item) => [item.id, item]))
    const indegree = new Map(items.map((item) => [item.id, 0]))
    const outgoing = new Map<string, string[]>()
    for (const edge of dependencies) {
        if (!byId.has(edge.workItemId) || !byId.has(edge.dependsOnWorkItemId) || edge.workItemId === edge.dependsOnWorkItemId) continue
        indegree.set(edge.workItemId, (indegree.get(edge.workItemId) ?? 0) + 1)
        outgoing.set(edge.dependsOnWorkItemId, [...(outgoing.get(edge.dependsOnWorkItemId) ?? []), edge.workItemId])
    }
    const ready = items.filter((item) => indegree.get(item.id) === 0).sort(compare)
    const result: T[] = []
    while (ready.length) {
        const item = ready.shift()!
        result.push(item)
        for (const nextId of outgoing.get(item.id) ?? []) {
            const nextDegree = (indegree.get(nextId) ?? 1) - 1
            indegree.set(nextId, nextDegree)
            if (nextDegree === 0) {
                ready.push(byId.get(nextId)!)
                ready.sort(compare)
            }
        }
    }
    if (result.length !== items.length) {
        const placed = new Set(result.map((item) => item.id))
        result.push(...items.filter((item) => !placed.has(item.id)).sort(compare))
    }
    return result
}

export function ganttBoundaryConnectorPath({ sourceRight, sourceY, sourceDivider, rowBoundaryY, targetDivider, targetY, targetLeft }: {
    sourceRight: number
    sourceY: number
    sourceDivider: number
    rowBoundaryY: number
    targetDivider: number
    targetY: number
    targetLeft: number
}) {
    return `M ${sourceRight} ${sourceY} H ${sourceDivider} V ${rowBoundaryY} H ${targetDivider} V ${targetY} H ${targetLeft}`
}

export function ganttOpenOverflowConnectorPath({ sourceX, sourceBottom, targetY, targetLeft }: { sourceX: number; sourceBottom: number; targetY: number; targetLeft: number }) {
    return `M ${sourceX} ${sourceBottom} V ${targetY} H ${targetLeft}`
}

export function ganttAnchoredScrollLeft({
    timelineDay,
    dayWidth,
    leftWidth,
    localX,
    gutter = 0,
}: {
    timelineDay: number
    dayWidth: number
    leftWidth: number
    localX: number
    // Empty space padded before the first day so an edge day can still be
    // scrolled to the centre of the viewport instead of clamping short.
    gutter?: number
}) {
    return Math.max(0, leftWidth + gutter + timelineDay * dayWidth - localX)
}

export function ganttArrowHeadPath(targetBarLeft: number, targetDivider: number, y: number, arrowSize = 4) {
    const distance = targetBarLeft - targetDivider
    if (Math.abs(distance) < arrowSize + 1) return null
    const wingX = targetBarLeft - Math.sign(distance) * arrowSize
    return `M ${wingX} ${y - arrowSize} L ${targetBarLeft} ${y} L ${wingX} ${y + arrowSize}`
}
