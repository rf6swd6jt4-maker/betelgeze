"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react"
import { Assignee, relationshipPhaseColours } from "@/components/ui"
import { ganttSyncChannelName, postGanttSync } from "@/lib/ui/gantt-sync"
import { addCalendarDays, dateDay, effectiveGanttRanges, rangeContainsRange, type ScheduleChange } from "@/lib/relationship-gantt-schedule"
import type { RelationshipGanttItem, RelationshipGanttPlan } from "@/lib/relationship-gantt"
import {
    applyGanttScheduleChanges,
    loadGanttPlan,
    previewGanttScheduleChange,
    type GanttMutationResult,
} from "./gantt-actions"

type Scale = "day" | "week" | "month"
type DisplayRow = { item: RelationshipGanttItem; depth: number; external?: boolean }

const ROOT_ROW_HEIGHT = 48
const CHILD_ROW_HEIGHT = 32
const ROOT_BAR_HEIGHT = 32
const CHILD_BAR_HEIGHT = 24
const HEADER_HEIGHT = 44
const EMPTY_LANE_HEIGHT = 96
const MIN_CHART_HEIGHT = 448
const MIN_LEFT_WIDTH = 220
const DEFAULT_LEFT_WIDTH = 260
const MAX_LEFT_WIDTH = 360
const RANGE_DAYS = 730
const DEFAULT_ZOOM = 2
const MAX_ZOOM = 6
const BAR_INSET = 8
const RESIZE_HANDLE_WIDTH = 6
const STRUCTURAL_LINE = "#404040"
const SCALE_WIDTH: Record<Scale, number> = { day: 64, week: 28, month: 12 }

function dateLabel(day: number, scale: Scale) {
    const date = new Date(day * 86_400_000)
    return new Intl.DateTimeFormat("en-IE", scale === "month" ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" }).format(date)
}

function rowHeight(row: DisplayRow) {
    return row.depth === 0 ? ROOT_ROW_HEIGHT : CHILD_ROW_HEIGHT
}

function addCalendarMonths(value: string, months: number) {
    const source = new Date(`${value.slice(0, 10)}T00:00:00Z`)
    const day = source.getUTCDate()
    source.setUTCDate(1)
    source.setUTCMonth(source.getUTCMonth() + months)
    const lastDay = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0)).getUTCDate()
    source.setUTCDate(Math.min(day, lastDay))
    return source.toISOString().slice(0, 10)
}

function shiftDate(value: string, units: number, scale: Scale) {
    if (scale === "month") return addCalendarMonths(value, units)
    return addCalendarDays(value, units * (scale === "week" ? 7 : 1))
}

function flattenRows(items: RelationshipGanttItem[], collapsed: Set<string>) {
    const ranges = effectiveGanttRanges(items)
    const byId = new Map(items.map((item) => [item.id, item]))
    const children = new Map<string, RelationshipGanttItem[]>()
    for (const item of items) if (item.parentWorkItemId && byId.has(item.parentWorkItemId)) children.set(item.parentWorkItemId, [...(children.get(item.parentWorkItemId) ?? []), item])
    for (const rows of children.values()) rows.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
    const roots = items.filter((item) => !item.parentWorkItemId || !byId.has(item.parentWorkItemId)).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
    const output: DisplayRow[] = []
    const visit = (item: RelationshipGanttItem, depth: number) => {
        if (ranges.has(item.id)) output.push({ item, depth })
        if (collapsed.has(item.id)) return
        for (const child of children.get(item.id) ?? []) visit(child, depth + 1)
    }
    for (const root of roots) visit(root, 0)
    return output
}

function MutationError({ result }: { result: GanttMutationResult | null }) {
    if (!result || result.status === "saved" || result.status === "cascade_required") return null
    return <p className="border-t border-red-500/20 px-3 py-2 text-sm text-red-300">{result.message}</p>
}

