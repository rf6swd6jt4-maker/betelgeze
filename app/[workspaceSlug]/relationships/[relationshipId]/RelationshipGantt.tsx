"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { createPortal, flushSync } from "react-dom"
import { Assignee, RoundPill, Status, relationshipPhaseColours } from "@/components/ui"
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
import { proceedRelationshipCurrentWork } from "../actions"

type Scale = "quarter_hour" | "hour" | "three_hour" | "day" | "week" | "month"
type Category = "scheduled" | "shared" | "unscheduled"
type DisplayRow = { item: RelationshipGanttItem; depth: number; category: Category; external?: boolean }
type DragPreview = {
    itemId: string
    pointerX: number
    pointerY: number
    label: string
    changes: Map<string, { start: string; end: string; startTime: string | null; dueTime: string | null }>
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
// Zoom is canonical pixels per day. The presentation and scheduling grain are
// derived from it, so wheel/pinch zoom can cross every density without jumps.
const DEFAULT_ZOOM = 56
const MIN_ZOOM = 8
const MAX_ZOOM = 3_456
const BAR_INSET = 8
// A short, fixed dashed continuation past the live "now" front of an open-ended
// bar. Its length is deliberately constant at every zoom so it always reads as
// "still open" rather than implying a duration.
const OPEN_TRAIL_WIDTH = 44
// Gap between a predecessor's rendered right edge (bar plus any open trail) and
// the gated successor placed after it, so the two read as sequential.
const GATED_GAP = 14
const STRUCTURAL_LINE = "#858585"
const ACTIVE_STRUCTURAL_LINE = "#b8b8b8"
const HOVER_BAR_OUTSET = 1
// A single, tiled slash is cheaper to paint than a scroll-attached repeating
// gradient and keeps its 36px cadence stable at every zoom level.
const CATEGORY_BACKGROUND = "linear-gradient(135deg, transparent 0 47%, #262626 47% 53%, transparent 53%)"
const CATEGORY_BACKGROUND_SIZE = "36px 36px"
const ZOOM_PRESET: Record<Scale, number> = { quarter_hour: 3_456, hour: 1_056, three_hour: 576, day: 64, week: 28, month: 12 }

function scaleForDayWidth(dayWidth: number): Scale {
    if (dayWidth >= 3_072) return "quarter_hour"
    if (dayWidth >= 960) return "hour"
    if (dayWidth >= 480) return "three_hour"
    if (dayWidth >= 48) return "day"
    if (dayWidth >= 20) return "week"
    return "month"
}

function isTimeScale(scale: Scale) {
    return scale === "quarter_hour" || scale === "hour" || scale === "three_hour"
}

function dateLabel(day: number, scale: Scale) {
    const date = new Date(day * 86_400_000)
    return new Intl.DateTimeFormat("en-IE", scale === "month" ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" }).format(date)
}

function timeMinutes(value: string | null) {
    if (!value) return null
    const [hours, minutes] = value.slice(0, 5).split(":").map(Number)
    return Number.isInteger(hours) && Number.isInteger(minutes) ? hours * 60 + minutes : null
}

function timeLabel(value: string | null) {
    return value ? value.slice(0, 5) : "All day"
}

function parentIds(items: RelationshipGanttItem[]) {
    const ids = new Set(items.map((item) => item.id))
    return new Set(items.flatMap((item) => item.parentWorkItemId && ids.has(item.parentWorkItemId) ? [item.parentWorkItemId] : []))
}

function localDateValue(date = new Date()) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

// Split a saved timestamp into the local calendar date and HH:MM the Gantt
// positions by, so a completion recorded to the minute lands on the same wall
// clock the rest of the chart uses.
function localClock(value: string | null) {
    if (!value) return null
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return null
    return { date: localDateValue(parsed), time: `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}` }
}

function scheduleMinutes(date: string, time: string | null) {
    return dateDay(date) * 1440 + (timeMinutes(time) ?? 0)
}

function addCalendarMonths(value: string, months: number) {
    const date = new Date(`${value}T00:00:00Z`)
    const day = date.getUTCDate()
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + months)
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(day, lastDay))
    return date.toISOString().slice(0, 10)
}

function addCalendarMinutes(date: string, time: string, minutes: number) {
    const next = new Date(`${date}T${time}:00Z`)
    next.setUTCMinutes(next.getUTCMinutes() + minutes)
    return { date: next.toISOString().slice(0, 10), time: next.toISOString().slice(11, 16) }
}

function rowHeight(row: DisplayRow) {
    return row.depth === 0 ? ROOT_ROW_HEIGHT : CHILD_ROW_HEIGHT
}

function fixedRowStyle(height: number): CSSProperties {
    return { boxSizing: "border-box", height: `${height}px`, minHeight: `${height}px`, maxHeight: `${height}px` }
}

function compareWorkItems(left: RelationshipGanttItem, right: RelationshipGanttItem) {
    const leftStart = left.plannedStartDate ?? "9999-12-31"
    const rightStart = right.plannedStartDate ?? "9999-12-31"
    if (leftStart !== rightStart) return leftStart.localeCompare(rightStart)
    if (left.createdAt !== right.createdAt) return left.createdAt.localeCompare(right.createdAt)
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
    return left.title.localeCompare(right.title)
}

function withMinimumBarWidth(geometry: { left: number; right: number; width: number; sourceDivider: number; targetDivider: number }, minimumWidth: number) {
    const width = Math.max(minimumWidth, geometry.width)
    return { ...geometry, width, right: geometry.left + width, sourceDivider: geometry.left + width }
}

// An open-ended item has no finish, so a bar length can't tell the truth about
// when it ends. Instead of running to the timeline edge, the solid bar spans
// from its start to the live "now" front (never below a readable minimum); the
// dashed trail then carries the "still open" signal a short, fixed distance on.
function openBarGeometry(geometry: { left: number; right: number; width: number; sourceDivider: number; targetDivider: number }, todayLeft: number, minimumWidth: number) {
    const right = Math.max(geometry.left + minimumWidth, todayLeft)
    return { ...geometry, width: right - geometry.left, right, sourceDivider: right }
}

// A geometry pinned to explicit pixels, for bars positioned relative to another
// row (a gated successor placed after its predecessor) rather than to a date.
// The target divider sits an inset left of the bar so an incoming connector
// keeps room to draw its arrowhead.
function fixedGeometry(left: number, width: number) {
    return { left, right: left + width, width, sourceDivider: left + width, targetDivider: left - BAR_INSET }
}

function hasOpenEnd(item: RelationshipGanttItem, range: { derived: boolean } | null) {
    return Boolean(range && !range.derived && item.plannedStartDate && !item.dueDate && !["done", "canceled"].includes(item.status))
}

