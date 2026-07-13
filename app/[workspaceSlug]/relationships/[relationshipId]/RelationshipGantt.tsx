"use client"

import Link from "next/link"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { createPortal, flushSync } from "react-dom"
import { Assignee, Status, relationshipPhaseColours } from "@/components/ui"
import { ganttSyncChannelName, postGanttSync } from "@/lib/ui/gantt-sync"
import { ganttAnchoredScrollLeft, ganttArrowHeadPath, ganttDragDayDelta } from "@/lib/ui/gantt-geometry"
import { addCalendarDays, dateDay, effectiveGanttRanges, ganttTimelineRange, rangeContainsRange, type ScheduleChange } from "@/lib/relationship-gantt-schedule"
import type { RelationshipGanttItem, RelationshipGanttPlan } from "@/lib/relationship-gantt"
import {
    applyGanttScheduleChanges,
    loadGanttPlan,
    previewGanttScheduleChange,
    type GanttMutationResult,
} from "./gantt-actions"

type Scale = "day" | "week" | "month"
type Category = "scheduled" | "shared" | "unscheduled"
type DisplayRow = { item: RelationshipGanttItem; depth: number; category: Category; external?: boolean }
type DragPreview = {
    itemId: string
    pointerX: number
    pointerY: number
    label: string
    changes: Map<string, { start: string; end: string }>
}

const ROOT_ROW_HEIGHT = 48
const CHILD_ROW_HEIGHT = 32
const ROOT_BAR_HEIGHT = 32
const CHILD_BAR_HEIGHT = 24
const HEADER_HEIGHT = 44
const CATEGORY_ROW_HEIGHT = 28
const MIN_LEFT_WIDTH = 220
const DEFAULT_LEFT_WIDTH = 260
const MAX_LEFT_WIDTH = 360
const DEFAULT_ZOOM = 2
const MIN_ZOOM = .25
const MAX_ZOOM = 6
const BAR_INSET = 8
const STRUCTURAL_LINE = "#858585"
const ACTIVE_STRUCTURAL_LINE = "#b8b8b8"
const CATEGORY_BACKGROUND = "repeating-linear-gradient(135deg, transparent 0 14px, #262626 14px 15px)"
const SCALE_WIDTH: Record<Scale, number> = { day: 64, week: 28, month: 12 }