export function RelationshipGantt({ workspaceSlug, relationshipId, plan: initialPlan, canEdit }: {
    workspaceSlug: string
    relationshipId: string
    plan: RelationshipGanttPlan
    canEdit: boolean
}) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const initiallyCenteredRef = useRef(false)
    const touchPointsRef = useRef(new Map<number, { x: number; y: number }>())
    const pinchRef = useRef<{ distance: number; zoom: number; centerX: number; centerY: number; active: boolean } | null>(null)
    // The plan is held locally so edits can be painted optimistically and so
    // cross-tab changes can refresh it without a full route reload.
    const [plan, setPlan] = useState(initialPlan)
    const [scale, setScale] = useState<Scale>("week")
    const [zoom, setZoom] = useState(DEFAULT_ZOOM)
    const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH)
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
    const [flashingItemId, setFlashingItemId] = useState<string | null>(null)
    const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [cascade, setCascade] = useState<ScheduleChange[] | null>(null)
    const [result, setResult] = useState<GanttMutationResult | null>(null)
    const [pending, startTransition] = useTransition()

    // The server can stream a refreshed plan into this long-lived client view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { setPlan(initialPlan) }, [initialPlan])

    const dayWidth = SCALE_WIDTH[scale] * zoom
    const today = new Date().toISOString().slice(0, 10)
    const rangeStart = dateDay(today) - 180
    const timelineX = useCallback((day: number) => (day - rangeStart) * dayWidth, [dayWidth, rangeStart])
    const timelineWidth = RANGE_DAYS * dayWidth
    const todayLeft = timelineX(dateDay(today))
    const allVisibleItems = useMemo(() => [...plan.items, ...plan.externalItems], [plan])
    const ranges = useMemo(() => effectiveGanttRanges(allVisibleItems), [allVisibleItems])
    const relationshipItems = plan.items.filter((item) => item.section === "relationship")
    const sharedItems = plan.items.filter((item) => item.section === "shared")
    const relationshipRows = flattenRows(relationshipItems, collapsed)
    const sharedRows = flattenRows(sharedItems, collapsed)
    const externalRows: DisplayRow[] = plan.externalItems.map((item) => ({ item, depth: 0, external: true }))
    const milestoneHeight = plan.milestones.length ? ROOT_ROW_HEIGHT : 0
    const relationshipRowsTop = HEADER_HEIGHT + milestoneHeight
    const rowTop = new Map<string, number>()
    const rowHeights = new Map<string, number>()
    let rowCursor = relationshipRowsTop
    for (const row of relationshipRows) {
        const height = rowHeight(row)
        rowTop.set(row.item.id, rowCursor)
        rowHeights.set(row.item.id, height)
        rowCursor += height
    }
    for (const row of [...sharedRows, ...externalRows]) {
        const height = rowHeight(row)
        rowTop.set(row.item.id, rowCursor)
        rowHeights.set(row.item.id, height)
        rowCursor += height
    }
    const emptyTimeline = !relationshipRows.length && !sharedRows.length && !externalRows.length
    const contentHeight = rowCursor + (emptyTimeline ? EMPTY_LANE_HEIGHT : 0)
    const chartHeight = Math.max(MIN_CHART_HEIGHT, contentHeight)
    const fillerHeight = chartHeight - contentHeight

    const headerLabels = useMemo(() => {
        return Array.from({ length: RANGE_DAYS }, (_, index) => ({ day: rangeStart + index, left: index * dayWidth }))
            .filter(({ day }) => {
                const date = new Date(day * 86_400_000)
                if (scale === "month") return date.getUTCDate() === 1
                if (scale === "week") return date.getUTCDay() === 1
                return true
            })
    }, [dayWidth, rangeStart, scale])

    useEffect(() => {
        if (initiallyCenteredRef.current) return
        const node = scrollRef.current
        if (!node) return
        initiallyCenteredRef.current = true
        node.scrollLeft = Math.max(0, timelineX(dateDay(today)) - (node.clientWidth - DEFAULT_LEFT_WIDTH) / 2)
    }, [timelineX, today])

    const zoomAt = useCallback((clientX: number, requestedZoom: number) => {
        const node = scrollRef.current
        if (!node) return
        const nextZoom = Math.min(MAX_ZOOM, Math.max(1, requestedZoom))
        if (Math.abs(nextZoom - zoom) < .001) return
        const localX = clientX - node.getBoundingClientRect().left
        const timelineDay = (node.scrollLeft + localX - leftWidth) / dayWidth
        setZoom(nextZoom)
        requestAnimationFrame(() => {
            node.scrollLeft = Math.max(0, leftWidth + timelineDay * SCALE_WIDTH[scale] * nextZoom - localX)
        })
    }, [dayWidth, leftWidth, scale, zoom])

    useEffect(() => {
        const node = scrollRef.current
        if (!node) return
        const handleWheel = (event: WheelEvent) => {
            if ((!event.ctrlKey && !event.metaKey) || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || Math.abs(event.deltaY) < .01) return
            event.preventDefault()
            zoomAt(event.clientX, zoom * Math.exp(-event.deltaY * .01))
        }
        node.addEventListener("wheel", handleWheel, { passive: false })
        return () => node.removeEventListener("wheel", handleWheel)
    }, [zoom, zoomAt])

    useEffect(() => () => {
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }, [])

    const reload = useCallback(async () => {
        const next = await loadGanttPlan(workspaceSlug, relationshipId)
        if (next) setPlan(next)
    }, [workspaceSlug, relationshipId])

    // Cross-tab realtime: a successful edit here or in another tab (e.g. the
    // work-item editor) broadcasts, and every open plan for this workspace
    // refetches. This replaces the per-edit full-route router.refresh.
    useEffect(() => {
        if (typeof BroadcastChannel === "undefined") return
        const channel = new BroadcastChannel(ganttSyncChannelName(workspaceSlug))
        channel.onmessage = () => { void reload() }
        return () => channel.close()
    }, [workspaceSlug, reload])

    function refreshAfter(next: GanttMutationResult) {
        setResult(next)
        if (next.status === "saved") { postGanttSync(workspaceSlug); void reload() }
    }

    function mutate(action: () => Promise<GanttMutationResult>) {
        setResult(null)
        startTransition(async () => refreshAfter(await action()))
    }

    function flashInvalid(itemId: string) {
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
        setFlashingItemId(itemId)
        flashTimerRef.current = setTimeout(() => setFlashingItemId(null), 650)
    }

    function scheduleFitsHierarchy(item: RelationshipGanttItem, start: string, due: string) {
        const proposed = { start, end: due }
        if (dateDay(due) < dateDay(start)) { flashInvalid(item.parentWorkItemId ?? item.id); return false }
        if (item.parentWorkItemId) {
            const parentRange = ranges.get(item.parentWorkItemId)
            if (parentRange && !rangeContainsRange(parentRange, proposed)) { flashInvalid(item.parentWorkItemId); return false }
        }
        for (const child of plan.items.filter((candidate) => candidate.parentWorkItemId === item.id)) {
            const childRange = ranges.get(child.id)
            if (childRange && !rangeContainsRange(proposed, childRange)) { flashInvalid(item.id); return false }
        }
        return true
    }

    function applyOptimisticDates(id: string, plannedStartDate: string, dueDate: string, frozenParent?: { id: string; start: string; end: string }) {
        setPlan((current) => ({ ...current, items: current.items.map((item) => {
            if (item.id === id) return { ...item, plannedStartDate, dueDate }
            if (frozenParent && item.id === frozenParent.id) return { ...item, plannedStartDate: frozenParent.start, dueDate: frozenParent.end }
            return item
        }) }))
    }

    function requestSchedule(item: RelationshipGanttItem, start: string, due: string) {
        if (!scheduleFitsHierarchy(item, start, due)) return
        const parent = item.parentWorkItemId ? plan.items.find((candidate) => candidate.id === item.parentWorkItemId) : null
        const parentRange = parent ? ranges.get(parent.id) : null
        const frozenParent = parent && parentRange?.derived ? { id: parent.id, start: parentRange.start, end: parentRange.end } : undefined
        const frozenParentChange: ScheduleChange | null = parent && frozenParent ? {
            id: parent.id,
            title: parent.title,
            plannedStartDate: frozenParent.start,
            plannedStartTime: parent.plannedStartTime,
            dueDate: frozenParent.end,
            dueTime: parent.dueTime,
            expectedUpdatedAt: parent.updatedAt,
        } : null
        // Paint the new position immediately so the bar never snaps back while
        // the server confirms; reload reconciles (or reverts) against the truth.
        applyOptimisticDates(item.id, start, due, frozenParent)
        startTransition(async () => {
            const preview = await previewGanttScheduleChange(workspaceSlug, relationshipId, { id: item.id, plannedStartDate: start, dueDate: due })
            if (preview.status !== "cascade_required") { setResult(preview); void reload(); return }
            const changes = frozenParentChange && !preview.changes.some((change) => change.id === frozenParentChange.id) ? [frozenParentChange, ...preview.changes] : preview.changes
            if (preview.changes.length > 1) { setCascade(changes); return }
            refreshAfter(await applyGanttScheduleChanges(workspaceSlug, relationshipId, changes))
        })
    }

    function startBarDrag(event: ReactPointerEvent<HTMLElement>, item: RelationshipGanttItem, range: { start: string; end: string }, mode: "move" | "start" | "end") {
        if (!canEdit || ["done", "canceled"].includes(item.status)) return
        event.preventDefault()
        event.stopPropagation()
        const barNode = event.currentTarget.closest("[data-gantt-bar]") as HTMLElement | null
        if (!barNode) return
        const originX = event.clientX
        const originalLeft = timelineX(dateDay(range.start)) + BAR_INSET
        const monthWidth = Math.max(dayWidth, (dateDay(addCalendarMonths(range.start, 1)) - dateDay(range.start)) * dayWidth)
        const columnWidth = scale === "month" ? monthWidth : dayWidth * (scale === "week" ? 7 : 1)
        let latestUnits = 0

        const nextDates = (units: number) => {
            if (mode === "move") return { start: shiftDate(range.start, units, scale), due: shiftDate(range.end, units, scale) }
            if (mode === "start") {
                const start = shiftDate(range.start, units, scale)
                return { start: dateDay(start) > dateDay(range.end) ? range.end : start, due: range.end }
            }
            const due = shiftDate(range.end, units, scale)
            return { start: range.start, due: dateDay(due) < dateDay(range.start) ? range.start : due }
        }
        const paint = (units: number) => {
            latestUnits = units
            const next = nextDates(units)
            const nextLeft = timelineX(dateDay(next.start)) + BAR_INSET
            const nextWidth = Math.max(4, (dateDay(next.due) - dateDay(next.start) + 1) * dayWidth - BAR_INSET * 2)
            barNode.style.transform = `translateX(${nextLeft - originalLeft}px)`
            barNode.style.width = `${nextWidth}px`
        }
        const move = (pointer: PointerEvent) => paint(Math.round((pointer.clientX - originX) / columnWidth))
        const finish = () => {
            window.removeEventListener("pointermove", move)
            window.removeEventListener("pointerup", finish)
            barNode.style.transform = ""
            barNode.style.width = ""
            if (!latestUnits) return
            const next = nextDates(latestUnits)
            requestSchedule(item, next.start, next.due)
        }
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", finish)
    }

    function goToToday() {
        const node = scrollRef.current
        if (!node) return
        node.scrollTo({ left: Math.max(0, todayLeft - (node.clientWidth - leftWidth) / 2), behavior: "smooth" })
    }

    function selectScale(nextScale: Scale) {
        setZoom(1)
        setScale(nextScale)
        requestAnimationFrame(() => {
            const node = scrollRef.current
            if (node) node.scrollLeft = Math.max(0, (dateDay(today) - rangeStart) * SCALE_WIDTH[nextScale] - (node.clientWidth - leftWidth) / 2)
        })
    }

    function updateTouchPoint(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.pointerType !== "touch") return
        touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        const points = [...touchPointsRef.current.values()]
        if (points.length !== 2) return
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
        const centerX = (points[0].x + points[1].x) / 2
        const centerY = (points[0].y + points[1].y) / 2
        if (!pinchRef.current) {
            pinchRef.current = { distance, zoom, centerX, centerY, active: false }
            return
        }
        const distanceChange = Math.abs(distance - pinchRef.current.distance)
        const centerTravel = Math.hypot(centerX - pinchRef.current.centerX, centerY - pinchRef.current.centerY)
        if (!pinchRef.current.active) {
            if (distanceChange < 8 || distanceChange <= centerTravel * 1.25) return
            pinchRef.current.active = true
        }
        event.preventDefault()
        zoomAt(centerX, pinchRef.current.zoom * distance / pinchRef.current.distance)
    }

    function endTouch(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.pointerType !== "touch") return
        touchPointsRef.current.delete(event.pointerId)
        if (touchPointsRef.current.size < 2) pinchRef.current = null
    }

    function startDividerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
        if (window.matchMedia("(max-width: 1023px)").matches) return
        event.preventDefault()
        event.stopPropagation()
        const originX = event.clientX
        const originWidth = leftWidth
        const move = (pointer: PointerEvent) => setLeftWidth(Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, originWidth + pointer.clientX - originX)))
        const finish = () => {
            window.removeEventListener("pointermove", move)
            window.removeEventListener("pointerup", finish)
        }
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", finish)
    }

    function renderLeft(row: DisplayRow) {
        const isRoot = row.depth === 0
        const hasChildren = isRoot && plan.items.some((item) => item.parentWorkItemId === row.item.id)
        return <div
            className="sticky left-0 z-40 flex min-w-0 items-center justify-end gap-1.5 border-b border-r border-b-neutral-800 border-r-neutral-700 bg-neutral-950 px-2"
            style={{ height: `${rowHeight(row)}px` }}
        >
            {hasChildren ? <button
                type="button"
                aria-label={`${collapsed.has(row.item.id) ? "Expand" : "Collapse"} ${row.item.title}`}
                aria-expanded={!collapsed.has(row.item.id)}
                onClick={() => setCollapsed((current) => {
                    const next = new Set(current)
                    if (next.has(row.item.id)) next.delete(row.item.id)
                    else next.add(row.item.id)
                    return next
                })}
                className="flex h-6 w-5 shrink-0 items-center justify-center text-neutral-500 hover:text-white"
            ><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`h-3.5 w-3.5 transition-transform ${collapsed.has(row.item.id) ? "" : "rotate-90"}`}><path d="m6 3 5 5-5 5" /></svg></button> : isRoot ? <span className="w-5 shrink-0" /> : null}
            <span className={`min-w-0 flex-1 truncate whitespace-nowrap text-right text-neutral-200 ${isRoot ? "text-sm font-semibold" : "text-xs font-normal"}`} title={row.item.title}>{row.item.title}</span>
        </div>
    }

    function renderTimeline(row: DisplayRow) {
        const item = row.item
        const height = rowHeight(row)
        const barHeight = row.depth === 0 ? ROOT_BAR_HEIGHT : CHILD_BAR_HEIGHT
        const range = ranges.get(item.id) ?? (row.external && item.plannedStartDate ? { start: item.plannedStartDate, end: item.dueDate ?? item.plannedStartDate, derived: false } : null)
        const colours = relationshipPhaseColours(item.lifecyclePhase)
        const flashing = flashingItemId === item.id
        const barBorder = flashing ? "#ef4444" : colours.border
        const canDrag = canEdit && !row.external && !["done", "canceled"].includes(item.status)
        const handleSpace = canDrag ? RESIZE_HANDLE_WIDTH : 0
        return <div
            className="relative border-b border-neutral-800"
            style={{ height: `${height}px` }}
        >
            {range ? <div
                data-gantt-bar
                className={`absolute z-20 flex touch-none select-none items-center gap-1.5 overflow-hidden rounded-md border pl-1.5 transition-[border-color,box-shadow] ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${row.depth > 0 ? "border-dashed" : ""}`}
                style={{ top: `${(height - barHeight) / 2}px`, height: `${barHeight}px`, paddingLeft: `${handleSpace + 6}px`, paddingRight: `${barHeight + handleSpace + 4}px`, left: `${timelineX(dateDay(range.start)) + BAR_INSET}px`, width: `${Math.max(4, (dateDay(range.end) - dateDay(range.start) + 1) * dayWidth - BAR_INSET * 2)}px`, borderColor: barBorder, backgroundColor: colours.background, color: colours.text, boxShadow: flashing ? "0 0 0 2px rgba(239,68,68,.6)" : undefined }}
                onPointerDown={(event) => startBarDrag(event, item, range, "move")}
                title={`${item.title}: ${range.start} → ${range.end}`}
            >
                {item.actualStartAt ? <span className="absolute inset-y-0 left-0 rounded-l-md opacity-45" style={{ width: `${Math.min(100, Math.max(8, ((dateDay((item.actualCompletedAt ?? today).slice(0, 10)) - dateDay(range.start) + 1) / Math.max(1, dateDay(range.end) - dateDay(range.start) + 1)) * 100))}%`, backgroundColor: colours.text }} /> : null}
                {canDrag ? <button type="button" aria-label={`Resize start of ${item.title}`} onPointerDown={(event) => startBarDrag(event, item, range, "start")} className="absolute inset-y-0 left-0 z-20 cursor-ew-resize rounded-l-md" style={{ width: `${RESIZE_HANDLE_WIDTH}px`, backgroundColor: barBorder }} /> : null}
                {item.assignees[0] ? <div className="relative flex shrink-0 items-center gap-1"><Assignee name={item.assignees[0].username} avatarSrc={item.assignees[0].avatarUrl} compact compactSize={row.depth === 0 ? "md" : "sm"} />{item.assignees.length > 1 ? <span className={`shrink-0 font-medium ${row.depth === 0 ? "text-xs" : "text-[9px]"}`}>+{item.assignees.length - 1}</span> : null}</div> : null}
                <span className={`relative min-w-0 flex-1 truncate leading-none ${row.depth === 0 ? "text-sm font-semibold" : "text-[11px] font-normal"}`}>{item.title}</span>
                <Link href={`/${workspaceSlug}/work-items/${item.id}`} aria-label={`Open ${item.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} className="absolute inset-y-0 z-10 flex items-center justify-center border-l" style={{ right: `${handleSpace}px`, width: `${barHeight}px`, borderColor: barBorder, color: barBorder }}><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={row.depth === 0 ? "h-[22px] w-[22px]" : "h-[18px] w-[18px]"}><path d="M5 11 11 5M6 5h5v5" /></svg></Link>
                {canDrag ? <button type="button" aria-label={`Resize end of ${item.title}`} onPointerDown={(event) => startBarDrag(event, item, range, "end")} className="absolute inset-y-0 right-0 z-20 cursor-ew-resize rounded-r-md" style={{ width: `${RESIZE_HANDLE_WIDTH}px`, backgroundColor: barBorder }} /> : null}
            </div> : null}
        </div>
    }

    const dependencyPaths = plan.dependencies.flatMap((edge) => {
        const fromTop = rowTop.get(edge.dependsOnWorkItemId)
        const toTop = rowTop.get(edge.workItemId)
        const fromRange = ranges.get(edge.dependsOnWorkItemId)
        const toRange = ranges.get(edge.workItemId)
        const fromHeight = rowHeights.get(edge.dependsOnWorkItemId)
        const toHeight = rowHeights.get(edge.workItemId)
        if (fromTop === undefined || toTop === undefined || fromHeight === undefined || toHeight === undefined || !fromRange || !toRange) return []
        const sourceBarLeft = timelineX(dateDay(fromRange.start)) + BAR_INSET
        const sourceBarWidth = Math.max(4, (dateDay(fromRange.end) - dateDay(fromRange.start) + 1) * dayWidth - BAR_INSET * 2)
        const sourceDivider = timelineX(dateDay(fromRange.end) + 1)
        const sourceBarRight = sourceBarLeft + sourceBarWidth
        const targetDivider = timelineX(dateDay(toRange.start))
        const targetBarLeft = targetDivider + BAR_INSET
        const y1 = fromTop + fromHeight / 2
        const y2 = toTop + toHeight / 2
        const yTrack = y2 >= y1 ? fromTop + fromHeight : fromTop
        return [{ edge, path: `M ${sourceBarRight} ${y1} H ${sourceDivider} V ${yTrack} H ${targetDivider} V ${y2} H ${targetBarLeft}`, arrow: `M ${targetBarLeft - 4} ${y2 - 4} L ${targetBarLeft} ${y2} L ${targetBarLeft - 4} ${y2 + 4}` }]
    })

    return <section id="plan" className="relative isolate mt-4 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900/70">
        <div className="absolute right-3 top-1.5 z-[70] flex items-center gap-1.5">
            <button type="button" onClick={goToToday} className="h-8 rounded-full bg-white px-3 text-xs font-semibold text-neutral-950 shadow-sm">Today</button>
            {([['day', 'd'], ['week', 'w'], ['month', 'mo']] as const).map(([value, label]) => <button
                type="button"
                key={value}
                onClick={() => selectScale(value)}
                aria-label={`${value} view`}
                aria-pressed={scale === value}
                className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-medium text-white backdrop-blur-sm ${scale === value ? "border-neutral-400 bg-neutral-600/35" : "border-neutral-600 bg-neutral-800/20 hover:border-neutral-400 hover:bg-neutral-700/30"}`}
            >{label}</button>)}
        </div>
        <div
            ref={scrollRef}
            className="relative min-h-[28rem] max-h-[calc(100vh-18rem)] overflow-auto overscroll-contain"
            style={{ touchAction: "pan-x pan-y" }}
            onPointerDown={updateTouchPoint}
            onPointerMove={updateTouchPoint}
            onPointerUp={endTouch}
            onPointerCancel={endTouch}
            title="Pinch or use Ctrl/Cmd + wheel to zoom"
        >
            <div className="grid" style={{ gridTemplateColumns: `${leftWidth}px ${timelineWidth}px`, minWidth: `${leftWidth + timelineWidth}px` }}>
                <div className="sticky left-0 top-0 z-50 flex h-11 items-center border-b border-r border-neutral-700 bg-neutral-950 px-3 text-sm font-semibold text-white">
                    Relationship Timeline
                    <button type="button" aria-label="Resize timeline label column" title="Drag to resize" onPointerDown={startDividerDrag} className="group absolute -right-1.5 inset-y-0 hidden w-3 cursor-col-resize touch-none lg:block"><span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-neutral-400" /></button>
                </div>
                <div className="sticky top-0 z-40 h-11 border-b border-neutral-700 bg-neutral-950">
                    {headerLabels.map((label) => <span key={label.day} className="absolute top-0 flex h-full items-center border-l border-neutral-800 px-1 text-[10px] text-neutral-500" style={{ left: `${label.left}px` }}>{dateLabel(label.day, scale)}</span>)}
                    <span className="absolute inset-y-0 z-10 w-px bg-red-400/60" style={{ left: `${todayLeft}px` }} />
                </div>
                {plan.milestones.length ? <><div aria-hidden="true" className="sticky left-0 z-40 border-b border-r border-b-neutral-800 border-r-neutral-700 bg-neutral-950" style={{ height: `${ROOT_ROW_HEIGHT}px` }} /><div className="relative border-b border-neutral-800" style={{ height: `${ROOT_ROW_HEIGHT}px` }}>{plan.milestones.map((milestone) => { const left = (dateDay(milestone.occurredAt.slice(0, 10)) - rangeStart) * dayWidth; const marker = <span className="block h-3 w-3 rotate-45 border border-emerald-400 bg-emerald-950" />; return milestone.href ? <a key={milestone.id} href={milestone.href} title={`${milestone.title} · ${milestone.occurredAt.slice(0, 10)}`} className="absolute" style={{ left, top: `${(ROOT_ROW_HEIGHT - 12) / 2}px` }}>{marker}</a> : <span key={milestone.id} title={`${milestone.title} · ${milestone.occurredAt.slice(0, 10)}`} className="absolute" style={{ left, top: `${(ROOT_ROW_HEIGHT - 12) / 2}px` }}>{marker}</span> })}</div></> : null}
                {relationshipRows.map((row) => <div className="contents" key={`relationship-${row.item.id}`}>{renderLeft(row)}{renderTimeline(row)}</div>)}
                {[...sharedRows, ...externalRows].map((row) => <div className="contents" key={`shared-${row.item.id}`}>{renderLeft(row)}{renderTimeline(row)}</div>)}
                {emptyTimeline ? <div className="contents"><div aria-hidden="true" className="sticky left-0 z-40 h-24 border-b border-r border-b-neutral-800 border-r-neutral-700 bg-neutral-950" /><div className="relative h-24 border-b border-neutral-800"><span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-neutral-600">Nothing scheduled</span></div></div> : null}
                {fillerHeight ? <div className="contents"><div aria-hidden="true" className="sticky left-0 z-40 border-r border-neutral-700 bg-neutral-950" style={{ height: `${fillerHeight}px` }} /><div aria-hidden="true" style={{ height: `${fillerHeight}px` }} /></div> : null}
            </div>
            {headerLabels.map((label) => <div aria-hidden="true" key={`column-${label.day}`} className="pointer-events-none absolute z-10 w-px bg-neutral-800" style={{ left: `${leftWidth + label.left}px`, top: `${HEADER_HEIGHT}px`, height: `${chartHeight - HEADER_HEIGHT}px` }} />)}
            <div className="pointer-events-none absolute z-20 w-px bg-red-400/70" style={{ left: `${leftWidth + todayLeft}px`, top: `${HEADER_HEIGHT}px`, height: `${chartHeight - HEADER_HEIGHT}px` }} />
            <svg aria-hidden="true" className="pointer-events-none absolute top-0 z-30 overflow-visible" style={{ left: `${leftWidth}px` }} width={timelineWidth} height={chartHeight}>{dependencyPaths.map(({ edge, path, arrow }) => <g key={`${edge.workItemId}-${edge.dependsOnWorkItemId}`} fill="none" stroke={STRUCTURAL_LINE} strokeWidth="1.5" strokeLinejoin="miter" strokeLinecap="square"><path d={path} /><path d={arrow} /></g>)}</svg>
        </div>
        <MutationError result={result} />
        {cascade ? <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-950 p-4 shadow-2xl"><h3 className="font-semibold text-white">Move dependent work?</h3><p className="mt-1 text-sm text-neutral-400">This schedule change affects {cascade.length} work items.</p><div className="mt-3 max-h-72 divide-y divide-neutral-900 overflow-y-auto rounded-lg border border-neutral-800">{cascade.map((change) => <div key={change.id} className="flex justify-between gap-3 px-3 py-2 text-sm"><span className="truncate text-neutral-200">{change.title}</span><span className="shrink-0 text-neutral-500">{change.plannedStartDate} → {change.dueDate}</span></div>)}</div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => { setCascade(null); void reload() }} className="h-9 px-3 text-sm text-neutral-400 hover:text-white">Cancel</button><button type="button" disabled={pending} onClick={() => { const changes = cascade; setCascade(null); mutate(() => applyGanttScheduleChanges(workspaceSlug, relationshipId, changes)) }} className="h-9 rounded-md bg-white px-3 text-sm font-medium text-black">Confirm changes</button></div></div></div> : null}
    </section>
}