// Onboarding and review steps are stored as open-ended children of a lifecycle
// stage — a shared start date, no finish, chained by finish-to-start
// dependencies. Drawn literally they stack at the same start and read as
// parallel work rather than a sequence. Collapse each such chain to its next
// incomplete step so only one shows at a time, and report how many further
// steps remain so the row can hint at the rest. Dated stage children (e.g.
// fulfilment services) carry real timeframes and are deliberately untouched.
function collapseSequentialSteps(items: RelationshipGanttItem[]) {
    const byId = new Map(items.map((item) => [item.id, item]))
    const chains = new Map<string, RelationshipGanttItem[]>()
    for (const item of items) {
        const parent = item.parentWorkItemId ? byId.get(item.parentWorkItemId) : null
        if (parent?.workflowRole === "lifecycle_stage" && item.plannedStartDate && !item.dueDate) {
            chains.set(parent.id, [...(chains.get(parent.id) ?? []), item])
        }
    }
    const hiddenStepIds = new Set<string>()
    const remainingByNextStep = new Map<string, number>()
    for (const chain of chains.values()) {
        if (chain.length <= 1) continue
        const ordered = [...chain].sort((left, right) => left.sortOrder - right.sortOrder)
        const incomplete = ordered.filter((item) => !["done", "canceled"].includes(item.status))
        const next = incomplete[0]
        for (const item of ordered) if (item.id !== next?.id) hiddenStepIds.add(item.id)
        if (next && incomplete.length > 1) remainingByNextStep.set(next.id, incomplete.length - 1)
    }
    return { hiddenStepIds, remainingByNextStep }
}