function dateLabel(day: number, scale: Scale) {
    const date = new Date(day * 86_400_000)
    return new Intl.DateTimeFormat("en-IE", scale === "month" ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" }).format(date)
}

function localDateValue(date = new Date()) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

function rowHeight(row: DisplayRow) {
    return row.depth === 0 ? ROOT_ROW_HEIGHT : CHILD_ROW_HEIGHT
}

function fixedRowStyle(height: number): CSSProperties {
    return { boxSizing: "border-box", height: `${height}px`, minHeight: `${height}px`, maxHeight: `${height}px` }
}

function flattenRows(items: RelationshipGanttItem[], collapsed: Set<string>, category: Category) {
    const byId = new Map(items.map((item) => [item.id, item]))
    const children = new Map<string, RelationshipGanttItem[]>()
    for (const item of items) if (item.parentWorkItemId && byId.has(item.parentWorkItemId)) children.set(item.parentWorkItemId, [...(children.get(item.parentWorkItemId) ?? []), item])
    for (const rows of children.values()) rows.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
    const roots = items.filter((item) => !item.parentWorkItemId || !byId.has(item.parentWorkItemId)).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
    const output: DisplayRow[] = []
    const visit = (item: RelationshipGanttItem, depth: number) => {
        output.push({ item, depth, category })
        if (collapsed.has(item.id)) return
        for (const child of children.get(item.id) ?? []) visit(child, depth + 1)
    }
    for (const root of roots) visit(root, 0)
    return output
}

function MutationError({ result }: { result: GanttMutationResult | null }) {
    if (!result || result.status === "saved" || result.status === "cascade_required") return null
    return <p role="status" aria-live="polite" className="border-t border-red-500/20 px-3 py-2 text-xs text-red-300">{result.message}</p>
}

function Icon({ kind }: { kind: "fit" | "minus" | "plus" | "labels" }) {
    const path = kind === "fit"
        ? <><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" /><path d="M6 10h8" /></>
        : kind === "plus"
            ? <path d="M10 4v12M4 10h12" />
            : kind === "minus"
                ? <path d="M4 10h12" />
                : <><path d="M3 4h14v12H3z" /><path d="M8 4v12" /></>
    return <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">{path}</svg>
}

export function RelationshipGantt({ workspaceSlug, relationshipId, plan: initialPlan, canEdit }: {
    workspaceSlug: string
    relationshipId: string
    plan: RelationshipGanttPlan
    canEdit: boolean
}) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const initiallyCenteredRef = useRef(false)
    const mobileZoomInitialisedRef = useRef(false)
    const previousGeometryRef = useRef<{ leftWidth: number; rangeStart: number } | null>(null)
    const zoomAnchorRef = useRef<{ timelineDay: number; localX: number; scrollTop: number } | null>(null)
    const touchPointsRef = useRef(new Map<number, { x: number; y: number }>())
    const touchPanRef = useRef<{ pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)
    const touchZoomOnlyRef = useRef(false)
    const pinchRef = useRef<{ distance: number; zoom: number; timelineDay: number; localX: number; scrollTop: number } | null>(null)
    const pinchReleaseFrameRef = useRef<number | null>(null)
    // The plan is held locally so edits can be painted optimistically and so
    // cross-tab changes can refresh it without a full route reload.
    const [plan, setPlan] = useState(initialPlan)
    const [scale, setScale] = useState<Scale>("week")
    const [zoom, setZoom] = useState(DEFAULT_ZOOM)
    const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH)
    const [isNarrow, setIsNarrow] = useState(false)
    const [labelsVisible, setLabelsVisible] = useState(true)
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
    const [collapsedCategories, setCollapsedCategories] = useState<Set<Category>>(() => new Set(["shared", "unscheduled"]))
    const [pinching, setPinching] = useState(false)
    const [activeItemId, setActiveItemId] = useState<string | null>(null)
    const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
    const [flashingItemId, setFlashingItemId] = useState<string | null>(null)
    const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [cascade, setCascade] = useState<ScheduleChange[] | null>(null)
    const [result, setResult] = useState<GanttMutationResult | null>(null)
    const [pending, startTransition] = useTransition()

    // The server can stream a refreshed plan into this long-lived client view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { setPlan(initialPlan) }, [initialPlan])

    useEffect(() => {
        const media = window.matchMedia("(max-width: 767px)")
        const update = () => setIsNarrow(media.matches)
        update()
        media.addEventListener("change", update)
        return () => media.removeEventListener("change", update)
    }, [])

    const dayWidth = SCALE_WIDTH[scale] * zoom
    const today = localDateValue()
    const requestedTimelineRange = useMemo(() => ganttTimelineRange(
        [...plan.items, ...plan.externalItems],
        plan.milestones.map((milestone) => milestone.occurredAt),
        today,
    ), [plan, today])
    const timelineRange = requestedTimelineRange
    const rangeStart = timelineRange.start
    const rangeDays = timelineRange.days
    const effectiveLeftWidth = isNarrow ? (labelsVisible ? 152 : 0) : leftWidth
    const timelineX = useCallback((day: number) => (day - rangeStart) * dayWidth, [dayWidth, rangeStart])
    const timelineWidth = rangeDays * dayWidth
    const todayLeft = timelineX(dateDay(today))
    // Bars span their actual start→due dates (the due day is inclusive, so the
    // bar reaches the end of that day) rather than snapping to whole columns,
    // which previously made every bar fill its week or month at coarse scales.
    const barGeometry = useCallback((range: { start: string; end: string }) => {
        const columnLeft = timelineX(dateDay(range.start))
        const columnRight = timelineX(dateDay(range.end) + 1)
        const inset = Math.min(BAR_INSET, Math.max(1, dayWidth * .15))
        return { left: columnLeft + inset, right: columnRight - inset, width: Math.max(4, columnRight - columnLeft - inset * 2), sourceDivider: columnRight, targetDivider: columnLeft }
    }, [dayWidth, timelineX])
    const committedItems = useMemo(() => [...plan.items, ...plan.externalItems], [plan])
    const committedRanges = useMemo(() => effectiveGanttRanges(committedItems), [committedItems])
    const allVisibleItems = useMemo(() => committedItems.map((item) => {
        const preview = dragPreview?.changes.get(item.id)
        return preview ? { ...item, plannedStartDate: preview.start, dueDate: preview.end } : item
    }), [committedItems, dragPreview])
    const ranges = useMemo(() => effectiveGanttRanges(allVisibleItems), [allVisibleItems])
    const scheduledItems = plan.items.filter((item) => item.section === "relationship" && committedRanges.has(item.id))
    const sharedItems = plan.items.filter((item) => item.section === "shared" && committedRanges.has(item.id))
    const unscheduledItems = plan.items.filter((item) => !committedRanges.has(item.id))
    const scheduledRows = collapsedCategories.has("scheduled") ? [] : flattenRows(scheduledItems, collapsed, "scheduled")
    const sharedRows = collapsedCategories.has("shared") ? [] : flattenRows(sharedItems, collapsed, "shared")
    const unscheduledRows = collapsedCategories.has("unscheduled") ? [] : flattenRows(unscheduledItems, collapsed, "unscheduled")
    const scheduledExternalRows: DisplayRow[] = collapsedCategories.has("shared") ? [] : [...plan.externalItems]
        .filter((item) => committedRanges.has(item.id))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
        .map((item) => ({ item, depth: 0, category: "shared", external: true }))
    const unscheduledExternalRows: DisplayRow[] = collapsedCategories.has("unscheduled") ? [] : [...plan.externalItems]
        .filter((item) => !committedRanges.has(item.id))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
        .map((item) => ({ item, depth: 0, category: "unscheduled", external: true }))
    const categoryRows: Array<{ category: Category; rows: DisplayRow[] }> = [
        { category: "scheduled", rows: scheduledRows },
        { category: "shared", rows: [...sharedRows, ...scheduledExternalRows] },
        { category: "unscheduled", rows: [...unscheduledRows, ...unscheduledExternalRows] },
    ]
    const rowTop = new Map<string, number>()
    const rowHeights = new Map<string, number>()
    let rowCursor = HEADER_HEIGHT + CATEGORY_ROW_HEIGHT
    for (const group of categoryRows) {
        rowCursor += CATEGORY_ROW_HEIGHT
        for (const row of group.rows) {
            const height = rowHeight(row)
            rowTop.set(row.item.id, rowCursor)
            rowHeights.set(row.item.id, height)
            rowCursor += height
        }
    }
    const contentHeight = rowCursor
    const chartHeight = contentHeight

    const headerLabels = useMemo(() => {
        return Array.from({ length: rangeDays }, (_, index) => ({ day: rangeStart + index, left: index * dayWidth }))
            .filter(({ day }) => {
                const date = new Date(day * 86_400_000)
                if (scale === "month") return date.getUTCDate() === 1
                if (scale === "week") return date.getUTCDay() === 1
                return true
            })
    }, [dayWidth, rangeDays, rangeStart, scale])
    const weekendDays = useMemo(() => Array.from({ length: rangeDays }, (_, index) => rangeStart + index).filter((day) => {
        const weekday = new Date(day * 86_400_000).getUTCDay()
        return weekday === 0 || weekday === 6
    }), [rangeDays, rangeStart])

    useEffect(() => {
        if (initiallyCenteredRef.current) return
        const node = scrollRef.current
        if (!node) return
        initiallyCenteredRef.current = true
        const planDays = [...ranges.values()].flatMap((range) => [dateDay(range.start), dateDay(range.end)])
        const targetDay = planDays.length && (Math.max(...planDays) < dateDay(today) - 14 || Math.min(...planDays) > dateDay(today) + 14)
            ? (Math.min(...planDays) + Math.max(...planDays)) / 2
            : dateDay(today)
        node.scrollLeft = Math.max(0, timelineX(targetDay) - (node.clientWidth - effectiveLeftWidth) / 2)
    }, [effectiveLeftWidth, ranges, timelineX, today])

    useEffect(() => {
        const previous = previousGeometryRef.current
        const node = scrollRef.current
        if (previous && node && !zoomAnchorRef.current) node.scrollLeft = Math.max(0, node.scrollLeft + effectiveLeftWidth - previous.leftWidth + (previous.rangeStart - rangeStart) * dayWidth)
        previousGeometryRef.current = { leftWidth: effectiveLeftWidth, rangeStart }
    }, [dayWidth, effectiveLeftWidth, rangeStart])

    useLayoutEffect(() => {
        const anchor = zoomAnchorRef.current
        const node = scrollRef.current
        if (!anchor || !node) return
        node.scrollLeft = ganttAnchoredScrollLeft({ timelineDay: anchor.timelineDay, dayWidth, leftWidth: effectiveLeftWidth, localX: anchor.localX })
        node.scrollTop = anchor.scrollTop
        zoomAnchorRef.current = null
    }, [dayWidth, effectiveLeftWidth])

    const zoomAt = useCallback((clientX: number, requestedZoom: number) => {
        const node = scrollRef.current
        if (!node) return
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, requestedZoom))
        if (Math.abs(nextZoom - zoom) < .001) return
        const localX = clientX - node.getBoundingClientRect().left
        const timelineDay = (node.scrollLeft + localX - effectiveLeftWidth) / dayWidth
        zoomAnchorRef.current = { timelineDay, localX, scrollTop: node.scrollTop }
        setZoom(nextZoom)
    }, [dayWidth, effectiveLeftWidth, zoom])

    const zoomAtTimelineCentre = useCallback((requestedZoom: number) => {
        const node = scrollRef.current
        if (!node) return
        const timelineCentre = effectiveLeftWidth + Math.max(0, node.clientWidth - effectiveLeftWidth) / 2
        zoomAt(node.getBoundingClientRect().left + timelineCentre, requestedZoom)
    }, [effectiveLeftWidth, zoomAt])

    useEffect(() => {
        if (!isNarrow || mobileZoomInitialisedRef.current || zoom !== DEFAULT_ZOOM) return
        const node = scrollRef.current
        if (!node) return
        mobileZoomInitialisedRef.current = true
        zoomAtTimelineCentre(.5)
    }, [isNarrow, zoom, zoomAtTimelineCentre])

    useEffect(() => {
        const node = scrollRef.current
        if (!node) return
        const handleWheel = (event: WheelEvent) => {
            if ((!event.ctrlKey && !event.metaKey) || Math.abs(event.deltaY) < .01) return
            event.preventDefault()
            event.stopPropagation()
            zoomAt(event.clientX, zoom * Math.exp(-event.deltaY * .01))
        }
        node.addEventListener("wheel", handleWheel, { passive: false })
        return () => node.removeEventListener("wheel", handleWheel)
    }, [zoom, zoomAt])

    useEffect(() => () => {
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
        if (pinchReleaseFrameRef.current !== null) cancelAnimationFrame(pinchReleaseFrameRef.current)
    }, [])

    const reload = useCallback(async () => {
        const next = await loadGanttPlan(workspaceSlug, relationshipId)
        if (next) setPlan(next)
    }, [workspaceSlug, relationshipId])

    // Back/forward navigation can restore an older App Router payload. Always
    // reconcile a newly mounted chart with the database before trusting it.
    useEffect(() => {
        const frame = requestAnimationFrame(() => { void reload() })
        const reconcileRestoredPage = (event: PageTransitionEvent) => { if (event.persisted) void reload() }
        window.addEventListener("pageshow", reconcileRestoredPage)
        return () => {
            cancelAnimationFrame(frame)
            window.removeEventListener("pageshow", reconcileRestoredPage)
        }
    }, [reload])

    useEffect(() => {
        if (!cascade) return
        const parentDocument = window.parent !== window ? window.parent.document : document
        const close = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return
            setCascade(null)
            void reload()
        }
        parentDocument.addEventListener("keydown", close)
        return () => parentDocument.removeEventListener("keydown", close)
    }, [cascade, reload])

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
        if (next.status === "saved") {
            if (next.plan) setPlan(next.plan)
            else void reload()
            postGanttSync(workspaceSlug)
        }
    }

    function mutate(action: () => Promise<GanttMutationResult>) {
        setResult(null)
        startTransition(async () => refreshAfter(await action()))
    }

    function flashInvalid(itemId: string, message: string) {
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
        setFlashingItemId(itemId)
        setResult({ status: "invalid", message })
        flashTimerRef.current = setTimeout(() => setFlashingItemId(null), 650)
    }

    function scheduleFitsHierarchy(item: RelationshipGanttItem, start: string, due: string, movingDescendants = false) {
        const proposed = { start, end: due }
        if (dateDay(due) < dateDay(start)) { flashInvalid(item.parentWorkItemId ?? item.id, "The end date cannot be before the start date."); return false }
        if (item.parentWorkItemId) {
            const parentRange = ranges.get(item.parentWorkItemId)
            const parent = plan.items.find((candidate) => candidate.id === item.parentWorkItemId)
            if (parentRange && !rangeContainsRange(parentRange, proposed)) { flashInvalid(item.parentWorkItemId, `Keep this work inside ${parent?.title ?? "its parent"}: ${parentRange.start}–${parentRange.end}.`); return false }
        }
        if (!movingDescendants) {
            for (const child of plan.items.filter((candidate) => candidate.parentWorkItemId === item.id)) {
                const childRange = ranges.get(child.id)
                if (childRange && !rangeContainsRange(proposed, childRange)) { flashInvalid(item.id, `The new range must still contain ${child.title}: ${childRange.start}–${childRange.end}.`); return false }
            }
        }
        return true
    }

    function descendantScheduleChanges(itemId: string, days: number) {
        const output: ScheduleChange[] = []
        const visit = (parentId: string) => {
            for (const child of plan.items.filter((candidate) => candidate.parentWorkItemId === parentId)) {
                if (child.plannedStartDate) output.push({
                    id: child.id,
                    title: child.title,
                    plannedStartDate: addCalendarDays(child.plannedStartDate, days),
                    plannedStartTime: child.plannedStartTime,
                    dueDate: addCalendarDays(child.dueDate ?? child.plannedStartDate, days),
                    dueTime: child.dueTime,
                    expectedUpdatedAt: child.updatedAt,
                })
                visit(child.id)
            }
        }
        visit(itemId)
        return output
    }

    function applyOptimisticDates(changes: Array<{ id: string; plannedStartDate: string; dueDate: string }>, frozenParent?: { id: string; start: string; end: string }) {
        const changesById = new Map(changes.map((change) => [change.id, change]))
        setPlan((current) => ({ ...current, items: current.items.map((item) => {
            const change = changesById.get(item.id)
            if (change) return { ...item, plannedStartDate: change.plannedStartDate, dueDate: change.dueDate }
            if (frozenParent && item.id === frozenParent.id) return { ...item, plannedStartDate: frozenParent.start, dueDate: frozenParent.end }
            return item
        }) }))
    }

    function requestSchedule(item: RelationshipGanttItem, start: string, due: string, descendantChanges: ScheduleChange[] = []) {
        setResult(null)
        if (!scheduleFitsHierarchy(item, start, due, descendantChanges.length > 0)) return
        // A summary bar has no dates of its own — its range is derived from its
        // children. Moving it must shift the children, never pin explicit dates
        // onto the parent, so it keeps re-deriving as those children change.
        const summaryDrag = ranges.get(item.id)?.derived === true
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
        applyOptimisticDates([{ id: item.id, plannedStartDate: start, dueDate: due }, ...descendantChanges.map((change) => ({ id: change.id, plannedStartDate: change.plannedStartDate!, dueDate: change.dueDate! }))], frozenParent)
        startTransition(async () => {
            const preview = await previewGanttScheduleChange(workspaceSlug, relationshipId, { id: item.id, plannedStartDate: start, dueDate: due })
            if (preview.status !== "cascade_required") { setResult(preview); void reload(); return }
            const merged = new Map(preview.changes.map((change) => [change.id, change]))
            for (const change of descendantChanges) merged.set(change.id, change)
            if (summaryDrag) merged.delete(item.id)
            if (frozenParentChange && !merged.has(frozenParentChange.id)) merged.set(frozenParentChange.id, frozenParentChange)
            const changes = [...merged.values()]
            if (!changes.length) { void reload(); return }
            if (changes.length > 1) { setCascade(changes); return }
            refreshAfter(await applyGanttScheduleChanges(workspaceSlug, relationshipId, changes))
        })
    }

    function startBarDrag(event: ReactPointerEvent<HTMLElement>, item: RelationshipGanttItem, range: { start: string; end: string }, mode: "move" | "start" | "end") {
        if (!canEdit || pending || ["done", "canceled"].includes(item.status)) return
        event.preventDefault()
        event.stopPropagation()
        const originX = event.clientX
        let latestDays = 0

        const nextDates = (days: number) => {
            if (mode === "move") return { start: addCalendarDays(range.start, days), due: addCalendarDays(range.end, days) }
            if (mode === "start") {
                const start = addCalendarDays(range.start, days)
                return { start: dateDay(start) > dateDay(range.end) ? range.end : start, due: range.end }
            }
            const due = addCalendarDays(range.end, days)
            return { start: range.start, due: dateDay(due) < dateDay(range.start) ? range.start : due }
        }
        const paint = (days: number, pointer: PointerEvent) => {
            if (days === latestDays && dragPreview) return
            latestDays = days
            const next = nextDates(days)
            const descendantChanges = mode === "move" ? descendantScheduleChanges(item.id, days) : []
            const changes = new Map<string, { start: string; end: string }>([[item.id, { start: next.start, end: next.due }]])
            for (const change of descendantChanges) if (change.plannedStartDate && change.dueDate) changes.set(change.id, { start: change.plannedStartDate, end: change.dueDate })
            setDragPreview({ itemId: item.id, pointerX: pointer.clientX, pointerY: pointer.clientY, label: `${next.start} → ${next.due}`, changes })
        }
        const move = (pointer: PointerEvent) => {
            if (pointer.pointerType === "touch" && touchZoomOnlyRef.current) {
                latestDays = 0
                setDragPreview(null)
                return
            }
            paint(ganttDragDayDelta(pointer.clientX - originX, dayWidth), pointer)
        }
        const cleanup = () => {
            window.removeEventListener("pointermove", move)
            window.removeEventListener("pointerup", finish)
            window.removeEventListener("pointercancel", cancel)
            window.removeEventListener("blur", cancel)
        }
        const cancel = () => {
            cleanup()
            setDragPreview(null)
        }
        const finish = () => {
            cleanup()
            setDragPreview(null)
            if (!latestDays) return
            const next = nextDates(latestDays)
            requestSchedule(item, next.start, next.due, mode === "move" ? descendantScheduleChanges(item.id, latestDays) : [])
        }
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", finish)
        window.addEventListener("pointercancel", cancel)
        window.addEventListener("blur", cancel)
    }

    function goToToday() {
        const node = scrollRef.current
        if (!node) return
        node.scrollTo({ left: Math.max(0, todayLeft - (node.clientWidth - effectiveLeftWidth) / 2), behavior: "smooth" })
    }

    function fitPlan() {
        const node = scrollRef.current
        if (!node) return
        const planRanges = [...ranges.values()]
        if (!planRanges.length) { goToToday(); return }
        const first = Math.min(...planRanges.map((range) => dateDay(range.start)))
        const last = Math.max(...planRanges.map((range) => dateDay(range.end))) + 1
        const available = Math.max(120, node.clientWidth - effectiveLeftWidth - 32)
        const span = Math.max(1, last - first)
        const candidates = [...new Set<Scale>([scale, "week", "month"])]
        const nextScale = candidates.find((candidate) => span * SCALE_WIDTH[candidate] * MIN_ZOOM <= available) ?? "month"
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, available / span / SCALE_WIDTH[nextScale]))
        setScale(nextScale)
        setZoom(nextZoom)
        requestAnimationFrame(() => {
            const nextDayWidth = SCALE_WIDTH[nextScale] * nextZoom
            const centre = ((first + last) / 2 - rangeStart) * nextDayWidth
            node.scrollTo({ left: Math.max(0, centre - available / 2), behavior: "smooth" })
        })
    }

    function selectScale(nextScale: Scale) {
        const node = scrollRef.current
        const localX = node ? effectiveLeftWidth + Math.max(0, node.clientWidth - effectiveLeftWidth) / 2 : 0
        const centredDay = node ? (node.scrollLeft + localX - effectiveLeftWidth) / dayWidth : dateDay(today) - rangeStart
        setZoom(1)
        setScale(nextScale)
        requestAnimationFrame(() => {
            if (node) node.scrollLeft = Math.max(0, effectiveLeftWidth + centredDay * SCALE_WIDTH[nextScale] - localX)
        })
    }

    function updateTouchPoint(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.pointerType !== "touch" || !isNarrow) return
        if (event.type === "pointerdown") {
            if (pinchReleaseFrameRef.current !== null) {
                cancelAnimationFrame(pinchReleaseFrameRef.current)
                pinchReleaseFrameRef.current = null
            }
            event.currentTarget.setPointerCapture(event.pointerId)
        }
        touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        const points = [...touchPointsRef.current.values()]
        if (points.length === 1 && !pinchRef.current) {
            const node = scrollRef.current
            if (!node) return
            if (event.type === "pointerdown") {
                if ((event.target as Element).closest("[data-gantt-bar]")) {
                    touchPanRef.current = null
                    return
                }
                touchPanRef.current = {
                    pointerId: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    scrollLeft: node.scrollLeft,
                    scrollTop: node.scrollTop,
                }
                return
            }
            const pan = touchPanRef.current
            if (!pan || pan.pointerId !== event.pointerId) return
            if (event.cancelable) event.preventDefault()
            node.scrollLeft = pan.scrollLeft - (event.clientX - pan.x)
            node.scrollTop = pan.scrollTop - (event.clientY - pan.y)
            return
        }
        if (points.length !== 2) return
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
        const centerX = (points[0].x + points[1].x) / 2
        if (event.cancelable) event.preventDefault()
        if (!pinchRef.current) {
            const node = scrollRef.current
            if (!node) return
            touchPanRef.current = null
            touchZoomOnlyRef.current = true
            setDragPreview(null)
            const localX = Math.min(node.clientWidth, Math.max(effectiveLeftWidth, centerX - node.getBoundingClientRect().left))
            pinchRef.current = {
                distance,
                zoom,
                timelineDay: (node.scrollLeft + localX - effectiveLeftWidth) / dayWidth,
                localX,
                scrollTop: node.scrollTop,
            }
            flushSync(() => setPinching(true))
            return
        }
        const node = scrollRef.current
        if (!node) return
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchRef.current.zoom * distance / pinchRef.current.distance))
        if (Math.abs(nextZoom - zoom) < .001) return
        zoomAnchorRef.current = {
            timelineDay: pinchRef.current.timelineDay,
            localX: pinchRef.current.localX,
            scrollTop: pinchRef.current.scrollTop,
        }
        node.scrollTop = pinchRef.current.scrollTop
        flushSync(() => setZoom(nextZoom))
    }

    function endTouch(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.pointerType !== "touch" || !isNarrow) return
        if (event.cancelable) event.preventDefault()
        touchPointsRef.current.delete(event.pointerId)
        if (touchPointsRef.current.size) return
        touchPanRef.current = null
        if (!pinchRef.current) {
            touchZoomOnlyRef.current = false
            return
        }
        const node = scrollRef.current
        const anchor = pinchRef.current
        const restoreAnchor = () => {
            if (!node) return
            node.scrollLeft = ganttAnchoredScrollLeft({ timelineDay: anchor.timelineDay, dayWidth, leftWidth: effectiveLeftWidth, localX: anchor.localX })
            node.scrollTop = anchor.scrollTop
        }
        restoreAnchor()
        pinchReleaseFrameRef.current = requestAnimationFrame(() => {
            restoreAnchor()
            pinchReleaseFrameRef.current = requestAnimationFrame(() => {
                restoreAnchor()
                pinchReleaseFrameRef.current = null
                pinchRef.current = null
                touchZoomOnlyRef.current = false
                setPinching(false)
            })
        })
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

    function toggleCategory(category: Category) {
        setCollapsedCategories((current) => {
            const next = new Set(current)
            if (next.has(category)) next.delete(category)
            else next.add(category)
            return next
        })
    }

    function renderCategory(category: Category, label: string, count: number) {
        const isCollapsed = collapsedCategories.has(category)
        return <div className="contents" key={`category-${category}`}>
            <button
                type="button"
                disabled={Boolean(dragPreview)}
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${label}`}
                onClick={() => toggleCategory(category)}
                className={`sticky left-0 z-40 flex min-w-0 items-center gap-1 border-b border-neutral-800 bg-neutral-950 px-1.5 text-left text-[10px] font-semibold uppercase tracking-[.08em] text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200 disabled:opacity-40 ${effectiveLeftWidth ? "border-r border-r-neutral-700" : "border-r-0 px-0"}`}
                style={fixedRowStyle(CATEGORY_ROW_HEIGHT)}
            >
                <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`h-3 w-3 shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}><path d="m6 3 5 5-5 5" /></svg>
                <span className="truncate">{label}</span>
                <span className="ml-auto text-[9px] font-normal tabular-nums text-neutral-600">{count}</span>
            </button>
            <div aria-hidden="true" className="border-b border-neutral-800 bg-neutral-950" style={{ ...fixedRowStyle(CATEGORY_ROW_HEIGHT), backgroundImage: CATEGORY_BACKGROUND }} />
        </div>
    }

    function renderLeft(row: DisplayRow) {
        const isRoot = row.depth === 0
        const categoryItems = row.category === "scheduled" ? scheduledItems : row.category === "shared" ? sharedItems : unscheduledItems
        const hasChildren = !row.external && categoryItems.some((item) => item.parentWorkItemId === row.item.id)
        const isActive = activeItemId === row.item.id
        const isUnscheduled = !ranges.has(row.item.id)
        const contextLabel = row.external ? "external" : row.category === "unscheduled" && row.item.section === "shared" ? "shared" : null
        return <div
            className={`sticky left-0 z-40 flex min-w-0 items-center gap-1 overflow-hidden border-b border-b-neutral-800 transition-colors ${effectiveLeftWidth ? "border-r border-r-neutral-700 px-1.5" : "border-r-0 px-0"} ${isActive ? "bg-neutral-900" : "bg-neutral-950"}`}
            style={fixedRowStyle(rowHeight(row))}
            onMouseEnter={() => setActiveItemId(row.item.id)}
            onMouseLeave={() => setActiveItemId(null)}
        >
            {hasChildren ? <button
                type="button"
                disabled={Boolean(dragPreview)}
                aria-label={`${collapsed.has(row.item.id) ? "Expand" : "Collapse"} ${row.item.title}`}
                aria-expanded={!collapsed.has(row.item.id)}
                onClick={() => setCollapsed((current) => {
                    const next = new Set(current)
                    if (next.has(row.item.id)) next.delete(row.item.id)
                    else next.add(row.item.id)
                    return next
                })}
                className="flex h-6 w-5 shrink-0 items-center justify-center text-neutral-500 hover:text-white disabled:opacity-40"
                style={{ marginLeft: `${(row.depth + 1) * 12}px` }}
            ><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`h-3.5 w-3.5 transition-transform ${collapsed.has(row.item.id) ? "" : "rotate-90"}`}><path d="m6 3 5 5-5 5" /></svg></button> : null}
            {isRoot && !hasChildren ? <span className="w-5 shrink-0" style={{ marginLeft: "12px" }} /> : null}
            {!isRoot && !hasChildren ? <span className="w-5 shrink-0" style={{ marginLeft: `${(row.depth + 1) * 12}px` }} /> : null}
            <Link href={`/${workspaceSlug}/work-items/${row.item.id}`} className={`min-w-0 flex-1 truncate whitespace-nowrap text-left text-neutral-200 hover:text-white ${isRoot ? "text-sm font-semibold" : "text-xs font-normal"}`} title={row.item.title}>{row.item.title}</Link>
            {contextLabel ? <span title={contextLabel === "external" ? "Prerequisite from outside this relationship" : "Work shared with another relationship"} className="shrink-0 text-[9px] text-neutral-600">{contextLabel}</span> : null}
            {isUnscheduled ? <Link href={`/${workspaceSlug}/work-items/${row.item.id}`} aria-label={`Schedule ${row.item.title}`} title="Unscheduled — open to add dates" className="flex h-7 w-7 shrink-0 items-center justify-center text-neutral-600 hover:text-white"><svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5"><path d="M5 3v3M15 3v3M3 7h14M4 5h12v12H4z" /></svg></Link> : null}
        </div>
    }

    function renderTimeline(row: DisplayRow) {
        const item = row.item
        const height = rowHeight(row)
        const barHeight = row.depth === 0 ? ROOT_BAR_HEIGHT : CHILD_BAR_HEIGHT
        const range = ranges.get(item.id) ?? (row.external && item.plannedStartDate ? { start: item.plannedStartDate, end: item.dueDate ?? item.plannedStartDate, derived: false } : null)
        const geometry = range ? barGeometry(range) : null
        const colours = relationshipPhaseColours(item.lifecyclePhase)
        const flashing = flashingItemId === item.id
        const barBorder = flashing ? "#ef4444" : colours.border
        const canDrag = canEdit && !pending && !row.external && !["done", "canceled"].includes(item.status)
        // Derived summary bars move their descendants as a group and cannot be
        // resized independently without changing the hierarchy's meaning.
        const isSummary = range?.derived === true
        const canResize = Boolean(canDrag && !isSummary && geometry && geometry.width >= 40)
        const handleSpace = canResize ? 10 : 0
        const linkSize = barHeight
        const showBarLink = Boolean(geometry && geometry.width >= linkSize + handleSpace * 2 + 12)
        const showAssignee = Boolean(geometry && geometry.width >= 92)
        const isActive = activeItemId === item.id
        const overdue = Boolean(range && dateDay(range.end) < dateDay(today) && !["done", "canceled"].includes(item.status))
        const statusLabel = item.status === "done" ? "Completed" : item.status === "canceled" ? "Canceled" : overdue ? "Overdue" : null
        const derived = Boolean(range?.derived)
        return <div
            className={`relative border-b border-neutral-800 transition-colors ${isActive ? "bg-white/[0.025]" : ""}`}
            style={fixedRowStyle(height)}
            onMouseEnter={() => setActiveItemId(item.id)}
            onMouseLeave={() => setActiveItemId(null)}
        >
            {range && geometry ? <div
                data-gantt-bar
                className={`absolute flex touch-none select-none items-center gap-1.5 overflow-hidden rounded-md border transition-[transform,border-color,opacity] ${isActive ? "z-30" : "z-20"} ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${row.depth > 0 ? "border-dashed" : ""} ${item.status === "canceled" ? "opacity-45" : ""}`}
                style={{ top: `${(height - barHeight) / 2}px`, height: `${barHeight}px`, paddingLeft: `${handleSpace + 5}px`, paddingRight: `${(showBarLink ? linkSize : handleSpace) + 3}px`, left: `${geometry.left}px`, width: `${geometry.width}px`, borderColor: barBorder, backgroundColor: colours.background, backgroundImage: derived ? "repeating-linear-gradient(135deg, transparent 0 5px, rgba(255,255,255,.055) 5px 7px)" : undefined, color: colours.text, boxShadow: flashing ? "0 0 0 2px rgba(239,68,68,.6)" : undefined, transform: isActive ? "scale(1.01)" : undefined, transformOrigin: "center" }}
                onPointerDown={(event) => startBarDrag(event, item, range, "move")}
                onFocus={() => setActiveItemId(item.id)}
                onBlur={() => setActiveItemId(null)}
                title={`${item.title}: ${range.start} → ${range.end}${derived ? " · Derived from child work" : ""}${statusLabel ? ` · ${statusLabel}` : ""}`}
            >
                {item.actualStartAt ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md opacity-25" style={{ width: `${Math.min(100, Math.max(2, ((dateDay((item.actualCompletedAt ?? today).slice(0, 10)) - dateDay(range.start) + 1) / Math.max(1, dateDay(range.end) - dateDay(range.start) + 1)) * 100))}%`, backgroundColor: colours.text }} /> : null}
                {canResize ? <button type="button" aria-label={`Resize start of ${item.title}`} onPointerDown={(event) => startBarDrag(event, item, range, "start")} className="absolute inset-y-0 left-0 z-20 flex w-5 cursor-ew-resize items-stretch justify-start rounded-l-md"><span aria-hidden="true" className="w-1.5" style={{ backgroundColor: barBorder }} /></button> : null}
                {statusLabel ? <Status label={statusLabel} tone={item.status === "done" ? "green" : item.status === "canceled" ? "grey" : "red"} compact className="relative shrink-0" /> : null}
                {showAssignee && item.assignees[0] ? <div className="relative flex shrink-0 items-center gap-1"><Assignee name={item.assignees[0].username} avatarSrc={item.assignees[0].avatarUrl} compact compactSize={row.depth === 0 ? "md" : "sm"} />{item.assignees.length > 1 ? <span className={`shrink-0 font-medium ${row.depth === 0 ? "text-xs" : "text-[9px]"}`}>+{item.assignees.length - 1}</span> : null}</div> : null}
                <span className={`relative min-w-0 flex-1 truncate leading-none ${row.depth === 0 ? "text-sm font-semibold" : "text-[11px] font-normal"}`}>{item.title}</span>
                {showBarLink ? <Link href={`/${workspaceSlug}/work-items/${item.id}`} aria-label={`Open ${item.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} className="absolute inset-y-0 right-0 z-10 flex items-center justify-center border-l" style={{ width: `${linkSize}px`, borderColor: barBorder, borderLeftStyle: row.depth > 0 ? "dashed" : "solid", backgroundColor: colours.background, color: barBorder }}><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={row.depth === 0 ? "h-[18px] w-[18px]" : "h-3.5 w-3.5"}><path d="M5 11 11 5M6 5h5v5" /></svg></Link> : null}
                {canResize ? <button type="button" aria-label={`Resize end of ${item.title}`} onPointerDown={(event) => startBarDrag(event, item, range, "end")} className="absolute inset-y-0 right-0 z-20 flex w-2 cursor-ew-resize items-stretch justify-end rounded-r-md"><span aria-hidden="true" className="w-1" style={{ backgroundColor: barBorder }} /></button> : null}
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
        const sourceGeometry = barGeometry(fromRange)
        const targetGeometry = barGeometry(toRange)
        const sourceDivider = sourceGeometry.sourceDivider
        const sourceBarRight = sourceGeometry.right
        const targetDivider = targetGeometry.targetDivider
        const targetBarLeft = targetGeometry.left
        const y1 = fromTop + fromHeight / 2
        const y2 = toTop + toHeight / 2
        const yTrack = y2 >= y1 ? fromTop + fromHeight : fromTop
        return [{ edge, path: `M ${sourceBarRight} ${y1} H ${sourceDivider} V ${yTrack} H ${targetDivider} V ${y2} H ${targetBarLeft}`, arrow: ganttArrowHeadPath(targetBarLeft, targetDivider, y2) }]
    })

    const parentDocument = typeof window !== "undefined" ? (window.parent !== window ? window.parent.document : document) : null
    const dragging = Boolean(dragPreview)

    return <section id="plan" className="relative isolate mt-4 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900/70">
        <div className="flex h-9 items-center justify-between gap-2 border-b border-neutral-700 bg-neutral-950 px-2">
            <div className="flex min-w-0 items-center gap-1">
                {isNarrow ? <button type="button" disabled={dragging} onClick={() => setLabelsVisible((current) => !current)} aria-label={labelsVisible ? "Hide work item labels" : "Show work item labels"} aria-pressed={labelsVisible} title={labelsVisible ? "Hide labels" : "Show labels"} className={`flex h-7 w-7 items-center justify-center rounded-md border disabled:opacity-40 ${labelsVisible ? "border-neutral-600 bg-neutral-800 text-white" : "border-neutral-800 text-neutral-500"}`}><Icon kind="labels" /></button> : null}
                <button type="button" disabled={dragging} onClick={goToToday} className="h-7 rounded-md border border-neutral-700 bg-white px-2 text-[11px] font-semibold text-neutral-950 disabled:opacity-40">Today</button>
                <button type="button" disabled={dragging} onClick={fitPlan} aria-label="Fit plan" title="Fit plan" className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white disabled:opacity-40"><Icon kind="fit" /></button>
                {pending ? <span role="status" aria-live="polite" className="ml-1 truncate text-[10px] text-neutral-500">Saving…</span> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
                <div className="flex items-center rounded-md border border-neutral-700 bg-neutral-900 p-0.5">
                    <button type="button" disabled={dragging || zoom <= MIN_ZOOM} onClick={() => zoomAtTimelineCentre(zoom - (zoom > 1 ? .5 : .25))} aria-label="Zoom out" title="Zoom out" className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-30"><Icon kind="minus" /></button>
                    <button type="button" disabled={dragging || zoom >= MAX_ZOOM} onClick={() => zoomAtTimelineCentre(zoom + (zoom >= 1 ? .5 : .25))} aria-label="Zoom in" title="Zoom in" className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-30"><Icon kind="plus" /></button>
                </div>
                <div className="flex items-center rounded-md border border-neutral-700 bg-neutral-900 p-0.5">
                    {([['day', 'd'], ['week', 'w'], ['month', 'mo']] as const).map(([value, label]) => <button
                        type="button"
                        key={value}
                        disabled={dragging}
                        onClick={() => selectScale(value)}
                        aria-label={`${value} view`}
                        aria-pressed={scale === value}
                        title={`${value[0].toUpperCase()}${value.slice(1)} view`}
                        className={`flex h-6 min-w-6 items-center justify-center rounded px-1 text-[10px] font-semibold disabled:opacity-40 ${scale === value ? "bg-neutral-600 text-white" : "text-neutral-500 hover:bg-neutral-800 hover:text-white"}`}
                    >{label}</button>)}
                </div>
            </div>
        </div>
        <div
            ref={scrollRef}
            className="relative overflow-auto overscroll-contain bg-neutral-950/40"
            style={{ touchAction: isNarrow ? "none" : (pinching ? "none" : "pan-x pan-y"), height: `min(clamp(20rem, calc(100vh - 20.25rem), 42rem), ${chartHeight}px)` }}
            onPointerDownCapture={updateTouchPoint}
            onPointerMoveCapture={updateTouchPoint}
            onPointerUpCapture={endTouch}
            onPointerCancelCapture={endTouch}
        >
            <div className="grid items-start" style={{ gridTemplateColumns: `${effectiveLeftWidth}px ${timelineWidth}px`, gridAutoRows: "max-content", minWidth: `${effectiveLeftWidth + timelineWidth}px` }}>
                <div className={`sticky left-0 top-0 z-50 flex h-11 min-w-0 items-center overflow-hidden border-b border-neutral-700 bg-neutral-950 text-xs font-semibold text-white ${effectiveLeftWidth ? "border-r px-2" : "border-r-0 px-0"}`}>
                    <span className="truncate">Plan</span>
                    {!isNarrow ? <button type="button" aria-label="Resize timeline label column" title="Drag to resize" onPointerDown={startDividerDrag} className="group absolute -right-1.5 inset-y-0 hidden w-3 cursor-col-resize touch-none lg:block"><span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-neutral-400" /></button> : null}
                </div>
                <div className="sticky top-0 z-40 h-11 border-b border-neutral-700 bg-neutral-950">
                    {headerLabels.map((label) => <span key={label.day} className="absolute top-0 flex h-full items-center border-l border-neutral-800 px-1 text-[10px] text-neutral-500" style={{ left: `${label.left}px` }}>{dateLabel(label.day, scale)}</span>)}
                    <span className="absolute inset-y-0 z-10 w-px bg-red-400/60" style={{ left: `${todayLeft}px` }} />
                </div>
                <div className={`sticky left-0 z-40 flex min-w-0 items-center overflow-hidden border-b border-b-neutral-800 bg-neutral-950 text-[10px] font-semibold uppercase tracking-[.08em] text-neutral-400 ${effectiveLeftWidth ? "border-r border-r-neutral-700 px-2" : "border-r-0 px-0"}`} style={fixedRowStyle(CATEGORY_ROW_HEIGHT)}>{effectiveLeftWidth ? "Milestones" : null}</div><div className="relative border-b border-neutral-800" style={fixedRowStyle(CATEGORY_ROW_HEIGHT)}>{plan.milestones.map((milestone) => { const left = (dateDay(milestone.occurredAt.slice(0, 10)) - rangeStart) * dayWidth; const marker = <span className="block h-2.5 w-2.5 rotate-45 border border-emerald-400 bg-emerald-950" />; return milestone.href ? <a key={milestone.id} href={milestone.href} aria-label={`${milestone.title}, ${milestone.occurredAt.slice(0, 10)}`} title={`${milestone.title} · ${milestone.occurredAt.slice(0, 10)}`} className="absolute flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded hover:bg-emerald-400/10 focus:outline-none focus:ring-1 focus:ring-emerald-400" style={{ left, top: 0 }}>{marker}</a> : <span key={milestone.id} role="img" aria-label={`${milestone.title}, ${milestone.occurredAt.slice(0, 10)}`} title={`${milestone.title} · ${milestone.occurredAt.slice(0, 10)}`} className="absolute flex h-7 w-7 -translate-x-1/2 items-center justify-center" style={{ left, top: 0 }}>{marker}</span> })}</div>
                {renderCategory("scheduled", "Scheduled", scheduledItems.length)}
                {scheduledRows.map((row) => <div className="contents" key={`scheduled-${row.item.id}`}>{renderLeft(row)}{renderTimeline(row)}</div>)}
                {renderCategory("shared", "Shared", sharedItems.length + plan.externalItems.filter((item) => committedRanges.has(item.id)).length)}
                {[...sharedRows, ...scheduledExternalRows].map((row) => <div className="contents" key={`shared-${row.item.id}`}>{renderLeft(row)}{renderTimeline(row)}</div>)}
                {renderCategory("unscheduled", "Unscheduled", unscheduledItems.length + plan.externalItems.filter((item) => !committedRanges.has(item.id)).length)}
                {[...unscheduledRows, ...unscheduledExternalRows].map((row) => <div className="contents" key={`unscheduled-${row.item.id}`}>{renderLeft(row)}{renderTimeline(row)}</div>)}
            </div>
            {weekendDays.map((day) => <div aria-hidden="true" key={`weekend-${day}`} className="pointer-events-none absolute z-0 bg-white/[0.012]" style={{ left: `${effectiveLeftWidth + timelineX(day)}px`, top: `${HEADER_HEIGHT}px`, width: `${dayWidth}px`, height: `${chartHeight - HEADER_HEIGHT}px` }} />)}
            {headerLabels.map((label) => <div aria-hidden="true" key={`column-${label.day}`} className="pointer-events-none absolute z-10 w-px bg-neutral-800" style={{ left: `${effectiveLeftWidth + label.left}px`, top: `${HEADER_HEIGHT}px`, height: `${chartHeight - HEADER_HEIGHT}px` }} />)}
            <div className="pointer-events-none absolute z-20 w-px bg-red-400/70" style={{ left: `${effectiveLeftWidth + todayLeft}px`, top: `${HEADER_HEIGHT}px`, height: `${chartHeight - HEADER_HEIGHT}px` }} />
            <svg aria-hidden="true" className="pointer-events-none absolute top-0 z-30 overflow-visible" style={{ left: `${effectiveLeftWidth}px` }} width={timelineWidth} height={chartHeight}>{dependencyPaths.map(({ edge, path, arrow }) => { const active = activeItemId === edge.workItemId || activeItemId === edge.dependsOnWorkItemId; return <g key={`${edge.workItemId}-${edge.dependsOnWorkItemId}`} fill="none" stroke={active ? ACTIVE_STRUCTURAL_LINE : STRUCTURAL_LINE} strokeWidth={active ? "2" : "1.5"} strokeDasharray={edge.external ? "4 3" : undefined} strokeLinejoin="miter" strokeLinecap="square"><path d={path} />{arrow ? <path d={arrow} /> : null}</g> })}</svg>
            {dragPreview ? <div aria-live="polite" className="pointer-events-none fixed z-[80] -translate-y-full rounded-md border border-neutral-600 bg-neutral-950 px-2 py-1 font-mono text-[10px] text-neutral-200 shadow-xl" style={{ left: `${Math.min(dragPreview.pointerX + 10, (typeof window !== "undefined" ? window.innerWidth : dragPreview.pointerX + 200) - 160)}px`, top: `${dragPreview.pointerY - 8}px` }}>{dragPreview.label}</div> : null}
        </div>
        <MutationError result={result} />
        {cascade && parentDocument ? createPortal(<div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-3"><div role="dialog" aria-modal="true" aria-labelledby="gantt-cascade-title" className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-950 p-3 shadow-2xl"><h3 id="gantt-cascade-title" className="text-sm font-semibold text-white">Move dependent work?</h3><p className="mt-1 text-xs text-neutral-400">This will update {cascade.length} work item{cascade.length === 1 ? "" : "s"}.</p><div className="mt-2 max-h-64 divide-y divide-neutral-900 overflow-y-auto rounded-lg border border-neutral-800">{cascade.map((change) => { const original = committedRanges.get(change.id); return <div key={change.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-2.5 py-2 text-xs"><span className="truncate text-neutral-200">{change.title}</span><span className="shrink-0 font-mono text-[10px] text-neutral-500">{original ? `${original.start}–${original.end} → ` : ""}{change.plannedStartDate}–{change.dueDate}</span></div> })}</div><div className="mt-3 flex justify-end gap-1.5"><button type="button" onClick={() => { setCascade(null); void reload() }} className="h-8 px-2.5 text-xs text-neutral-400 hover:text-white">Cancel</button><button type="button" autoFocus disabled={pending} onClick={() => { const changes = cascade; setCascade(null); mutate(() => applyGanttScheduleChanges(workspaceSlug, relationshipId, changes)) }} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">Confirm</button></div></div></div>, parentDocument.body) : null}
    </section>
}