function flattenRows(items: RelationshipGanttItem[], collapsed: Set<string>, category: Category) {
    const byId = new Map(items.map((item) => [item.id, item]))
    const children = new Map<string, RelationshipGanttItem[]>()
    for (const item of items) if (item.parentWorkItemId && byId.has(item.parentWorkItemId)) children.set(item.parentWorkItemId, [...(children.get(item.parentWorkItemId) ?? []), item])
    for (const rows of children.values()) rows.sort(compareWorkItems)
    const roots = items.filter((item) => !item.parentWorkItemId || !byId.has(item.parentWorkItemId)).sort(compareWorkItems)
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

export function RelationshipGantt({ workspaceSlug, relationshipId, plan: initialPlan, canEdit, currentWork }: {
    workspaceSlug: string
    relationshipId: string
    plan: RelationshipGanttPlan
    canEdit: boolean
    currentWork?: { id: string; title: string; action: string | null; role: string; status: string; unassignedCount: number; blocked: boolean } | null
}) {
    const router = useRouter()
    const scrollRef = useRef<HTMLDivElement>(null)
    const initiallyCenteredRef = useRef(false)
    const mobileZoomInitialisedRef = useRef(false)
    const previousGeometryRef = useRef<{ dayWidth: number; leftWidth: number; rangeStart: number; gutter: number } | null>(null)
    const zoomAnchorRef = useRef<{ calendarDay: number; localX: number; scrollTop: number } | null>(null)
    const touchPointsRef = useRef(new Map<number, { x: number; y: number }>())
    const touchPanRef = useRef<{ pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)
    const touchZoomOnlyRef = useRef(false)
    const pinchRef = useRef<{ distance: number; zoom: number; calendarDay: number; localX: number; scrollTop: number } | null>(null)
    const pinchReleaseFrameRef = useRef<number | null>(null)
    // The plan is held locally so edits can be painted optimistically and so
    // cross-tab changes can refresh it without a full route reload.
    const [plan, setPlan] = useState(initialPlan)
    const [zoom, setZoom] = useState(DEFAULT_ZOOM)
    const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH)
    const [isNarrow, setIsNarrow] = useState(false)
    const [viewportWidth, setViewportWidth] = useState(0)
    const [labelsVisible, setLabelsVisible] = useState(true)
    // The overview should answer "how long are the stages?" before it asks a
    // user to parse every task. Each nested parent remains independently
    // collapsed until its own disclosure is opened.
    const [collapsed, setCollapsed] = useState<Set<string>>(() => parentIds(initialPlan.items))
    const [collapsedCategories, setCollapsedCategories] = useState<Set<Category>>(() => new Set(["shared", "unscheduled"]))
    const [pinching, setPinching] = useState(false)
    const [activeItemId, setActiveItemId] = useState<string | null>(null)
    const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
    const [flashingItemId, setFlashingItemId] = useState<string | null>(null)
    const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [cascade, setCascade] = useState<ScheduleChange[] | null>(null)
    const [result, setResult] = useState<GanttMutationResult | null>(null)
    const [pending, startTransition] = useTransition()
    const [confirmBeforeProceeding, setConfirmBeforeProceeding] = useState(true)

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

    useEffect(() => {
        const node = scrollRef.current
        if (!node) return
        const update = () => setViewportWidth(node.clientWidth)
        update()
        const observer = new ResizeObserver(update)
        observer.observe(node)
        return () => observer.disconnect()
    }, [])

    const dayWidth = zoom
    const scale = scaleForDayWidth(dayWidth)
    const timeScale = isTimeScale(scale)
    // Keep timed bars projected from their real timestamps through day view.
    // Only the header density changes at the 3h → day boundary, so work stays
    // visually anchored while the timeline widens or narrows.
    const positionByTime = scale !== "week" && scale !== "month"
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
    const visibleTimelineWidth = Math.max(120, viewportWidth - effectiveLeftWidth)
    const minimumZoom = Math.min(MIN_ZOOM, Math.max(1, visibleTimelineWidth / rangeDays))
    // Pad half a viewport of empty space on each side of the day grid so the
    // first and last days can still reach the centre of the visible chart when
    // zooming; without it the anchored scroll clamps at the content edge and
    // the point under the cursor / viewport centre visibly drifts.
    const timelineGutter = Math.round(visibleTimelineWidth / 2)
    const timelineX = useCallback((day: number, minutes = 0) => timelineGutter + (day - rangeStart) * dayWidth + (positionByTime ? minutes / 1440 * dayWidth : 0), [dayWidth, positionByTime, rangeStart, timelineGutter])
    const timelineWidth = rangeDays * dayWidth
    const contentWidth = timelineGutter * 2 + timelineWidth
    const now = new Date()
    const todayLeft = timelineX(dateDay(today), positionByTime ? now.getHours() * 60 + now.getMinutes() : 0)
    // Bars span their actual start→due dates (the due day is inclusive, so the
    // bar reaches the end of that day) rather than snapping to whole columns,
    // which previously made every bar fill its week or month at coarse scales.
    const barGeometry = useCallback((range: { start: string; end: string }, item?: RelationshipGanttItem) => {
        const startMinutes = positionByTime ? timeMinutes(item?.plannedStartTime ?? null) ?? 0 : 0
        const endMinutes = positionByTime ? timeMinutes(item?.dueTime ?? null) : null
        const columnLeft = timelineX(dateDay(range.start), startMinutes)
        const columnRight = positionByTime
            ? timelineX(dateDay(range.end) + (endMinutes === null ? 1 : 0), endMinutes ?? 0)
            : timelineX(dateDay(range.end) + 1)
        const inset = Math.min(BAR_INSET, Math.max(1, dayWidth * .15))
        return { left: columnLeft + inset, right: columnRight - inset, width: Math.max(4, columnRight - columnLeft - inset * 2), sourceDivider: columnRight, targetDivider: columnLeft }
    }, [dayWidth, positionByTime, timelineX])
    const committedItems = useMemo(() => [...plan.items, ...plan.externalItems], [plan])
    const committedRanges = useMemo(() => effectiveGanttRanges(committedItems), [committedItems])
    const previewedItems = useMemo(() => committedItems.map((item) => {
        const preview = dragPreview?.changes.get(item.id)
        if (preview) return { ...item, plannedStartDate: preview.start, plannedStartTime: preview.startTime, dueDate: preview.end, dueTime: preview.dueTime }
        // A finished open-ended item (e.g. a lifecycle stage that never had a
        // planned finish) ends the moment it was actually completed. Surface
        // that already-saved timestamp to the minute so a zoomed-in Gantt shows
        // 16:05 rather than a stub at the start day.
        const completion = ["done", "canceled"].includes(item.status) && item.plannedStartDate && !item.dueDate ? localClock(item.actualCompletedAt) : null
        return completion ? { ...item, dueDate: completion.date, dueTime: completion.time } : item
    }), [committedItems, dragPreview])
    // A stage begins when its predecessor finishes. A freshly-activated stage is
    // planned to a whole start day, so it would share the predecessor's start
    // column and read as concurrent. Push its display start to the predecessor's
    // real finish instead; storage keeps the whole-day plan.
    const stageStartOverrides = useMemo(() => {
        const byId = new Map(previewedItems.map((item) => [item.id, item]))
        const overrides = new Map<string, { date: string; time: string | null }>()
        for (const edge of plan.dependencies) {
            const successor = byId.get(edge.workItemId)
            const predecessor = byId.get(edge.dependsOnWorkItemId)
            if (!successor || !predecessor || successor.workflowRole !== "lifecycle_stage" || successor.dueDate || !successor.plannedStartDate || !predecessor.dueDate) continue
            if (scheduleMinutes(successor.plannedStartDate, successor.plannedStartTime) >= scheduleMinutes(predecessor.dueDate, predecessor.dueTime)) continue
            overrides.set(successor.id, { date: predecessor.dueDate, time: predecessor.dueTime })
        }
        return overrides
    }, [plan.dependencies, previewedItems])
    const allVisibleItems = useMemo(() => previewedItems.map((item) => {
        const override = stageStartOverrides.get(item.id)
        return override ? { ...item, plannedStartDate: override.date, plannedStartTime: override.time } : item
    }), [previewedItems, stageStartOverrides])
    const ranges = useMemo(() => effectiveGanttRanges(allVisibleItems), [allVisibleItems])
    // A lifecycle stage waiting on the current stage has no truthful calendar
    // date yet. Anchor its outlined preview to the predecessor's live front — its
    // finish if scheduled, otherwise today — so it reads as starting after the
    // current work rather than sharing its start. It stays unscheduled in storage.
    const gatedRanges = useMemo(() => {
        const output = new Map<string, { start: string; end: string; derived: boolean }>()
        for (const edge of plan.dependencies) {
            const item = plan.items.find((candidate) => candidate.id === edge.workItemId)
            const predecessor = ranges.get(edge.dependsOnWorkItemId)
            if (item?.workflowRole === "lifecycle_stage" && !item.plannedStartDate && !item.dueDate && predecessor) {
                const anchor = dateDay(predecessor.end) > dateDay(today) ? predecessor.end : today
                output.set(item.id, { start: anchor, end: anchor, derived: false })
            }
        }
        return output
    }, [plan.dependencies, plan.items, ranges, today])
    const displayRanges = useMemo(() => new Map([...ranges, ...gatedRanges]), [gatedRanges, ranges])
    // A gated successor has no real dates, so it can't be placed by a calendar
    // range: the predecessor's open bar keeps a readable minimum width and can
    // extend past "now", so a date anchor would sit underneath it. Position the
    // successor in pixels, just past the predecessor's rendered right edge
    // (bar plus any open trail), so it reads as beginning after the current work.
    const gatedLefts = useMemo(() => {
        const byId = new Map(allVisibleItems.map((item) => [item.id, item]))
        const output = new Map<string, number>()
        for (const edge of plan.dependencies) {
            if (!gatedRanges.has(edge.workItemId)) continue
            const predecessorRange = displayRanges.get(edge.dependsOnWorkItemId)
            const predecessor = byId.get(edge.dependsOnWorkItemId)
            if (!predecessorRange || !predecessor) continue
            const predecessorOpen = hasOpenEnd(predecessor, predecessorRange)
            const base = barGeometry(predecessorRange, predecessor)
            const rightEdge = (predecessorOpen ? openBarGeometry(base, todayLeft, predecessor.parentWorkItemId ? 116 : 148) : base).right
                + (predecessorOpen && !predecessor.parentWorkItemId ? OPEN_TRAIL_WIDTH : 0)
            output.set(edge.workItemId, rightEdge + GATED_GAP)
        }
        return output
    }, [allVisibleItems, plan.dependencies, gatedRanges, displayRanges, barGeometry, todayLeft])
    const { hiddenStepIds, remainingByNextStep } = useMemo(() => collapseSequentialSteps(plan.items), [plan.items])
    const scheduledItems = plan.items.filter((item) => item.section === "relationship" && displayRanges.has(item.id) && !hiddenStepIds.has(item.id))
    const sharedItems = plan.items.filter((item) => item.section === "shared" && displayRanges.has(item.id) && !hiddenStepIds.has(item.id))
    const unscheduledItems = plan.items.filter((item) => !displayRanges.has(item.id) && !hiddenStepIds.has(item.id))
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
        return Array.from({ length: rangeDays }, (_, index) => ({ day: rangeStart + index, left: timelineGutter + index * dayWidth }))
            .filter(({ day }) => {
                const date = new Date(day * 86_400_000)
                if (scale === "month") return date.getUTCDate() === 1
                if (scale === "week") return date.getUTCDay() === 1
                return true
            })
    }, [dayWidth, rangeDays, rangeStart, scale, timelineGutter])
    const timeLabelMinutes = scale === "quarter_hour" ? 15 : scale === "hour" ? 60 : scale === "three_hour" ? 180 : null
    const hourLabels = useMemo(() => timeLabelMinutes
        ? Array.from({ length: rangeDays * 1440 / timeLabelMinutes }, (_, index) => ({ minutes: index * timeLabelMinutes, left: timelineGutter + index * timeLabelMinutes / 1440 * dayWidth }))
        : [], [dayWidth, rangeDays, timeLabelMinutes, timelineGutter])
    const visibleMilestones = useMemo(() => {
        const rendered: Array<{ milestone: RelationshipGanttPlan["milestones"][number]; left: number }> = []
        for (const milestone of plan.milestones) {
            const moment = new Date(milestone.occurredAt)
            const minutes = positionByTime ? moment.getUTCHours() * 60 + moment.getUTCMinutes() : 0
            const left = timelineX(dateDay(milestone.occurredAt.slice(0, 10)), minutes)
            // Later milestones sit above earlier ones. When a marker would
            // substantially obscure an earlier marker at this scale, omit the
            // obscured one instead of leaving an indistinguishable stack.
            for (let index = rendered.length - 1; index >= 0; index -= 1) {
                if (Math.abs(rendered[index].left - left) < 10) rendered.splice(index, 1)
            }
            rendered.push({ milestone, left })
        }
        return rendered
    }, [plan.milestones, positionByTime, timelineX])
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
        const frameChanged = previous && (previous.leftWidth !== effectiveLeftWidth || previous.rangeStart !== rangeStart || previous.gutter !== timelineGutter)
        if (frameChanged && node && !zoomAnchorRef.current) node.scrollLeft = Math.max(0, node.scrollLeft + effectiveLeftWidth - previous.leftWidth + timelineGutter - previous.gutter + (previous.rangeStart - rangeStart) * dayWidth)
        previousGeometryRef.current = { dayWidth, leftWidth: effectiveLeftWidth, rangeStart, gutter: timelineGutter }
    }, [dayWidth, effectiveLeftWidth, rangeStart, timelineGutter])

    useLayoutEffect(() => {
        const anchor = zoomAnchorRef.current
        const node = scrollRef.current
        if (!anchor || !node) return
        node.scrollLeft = ganttAnchoredScrollLeft({ timelineDay: anchor.calendarDay - rangeStart, dayWidth, leftWidth: effectiveLeftWidth, localX: anchor.localX, gutter: timelineGutter })
        node.scrollTop = anchor.scrollTop
        zoomAnchorRef.current = null
    }, [dayWidth, effectiveLeftWidth, rangeStart, timelineGutter])

    const zoomAt = useCallback((clientX: number, requestedZoom: number) => {
        const node = scrollRef.current
        if (!node) return
        const nextZoom = Math.min(MAX_ZOOM, Math.max(minimumZoom, requestedZoom))
        if (Math.abs(nextZoom - zoom) < .001) return
        const localX = clientX - node.getBoundingClientRect().left
        const calendarDay = rangeStart + (node.scrollLeft + localX - effectiveLeftWidth - timelineGutter) / dayWidth
        zoomAnchorRef.current = { calendarDay, localX, scrollTop: node.scrollTop }
        setZoom(nextZoom)
    }, [dayWidth, effectiveLeftWidth, minimumZoom, rangeStart, timelineGutter, zoom])

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
        zoomAtTimelineCentre(28)
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

    function descendantScheduleChanges(itemId: string, shift: (value: string) => string) {
        const output: ScheduleChange[] = []
        const visit = (parentId: string) => {
            for (const child of plan.items.filter((candidate) => candidate.parentWorkItemId === parentId)) {
                if (child.plannedStartDate) output.push({
                    id: child.id,
                    title: child.title,
                    plannedStartDate: shift(child.plannedStartDate),
                    plannedStartTime: child.plannedStartTime,
                    dueDate: shift(child.dueDate ?? child.plannedStartDate),
                    dueTime: child.dueTime,
                    expectedUpdatedAt: child.updatedAt,
                })
                visit(child.id)
            }
        }
        visit(itemId)
        return output
    }

    function applyOptimisticDates(changes: Array<{ id: string; plannedStartDate: string; plannedStartTime: string | null; dueDate: string; dueTime: string | null }>, frozenParent?: { id: string; start: string; end: string }) {
        const changesById = new Map(changes.map((change) => [change.id, change]))
        setPlan((current) => ({ ...current, items: current.items.map((item) => {
            const change = changesById.get(item.id)
            if (change) return { ...item, plannedStartDate: change.plannedStartDate, plannedStartTime: change.plannedStartTime, dueDate: change.dueDate, dueTime: change.dueTime }
            if (frozenParent && item.id === frozenParent.id) return { ...item, plannedStartDate: frozenParent.start, dueDate: frozenParent.end }
            return item
        }) }))
    }

    function requestSchedule(item: RelationshipGanttItem, start: string, due: string, plannedStartTime: string | null, dueTime: string | null, descendantChanges: ScheduleChange[] = []) {
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
        applyOptimisticDates([{ id: item.id, plannedStartDate: start, plannedStartTime, dueDate: due, dueTime }, ...descendantChanges.map((change) => ({ id: change.id, plannedStartDate: change.plannedStartDate!, plannedStartTime: change.plannedStartTime, dueDate: change.dueDate!, dueTime: change.dueTime }))], frozenParent)
        startTransition(async () => {
            const preview = await previewGanttScheduleChange(workspaceSlug, relationshipId, { id: item.id, plannedStartDate: start, plannedStartTime, dueDate: due, dueTime })
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
        const hasChildren = plan.items.some((candidate) => candidate.parentWorkItemId === item.id)
        const canFineDrag = timeScale && Boolean(item.plannedStartTime && item.dueTime) && !hasChildren
        const dateStep = scale === "week" ? 7 : 1
        let latestDelta = 0

        const nextSchedule = (delta: number) => {
            if (canFineDrag) {
                const nextStart = addCalendarMinutes(range.start, item.plannedStartTime!, delta)
                const nextDue = addCalendarMinutes(range.end, item.dueTime!, delta)
                if (mode === "move") return { start: nextStart.date, startTime: nextStart.time, due: nextDue.date, dueTime: nextDue.time }
                if (mode === "start") {
                    const originalDue = Date.parse(`${range.end}T${item.dueTime}:00Z`)
                    return Date.parse(`${nextStart.date}T${nextStart.time}:00Z`) >= originalDue
                        ? { start: range.end, startTime: item.dueTime, due: range.end, dueTime: item.dueTime }
                        : { start: nextStart.date, startTime: nextStart.time, due: range.end, dueTime: item.dueTime }
                }
                const originalStart = Date.parse(`${range.start}T${item.plannedStartTime}:00Z`)
                return Date.parse(`${nextDue.date}T${nextDue.time}:00Z`) <= originalStart
                    ? { start: range.start, startTime: item.plannedStartTime, due: range.start, dueTime: item.plannedStartTime }
                    : { start: range.start, startTime: item.plannedStartTime, due: nextDue.date, dueTime: nextDue.time }
            }
            const shift = scale === "month" ? (value: string) => addCalendarMonths(value, delta) : (value: string) => addCalendarDays(value, delta)
            if (mode === "move") return { start: shift(range.start), startTime: item.plannedStartTime, due: shift(range.end), dueTime: item.dueTime }
            if (mode === "start") {
                const start = shift(range.start)
                return { start: dateDay(start) > dateDay(range.end) ? range.end : start, startTime: item.plannedStartTime, due: range.end, dueTime: item.dueTime }
            }
            const due = shift(range.end)
            return { start: range.start, startTime: item.plannedStartTime, due: dateDay(due) < dateDay(range.start) ? range.start : due, dueTime: item.dueTime }
        }
        const pointerDelta = (pixelDelta: number) => {
            if (canFineDrag) {
                const step = scale === "quarter_hour" ? 5 : scale === "hour" ? 15 : 60
                return Math.round(pixelDelta / dayWidth * 1440 / step) * step
            }
            if (scale === "month") return Math.round(pixelDelta / (dayWidth * 30))
            return Math.round(ganttDragDayDelta(pixelDelta, dayWidth) / dateStep) * dateStep
        }
        const paint = (delta: number, pointer: PointerEvent) => {
            if (delta === latestDelta && dragPreview) return
            latestDelta = delta
            const next = nextSchedule(delta)
            const descendantChanges = mode === "move" && !canFineDrag ? descendantScheduleChanges(item.id, scale === "month" ? (value) => addCalendarMonths(value, delta) : (value) => addCalendarDays(value, delta)) : []
            const changes = new Map<string, { start: string; end: string; startTime: string | null; dueTime: string | null }>([[item.id, { start: next.start, startTime: next.startTime, end: next.due, dueTime: next.dueTime }]])
            for (const change of descendantChanges) if (change.plannedStartDate && change.dueDate) changes.set(change.id, { start: change.plannedStartDate, startTime: change.plannedStartTime, end: change.dueDate, dueTime: change.dueTime })
            const timestamp = canFineDrag ? `${next.start} ${next.startTime} → ${next.due} ${next.dueTime}` : `${next.start} → ${next.due}`
            setDragPreview({ itemId: item.id, pointerX: pointer.clientX, pointerY: pointer.clientY, label: timestamp, changes })
        }
        const move = (pointer: PointerEvent) => {
            if (pointer.pointerType === "touch" && touchZoomOnlyRef.current) {
                latestDelta = 0
                setDragPreview(null)
                return
            }
            paint(pointerDelta(pointer.clientX - originX), pointer)
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
            if (!latestDelta) return
            const next = nextSchedule(latestDelta)
            const descendants = mode === "move" && !canFineDrag ? descendantScheduleChanges(item.id, scale === "month" ? (value) => addCalendarMonths(value, latestDelta) : (value) => addCalendarDays(value, latestDelta)) : []
            requestSchedule(item, next.start, next.due, next.startTime, next.dueTime, descendants)
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
        const nextZoom = Math.min(MAX_ZOOM, Math.max(minimumZoom, available / span))
        zoomAnchorRef.current = { calendarDay: (first + last) / 2, localX: effectiveLeftWidth + available / 2, scrollTop: node.scrollTop }
        setZoom(nextZoom)
    }

    function selectScale(nextScale: Scale) {
        const node = scrollRef.current
        const localX = node ? effectiveLeftWidth + Math.max(0, node.clientWidth - effectiveLeftWidth) / 2 : 0
        const calendarDay = node ? rangeStart + (node.scrollLeft + localX - effectiveLeftWidth - timelineGutter) / dayWidth : dateDay(today)
        if (node) zoomAnchorRef.current = { calendarDay, localX, scrollTop: node.scrollTop }
        setZoom(ZOOM_PRESET[nextScale])
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
                calendarDay: rangeStart + (node.scrollLeft + localX - effectiveLeftWidth - timelineGutter) / dayWidth,
                localX,
                scrollTop: node.scrollTop,
            }
            flushSync(() => setPinching(true))
            return
        }
        const node = scrollRef.current
        if (!node) return
        const nextZoom = Math.min(MAX_ZOOM, Math.max(minimumZoom, pinchRef.current.zoom * distance / pinchRef.current.distance))
        if (Math.abs(nextZoom - zoom) < .001) return
        zoomAnchorRef.current = {
            calendarDay: pinchRef.current.calendarDay,
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
            node.scrollLeft = ganttAnchoredScrollLeft({ timelineDay: anchor.calendarDay - rangeStart, dayWidth, leftWidth: effectiveLeftWidth, localX: anchor.localX, gutter: timelineGutter })
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

    function collapseAllParents() {
        setCollapsed(parentIds(plan.items))
    }

    function expandAllParents() {
        setCollapsed(new Set())
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
            <div aria-hidden="true" className="border-b border-neutral-800 bg-neutral-950" style={{ ...fixedRowStyle(CATEGORY_ROW_HEIGHT), backgroundImage: CATEGORY_BACKGROUND, backgroundPosition: "0 0", backgroundRepeat: "repeat", backgroundSize: CATEGORY_BACKGROUND_SIZE }} />
        </div>
    }

    function renderLeft(row: DisplayRow) {
        const isRoot = row.depth === 0
        const categoryItems = row.category === "scheduled" ? scheduledItems : row.category === "shared" ? sharedItems : unscheduledItems
        const hasChildren = !row.external && categoryItems.some((item) => item.parentWorkItemId === row.item.id)
        const isActive = activeItemId === row.item.id
        const isUnscheduled = !displayRanges.has(row.item.id)
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
            {remainingByNextStep.has(row.item.id) ? <span title={`${remainingByNextStep.get(row.item.id)} more step${remainingByNextStep.get(row.item.id) === 1 ? "" : "s"} follow in sequence`} className="shrink-0"><RoundPill tone="neutral">+{remainingByNextStep.get(row.item.id)} more</RoundPill></span> : null}
            {contextLabel ? <span title={contextLabel === "external" ? "Prerequisite from outside this relationship" : "Work shared with another relationship"} className="shrink-0 text-[9px] text-neutral-600">{contextLabel}</span> : null}
            {isUnscheduled ? <Link href={`/${workspaceSlug}/work-items/${row.item.id}`} aria-label={`Schedule ${row.item.title}`} title="Unscheduled — open to add dates" className="flex h-7 w-7 shrink-0 items-center justify-center text-neutral-600 hover:text-white"><svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5"><path d="M5 3v3M15 3v3M3 7h14M4 5h12v12H4z" /></svg></Link> : null}
        </div>
    }

    function renderTimeline(row: DisplayRow) {
        const item = row.item
        const height = rowHeight(row)
        const barHeight = row.depth === 0 ? ROOT_BAR_HEIGHT : CHILD_BAR_HEIGHT
        const range = displayRanges.get(item.id) ?? (row.external && item.plannedStartDate ? { start: item.plannedStartDate, end: item.dueDate ?? item.plannedStartDate, derived: false } : null)
        const isGated = gatedRanges.has(item.id)
        const openEnded = hasOpenEnd(item, range)
        const showOpenTrail = openEnded && row.depth === 0
        const baseGeometry = range ? barGeometry(range, item) : null
        const gatedLeft = gatedLefts.get(item.id)
        const geometry = !baseGeometry ? null
            : gatedLeft !== undefined ? fixedGeometry(gatedLeft, 148)
            : openEnded && row.depth === 0 ? openBarGeometry(baseGeometry, todayLeft, 148)
            : openEnded || isGated ? withMinimumBarWidth(baseGeometry, row.depth === 0 ? 148 : 116)
            : baseGeometry
        const colours = relationshipPhaseColours(item.lifecyclePhase)
        const flashing = flashingItemId === item.id
        const barBorder = flashing ? "#ef4444" : colours.border
        const canDrag = canEdit && !pending && !row.external && !isGated && !openEnded && !["done", "canceled"].includes(item.status)
        // Derived summary bars move their descendants as a group and cannot be
        // resized independently without changing the hierarchy's meaning.
        const isSummary = range?.derived === true
        const canResize = Boolean(canDrag && !isSummary && geometry && geometry.width >= 40)
        const handleSpace = canResize ? 10 : 0
        const linkSize = barHeight
        const showBarLink = Boolean(geometry && geometry.width >= linkSize + handleSpace * 2 + 12)
        const showAssignee = Boolean(geometry && geometry.width >= 92)
        const isActive = activeItemId === item.id
        // Percentage scaling made wide lifecycle-stage bars grow by many more
        // pixels than ordinary work items. Expand every bar by the same one
        // pixel on each edge instead.
        const hoverTransform = isActive ? `scaleX(${1 + HOVER_BAR_OUTSET * 2 / geometry!.width}) scaleY(${1 + HOVER_BAR_OUTSET * 2 / barHeight})` : undefined
        const overdue = Boolean(range && !openEnded && !isGated && dateDay(range.end) < dateDay(today) && !["done", "canceled"].includes(item.status))
        const statusLabel = item.status === "done" ? "Completed" : item.status === "canceled" ? "Canceled" : overdue ? "Overdue" : null
        const derived = Boolean(range?.derived)
        return <div
            className={`relative border-b border-neutral-800 transition-colors ${isActive ? "bg-white/[0.025]" : ""}`}
            style={fixedRowStyle(height)}
        >
            {showOpenTrail && geometry ? <div aria-label={`${item.title} remains open after ${range!.start}`} className="pointer-events-none absolute z-10 border-t border-dashed" style={{ left: `${geometry.right}px`, width: `${OPEN_TRAIL_WIDTH}px`, top: `${height / 2}px`, borderColor: colours.border, opacity: .7 }}><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute h-3 w-3" style={{ right: "-8px", top: "-6px", color: colours.border }}><path d="m6 4 4 4-4 4" /></svg></div> : null}
            {range && geometry ? <div
                data-gantt-bar
                className={`absolute flex touch-none select-none items-center gap-1.5 overflow-hidden rounded-md border transition-[transform,border-color,opacity] ${isActive ? "z-30" : "z-20"} ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${row.depth > 0 && !canResize || isGated ? "border-dashed" : ""} ${item.status === "canceled" ? "opacity-45" : ""}`}
                style={{ top: `${(height - barHeight) / 2}px`, height: `${barHeight}px`, paddingLeft: `${handleSpace + 5}px`, paddingRight: `${(showBarLink ? linkSize + handleSpace : handleSpace) + 3}px`, left: `${geometry.left}px`, width: `${geometry.width}px`, borderColor: row.depth > 0 && canResize ? "transparent" : barBorder, backgroundColor: isGated ? "transparent" : colours.background, backgroundImage: derived ? "repeating-linear-gradient(135deg, transparent 0 5px, rgba(255,255,255,.055) 5px 7px)" : undefined, color: colours.text, boxShadow: flashing ? "0 0 0 2px rgba(239,68,68,.6)" : undefined, transform: hoverTransform, transformOrigin: "center", opacity: isGated ? .72 : undefined }}
                onPointerDown={(event) => startBarDrag(event, item, range, "move")}
                onMouseEnter={() => setActiveItemId(item.id)}
                onMouseLeave={() => setActiveItemId(null)}
                onFocus={() => setActiveItemId(item.id)}
                onBlur={() => setActiveItemId(null)}
                title={isGated ? `${item.title}: starts when its predecessor finishes` : `${item.title}: ${range.start}${timeScale ? ` ${timeLabel(item.plannedStartTime)}` : ""}${openEnded ? " · Open-ended" : ` → ${range.end}${timeScale ? ` ${timeLabel(item.dueTime)}` : ""}`}${derived ? " · Derived from child work" : ""}${statusLabel ? ` · ${statusLabel}` : ""}`}
            >
                {item.actualStartAt ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md opacity-25" style={{ width: `${Math.min(100, Math.max(2, ((dateDay((item.actualCompletedAt ?? today).slice(0, 10)) - dateDay(range.start) + 1) / Math.max(1, dateDay(range.end) - dateDay(range.start) + 1)) * 100))}%`, backgroundColor: colours.text }} /> : null}
                {row.depth > 0 && canResize ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-2.5 inset-y-0 z-30 border-y border-dashed" style={{ borderColor: barBorder }} /> : null}
                {canResize ? <button type="button" aria-label={`Resize start of ${item.title}`} onPointerDown={(event) => startBarDrag(event, item, range, "start")} className="absolute -inset-y-px -left-px z-40 w-[11px] cursor-ew-resize" style={{ backgroundColor: barBorder }} /> : null}
                {statusLabel ? <Status label={statusLabel} tone={item.status === "done" ? "green" : item.status === "canceled" ? "grey" : "red"} compact className="relative shrink-0" /> : null}
                {showAssignee && item.assignees[0] ? <div className="relative flex shrink-0 items-center gap-1"><Assignee name={item.assignees[0].username} avatarSrc={item.assignees[0].avatarUrl} compact compactSize={row.depth === 0 ? "md" : "sm"} />{item.assignees.length > 1 ? <span className={`shrink-0 font-medium ${row.depth === 0 ? "text-xs" : "text-[9px]"}`}>+{item.assignees.length - 1}</span> : null}</div> : null}
                <span className={`relative min-w-0 flex-1 truncate leading-none ${row.depth === 0 ? "text-sm font-semibold" : "text-[11px] font-normal"}`}>{item.title}</span>
                {showBarLink ? <Link href={`/${workspaceSlug}/work-items/${item.id}`} aria-label={`Open ${item.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} className="absolute inset-y-0 z-10 flex items-center justify-center border-l" style={{ right: `${handleSpace}px`, width: `${linkSize}px`, borderColor: barBorder, borderLeftStyle: row.depth > 0 ? "dashed" : "solid", backgroundColor: colours.background, color: barBorder }}><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={row.depth === 0 ? "h-[18px] w-[18px]" : "h-3.5 w-3.5"}><path d="M5 11 11 5M6 5h5v5" /></svg></Link> : null}
                {canResize ? <button type="button" aria-label={`Resize end of ${item.title}`} onPointerDown={(event) => startBarDrag(event, item, range, "end")} className="absolute -inset-y-px -right-px z-40 w-[11px] cursor-ew-resize" style={{ backgroundColor: barBorder }} /> : null}
            </div> : null}
        </div>
    }

    const dependencyPaths = plan.dependencies.flatMap((edge) => {
        const fromTop = rowTop.get(edge.dependsOnWorkItemId)
        const toTop = rowTop.get(edge.workItemId)
        const fromRange = displayRanges.get(edge.dependsOnWorkItemId)
        const toRange = displayRanges.get(edge.workItemId)
        const fromHeight = rowHeights.get(edge.dependsOnWorkItemId)
        const toHeight = rowHeights.get(edge.workItemId)
        if (fromTop === undefined || toTop === undefined || fromHeight === undefined || toHeight === undefined || !fromRange || !toRange) return []
        const sourceItem = plan.items.find((item) => item.id === edge.dependsOnWorkItemId) ?? plan.externalItems.find((item) => item.id === edge.dependsOnWorkItemId)
        const targetItem = plan.items.find((item) => item.id === edge.workItemId)
        const sourceOpenEnded = sourceItem ? hasOpenEnd(sourceItem, fromRange) : false
        const sourceGeometry = !sourceOpenEnded ? barGeometry(fromRange, sourceItem)
            : sourceItem?.parentWorkItemId ? withMinimumBarWidth(barGeometry(fromRange, sourceItem), 116)
            : openBarGeometry(barGeometry(fromRange, sourceItem), todayLeft, 148)
        const gatedTargetLeft = targetItem ? gatedLefts.get(targetItem.id) : undefined
        const targetGeometry = gatedTargetLeft !== undefined ? fixedGeometry(gatedTargetLeft, 148)
            : targetItem && gatedRanges.has(targetItem.id) ? withMinimumBarWidth(barGeometry(toRange, targetItem), targetItem.parentWorkItemId ? 116 : 148)
            : barGeometry(toRange, targetItem)
        // An open-ended source's bar edge is its live "now" front; route the
        // connector out past its trail before it turns down so it leaves from a
        // divider rather than dropping straight off the bar.
        const sourceDivider = sourceOpenEnded ? sourceGeometry.right + (sourceItem?.parentWorkItemId ? GATED_GAP : OPEN_TRAIL_WIDTH) : sourceGeometry.sourceDivider
        const sourceBarRight = sourceGeometry.right
        const targetDivider = targetGeometry.targetDivider
        const targetBarLeft = targetGeometry.left
        const y1 = fromTop + fromHeight / 2
        const y2 = toTop + toHeight / 2
        // One clean elbow: run out from the bar to a single divider channel,
        // drop straight to the target's row, then turn in. The channel sits just
        // past the source but never beyond the target's approach, so the two
        // vertical segments of the old staircase can't collapse into a jog.
        const channel = Math.max(sourceBarRight, Math.min(sourceDivider, targetDivider))
        return [{ key: `${edge.workItemId}-${edge.dependsOnWorkItemId}`, itemIds: [edge.workItemId, edge.dependsOnWorkItemId], external: edge.external, path: `M ${sourceBarRight} ${y1} H ${channel} V ${y2} H ${targetBarLeft}`, arrow: ganttArrowHeadPath(targetBarLeft, targetDivider, y2) }]
    })

    // A parent with siblings that do not depend on one another represents
    // concurrent work.  Its single trunk branches into every visible child;
    // sequential child dependencies continue to use the existing overlay above.
    const siblingDependencyPairs = new Set(plan.dependencies.map((edge) => `${edge.workItemId}:${edge.dependsOnWorkItemId}`))
    const parallelChildPaths = [...new Set(plan.items.map((item) => item.parentWorkItemId).filter((id): id is string => Boolean(id)))].flatMap((parentId) => {
        const children = plan.items.filter((item) => item.parentWorkItemId === parentId && rowTop.has(item.id) && displayRanges.has(item.id))
        if (children.length < 2 || children.some((child) => children.some((other) => child.id !== other.id && (siblingDependencyPairs.has(`${child.id}:${other.id}`) || siblingDependencyPairs.has(`${other.id}:${child.id}`))))) return []
        const parentTop = rowTop.get(parentId)
        const parentHeight = rowHeights.get(parentId)
        const parentRange = displayRanges.get(parentId)
        if (parentTop === undefined || !parentHeight || !parentRange) return []
        const parent = plan.items.find((item) => item.id === parentId)
        const parentGeometry = barGeometry(parentRange, parent)
        const branchRows = children.map((child) => ({ child, top: rowTop.get(child.id)!, height: rowHeights.get(child.id)!, geometry: barGeometry(displayRanges.get(child.id)!, child) })).sort((a, b) => a.top - b.top)
        const trunkX = parentGeometry.sourceDivider
        const parentY = parentTop + parentHeight / 2
        const lastY = branchRows[branchRows.length - 1].top + branchRows[branchRows.length - 1].height / 2
        const paths: Array<{ key: string; itemIds: string[]; external: boolean; path: string; arrow: string | null }> = [{ key: `parallel-trunk-${parentId}`, itemIds: [parentId, ...children.map((child) => child.id)], external: false, path: `M ${parentGeometry.right} ${parentY} H ${trunkX} V ${lastY}`, arrow: null }]
        for (const row of branchRows) {
            const y = row.top + row.height / 2
            paths.push({ key: `parallel-branch-${parentId}-${row.child.id}`, itemIds: [parentId, row.child.id], external: false, path: `M ${trunkX} ${y} H ${row.geometry.targetDivider} H ${row.geometry.left}`, arrow: ganttArrowHeadPath(row.geometry.left, row.geometry.targetDivider, y) })
        }
        return paths
    })
    const connectorPaths = [...dependencyPaths, ...parallelChildPaths]

    const parentDocument = typeof window !== "undefined" ? (window.parent !== window ? window.parent.document : document) : null
    const dragging = Boolean(dragPreview)

    return <section id="plan" className="relative isolate mt-4 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900/70">
        <div className="flex h-9 items-center justify-between gap-2 border-b border-neutral-700 bg-neutral-950 px-2">
            <div className="flex min-w-0 items-center gap-1">
                {isNarrow ? <button type="button" disabled={dragging} onClick={() => setLabelsVisible((current) => !current)} aria-label={labelsVisible ? "Hide work item labels" : "Show work item labels"} aria-pressed={labelsVisible} title={labelsVisible ? "Hide labels" : "Show labels"} className={`flex h-7 w-7 items-center justify-center rounded-md border disabled:opacity-40 ${labelsVisible ? "border-neutral-600 bg-neutral-800 text-white" : "border-neutral-800 text-neutral-500"}`}><Icon kind="labels" /></button> : null}
                <button type="button" disabled={dragging} onClick={goToToday} className="h-7 rounded-md border border-neutral-700 bg-white px-2 text-[11px] font-semibold text-neutral-950 disabled:opacity-40">Today</button>
                <button type="button" disabled={dragging} onClick={fitPlan} aria-label="Fit plan" title="Fit plan" className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white disabled:opacity-40"><Icon kind="fit" /></button>
                <button type="button" disabled={dragging} onClick={expandAllParents} className="hidden h-7 px-1.5 text-[10px] font-medium text-neutral-400 hover:text-white disabled:opacity-40 sm:block">Expand all</button>
                <button type="button" disabled={dragging} onClick={collapseAllParents} className="hidden h-7 px-1.5 text-[10px] font-medium text-neutral-400 hover:text-white disabled:opacity-40 sm:block">Collapse all</button>
                {pending ? <span role="status" aria-live="polite" className="ml-1 truncate text-[10px] text-neutral-500">Saving…</span> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
                <div className="flex items-center rounded-md border border-neutral-700 bg-neutral-900 p-0.5">
                    <button type="button" disabled={dragging || zoom <= minimumZoom} onClick={() => zoomAtTimelineCentre(zoom / 1.6)} aria-label="Zoom out" title="Zoom out" className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-30"><Icon kind="minus" /></button>
                    <button type="button" disabled={dragging || zoom >= MAX_ZOOM} onClick={() => zoomAtTimelineCentre(zoom * 1.6)} aria-label="Zoom in" title="Zoom in" className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-30"><Icon kind="plus" /></button>
                </div>
                <div className="flex items-center rounded-md border border-neutral-700 bg-neutral-900 p-0.5">
                    {([['hour', 'hr'], ['day', 'd'], ['week', 'w'], ['month', 'mo']] as const).map(([value, label]) => <button
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
            <div className="grid items-start" style={{ gridTemplateColumns: `${effectiveLeftWidth}px ${contentWidth}px`, gridAutoRows: "max-content", minWidth: `${effectiveLeftWidth + contentWidth}px` }}>
                <div className={`sticky left-0 top-0 z-50 flex h-11 min-w-0 items-center overflow-hidden border-b border-neutral-700 bg-neutral-950 text-xs font-semibold text-white ${effectiveLeftWidth ? "border-r px-2" : "border-r-0 px-0"}`}>
                    <span className="truncate">Plan</span>
                    {!isNarrow ? <button type="button" aria-label="Resize timeline label column" title="Drag to resize" onPointerDown={startDividerDrag} className="group absolute -right-1.5 inset-y-0 hidden w-3 cursor-col-resize touch-none lg:block"><span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-neutral-400" /></button> : null}
                </div>
                <div className="sticky top-0 z-40 h-11 border-b border-neutral-700 bg-neutral-950">
                    {headerLabels.map((label) => <span key={label.day} className={`absolute left-0 flex border-l border-neutral-800 px-1 text-[10px] text-neutral-500 ${timeScale ? "h-5 items-center" : "top-0 h-full items-center"}`} style={{ left: `${label.left}px` }}>{dateLabel(label.day, scale)}</span>)}
                    {hourLabels.map((label) => <span key={label.minutes} className="absolute top-5 flex h-6 items-center border-l border-neutral-800 px-1 font-mono text-[9px] text-neutral-600" style={{ left: `${label.left}px` }}>{String(Math.floor(label.minutes / 60) % 24).padStart(2, "0")}:{String(label.minutes % 60).padStart(2, "0")}</span>)}
                    <span className="absolute inset-y-0 z-10 w-px bg-red-400/60" style={{ left: `${todayLeft}px` }} />
                </div>
                <div className={`sticky left-0 z-40 flex min-w-0 items-center overflow-hidden border-b border-b-neutral-800 bg-neutral-950 text-[10px] font-semibold uppercase tracking-[.08em] text-neutral-400 ${effectiveLeftWidth ? "border-r border-r-neutral-700 px-2" : "border-r-0 px-0"}`} style={fixedRowStyle(CATEGORY_ROW_HEIGHT)}>{effectiveLeftWidth ? "Milestones" : null}</div><div className="relative border-b border-neutral-800" style={fixedRowStyle(CATEGORY_ROW_HEIGHT)}>{visibleMilestones.map(({ milestone, left }) => { const colours = milestone.kind === "relationship_started" ? "border-sky-400 bg-sky-950" : milestone.kind === "client_invoiced" ? "border-amber-400 bg-amber-950" : milestone.kind === "onboarding_completed" ? "border-violet-400 bg-violet-950" : "border-emerald-400 bg-emerald-950"; const marker = <span className={`block h-2.5 w-2.5 rotate-45 border ${colours}`} />; return milestone.href ? <a key={milestone.id} href={milestone.href} aria-label={`${milestone.title}, ${milestone.occurredAt.slice(0, 10)}`} title={`${milestone.title} · ${milestone.occurredAt.slice(0, 10)}`} className="absolute flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded focus:outline-none focus:ring-1 focus:ring-neutral-300" style={{ left, top: 0 }}>{marker}</a> : <span key={milestone.id} role="img" aria-label={`${milestone.title}, ${milestone.occurredAt.slice(0, 10)}`} title={`${milestone.title} · ${milestone.occurredAt.slice(0, 10)}`} className="absolute flex h-7 w-7 -translate-x-1/2 items-center justify-center" style={{ left, top: 0 }}>{marker}</span> })}</div>
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
            <svg aria-hidden="true" className="pointer-events-none absolute top-0 z-30 overflow-visible" style={{ left: `${effectiveLeftWidth}px` }} width={contentWidth} height={chartHeight}>{connectorPaths.map(({ key, itemIds, external, path, arrow }) => { const active = itemIds.includes(activeItemId ?? ""); return <g key={key} fill="none" stroke={active ? ACTIVE_STRUCTURAL_LINE : STRUCTURAL_LINE} strokeWidth={active ? "2" : "1.5"} strokeDasharray={external ? "4 3" : undefined} strokeLinejoin="miter" strokeLinecap="square"><path d={path} />{arrow ? <path d={arrow} /> : null}</g> })}</svg>
            {dragPreview ? <div aria-live="polite" className="pointer-events-none fixed z-[80] -translate-y-full rounded-md border border-neutral-600 bg-neutral-950 px-2 py-1 font-mono text-[10px] text-neutral-200 shadow-xl" style={{ left: `${Math.min(dragPreview.pointerX + 10, (typeof window !== "undefined" ? window.innerWidth : dragPreview.pointerX + 200) - 160)}px`, top: `${dragPreview.pointerY - 8}px` }}>{dragPreview.label}</div> : null}
        </div>
        {currentWork ? <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-neutral-700 bg-neutral-950 px-3 py-2 text-xs">
            <span className="font-medium text-neutral-500">Current</span>
            <Link href={`/${workspaceSlug}/work-items/${currentWork.id}`} className="min-w-0 flex-1 truncate font-medium text-white hover:underline">{currentWork.title}</Link>
            {currentWork.unassignedCount ? <span className="text-amber-300">{currentWork.unassignedCount} service{currentWork.unassignedCount === 1 ? "" : "s"} unassigned</span> : null}
            <label className="flex items-center gap-1.5 text-neutral-400"><input type="checkbox" checked={confirmBeforeProceeding} onChange={(event) => { setConfirmBeforeProceeding(event.target.checked); window.localStorage.setItem("betelgeze-current-work-confirm", String(event.target.checked)) }} />Confirm before continuing</label>
            <button type="button" disabled={pending || currentWork.blocked || currentWork.action === "await_payment" || currentWork.action === "await_onboarding"} onClick={() => {
                if (confirmBeforeProceeding && !window.confirm(`Complete “${currentWork.title}” and continue?`)) return
                startTransition(() => { void proceedRelationshipCurrentWork(workspaceSlug, relationshipId, currentWork.id).then((outcome) => {
                    if (!outcome.ok) {
                        setResult({ status: "invalid", message: outcome.error })
                        return
                    }
                    router.refresh()
                    postGanttSync(workspaceSlug)
                }).catch(() => setResult({ status: "invalid", message: "Could not proceed with this work item" })) })
            }} className="h-8 rounded bg-white px-3 text-xs font-semibold text-neutral-950 disabled:opacity-45">{currentWork.action === "send_invoice" ? "Send invoice" : currentWork.action === "await_payment" ? "Awaiting payment" : currentWork.action === "await_onboarding" ? "Onboarding in progress" : "Mark complete"}</button>
        </div> : null}
        <MutationError result={result} />
        {cascade && parentDocument ? createPortal(<div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-3"><div role="dialog" aria-modal="true" aria-labelledby="gantt-cascade-title" className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-950 p-3 shadow-2xl"><h3 id="gantt-cascade-title" className="text-sm font-semibold text-white">Move dependent work?</h3><p className="mt-1 text-xs text-neutral-400">This will update {cascade.length} work item{cascade.length === 1 ? "" : "s"}.</p><div className="mt-2 max-h-64 divide-y divide-neutral-900 overflow-y-auto rounded-lg border border-neutral-800">{cascade.map((change) => { const original = committedRanges.get(change.id); return <div key={change.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-2.5 py-2 text-xs"><span className="truncate text-neutral-200">{change.title}</span><span className="shrink-0 font-mono text-[10px] text-neutral-500">{original ? `${original.start}–${original.end} → ` : ""}{change.plannedStartDate}–{change.dueDate}</span></div> })}</div><div className="mt-3 flex justify-end gap-1.5"><button type="button" onClick={() => { setCascade(null); void reload() }} className="h-8 px-2.5 text-xs text-neutral-400 hover:text-white">Cancel</button><button type="button" autoFocus disabled={pending} onClick={() => { const changes = cascade; setCascade(null); mutate(() => applyGanttScheduleChanges(workspaceSlug, relationshipId, changes)) }} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">Confirm</button></div></div></div>, parentDocument.body) : null}
    </section>
}
