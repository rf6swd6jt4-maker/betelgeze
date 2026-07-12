"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react"
import { Assignee, relationshipPhaseColours } from "@/components/ui"
import { ganttSyncChannelName, postGanttSync } from "@/lib/ui/gantt-sync"
import { dateDay, effectiveGanttRanges, type ScheduleChange } from "@/lib/relationship-gantt-schedule"
import type { RelationshipGanttDependency, RelationshipGanttItem, RelationshipGanttPlan } from "@/lib/relationship-gantt"
import {
    applyGanttScheduleChanges,
    createGanttDependency,
    loadGanttPlan,
    previewGanttScheduleChange,
    removeGanttDependency,
    type GanttMutationResult,
} from "./gantt-actions"

type Scale = "day" | "week" | "month"
type DisplayRow = { item: RelationshipGanttItem; depth: number; external?: boolean }

const ROW_HEIGHT = 46
const HEADER_HEIGHT = 44
const EMPTY_LANE_HEIGHT = 96
const LEFT_WIDTH = 360
const RANGE_DAYS = 730
const MAX_ZOOM = 6
const SCALE_WIDTH: Record<Scale, number> = { day: 64, week: 28, month: 12 }

function dateLabel(day: number, scale: Scale) {
    const date = new Date(day * 86_400_000)
    return new Intl.DateTimeFormat("en-IE", scale === "month" ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" }).format(date)
}

function flattenRows(items: RelationshipGanttItem[], collapsed: Set<string>, scheduled: boolean) {
    const ranges = effectiveGanttRanges(items)
    const byId = new Map(items.map((item) => [item.id, item]))
    const children = new Map<string, RelationshipGanttItem[]>()
    for (const item of items) if (item.parentWorkItemId && byId.has(item.parentWorkItemId)) children.set(item.parentWorkItemId, [...(children.get(item.parentWorkItemId) ?? []), item])
    for (const rows of children.values()) rows.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
    const roots = items.filter((item) => !item.parentWorkItemId || !byId.has(item.parentWorkItemId)).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
    const output: DisplayRow[] = []
    const visit = (item: RelationshipGanttItem, depth: number) => {
        if (Boolean(ranges.get(item.id)) === scheduled) output.push({ item, depth })
        // Collapse only hides children in the timeline; the unscheduled list must
        // always show every descendant so it stays reachable for scheduling.
        if (!scheduled || !collapsed.has(item.id)) for (const child of children.get(item.id) ?? []) visit(child, depth + 1)
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
    const touchPointsRef = useRef(new Map<number, { x: number; y: number }>())
    const pinchRef = useRef<{ distance: number; zoom: number } | null>(null)
    // The plan is held locally so edits can be painted optimistically and so
    // cross-tab changes can refresh it without a full route reload.
    const [plan, setPlan] = useState(initialPlan)
    const [scale, setScale] = useState<Scale>("week")
    const [zoom, setZoom] = useState(1)
    const [unscheduledOpen, setUnscheduledOpen] = useState(true)
    const [cascade, setCascade] = useState<ScheduleChange[] | null>(null)
    const [result, setResult] = useState<GanttMutationResult | null>(null)
    const [selectedDependency, setSelectedDependency] = useState<RelationshipGanttDependency | null>(null)
    const [dependencySource, setDependencySource] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const [dateEditor, setDateEditor] = useState<RelationshipGanttItem | null>(null)
    const [editStart, setEditStart] = useState("")
    const [editDue, setEditDue] = useState("")

    // The server can stream a refreshed plan into this long-lived client view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { setPlan(initialPlan) }, [initialPlan])

    const dayWidth = SCALE_WIDTH[scale] * zoom
    const today = new Date().toISOString().slice(0, 10)
    const rangeStart = dateDay(today) - 180
    const timelineWidth = RANGE_DAYS * dayWidth
    const todayLeft = (dateDay(today) - rangeStart) * dayWidth
    const allVisibleItems = useMemo(() => [...plan.items, ...plan.externalItems], [plan])
    const ranges = useMemo(() => effectiveGanttRanges(allVisibleItems), [allVisibleItems])
    const relationshipItems = plan.items.filter((item) => item.section === "relationship")
    const sharedItems = plan.items.filter((item) => item.section === "shared")
    const relationshipRows = flattenRows(relationshipItems, new Set(), true)
    const sharedRows = flattenRows(sharedItems, new Set(), true)
    const unscheduledRelationship = flattenRows(relationshipItems, new Set(), false)
    const unscheduledShared = flattenRows(sharedItems, new Set(), false)
    const unscheduledRows = [...unscheduledRelationship, ...unscheduledShared]
    const externalRows: DisplayRow[] = plan.externalItems.map((item) => ({ item, depth: 0, external: true }))
    const milestoneHeight = plan.milestones.length ? ROW_HEIGHT : 0
    const relationshipRowsTop = HEADER_HEIGHT + milestoneHeight
    const sharedRowsTop = relationshipRowsTop + relationshipRows.length * ROW_HEIGHT
    const emptyTimeline = !relationshipRows.length && !sharedRows.length && !externalRows.length
    const contentHeight = sharedRowsTop + (sharedRows.length + externalRows.length) * ROW_HEIGHT + (emptyTimeline ? EMPTY_LANE_HEIGHT : 0)
    const rowTop = new Map<string, number>()
    relationshipRows.forEach((row, index) => rowTop.set(row.item.id, relationshipRowsTop + index * ROW_HEIGHT))
    ;[...sharedRows, ...externalRows].forEach((row, index) => rowTop.set(row.item.id, sharedRowsTop + index * ROW_HEIGHT))

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
        const node = scrollRef.current
        if (!node) return
        node.scrollLeft = Math.max(0, (dateDay(today) - rangeStart) * SCALE_WIDTH[scale] - (node.clientWidth - LEFT_WIDTH) / 2)
    }, [rangeStart, scale, today])

    const zoomAt = useCallback((clientX: number, requestedZoom: number) => {
        const node = scrollRef.current
        if (!node) return
        const nextZoom = Math.min(MAX_ZOOM, Math.max(1, requestedZoom))
        if (Math.abs(nextZoom - zoom) < .001) return
        const localX = clientX - node.getBoundingClientRect().left
        const timelineDay = (node.scrollLeft + localX - LEFT_WIDTH) / dayWidth
        setZoom(nextZoom)
        requestAnimationFrame(() => {
            node.scrollLeft = Math.max(0, LEFT_WIDTH + timelineDay * SCALE_WIDTH[scale] * nextZoom - localX)
        })
    }, [dayWidth, scale, zoom])

    useEffect(() => {
        const node = scrollRef.current
        if (!node) return
        const handleWheel = (event: WheelEvent) => {
            if (!event.ctrlKey && !event.metaKey) return
            event.preventDefault()
            zoomAt(event.clientX, zoom * Math.exp(-event.deltaY * .01))
        }
        node.addEventListener("wheel", handleWheel, { passive: false })
        return () => node.removeEventListener("wheel", handleWheel)
    }, [zoom, zoomAt])

    useEffect(() => {
        if (!dependencySource) return
        const clear = () => setDependencySource(null)
        window.addEventListener("pointerup", clear, { once: true })
        return () => window.removeEventListener("pointerup", clear)
    }, [dependencySource])

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

    function applyOptimisticDates(id: string, plannedStartDate: string, dueDate: string) {
        setPlan((current) => ({ ...current, items: current.items.map((item) => item.id === id ? { ...item, plannedStartDate, dueDate } : item) }))
    }

    function requestSchedule(item: RelationshipGanttItem, start: string, due: string) {
        // Paint the new position immediately so the bar never snaps back while
        // the server confirms; reload reconciles (or reverts) against the truth.
        applyOptimisticDates(item.id, start, due)
        startTransition(async () => {
            const preview = await previewGanttScheduleChange(workspaceSlug, relationshipId, { id: item.id, plannedStartDate: start, dueDate: due })
            if (preview.status !== "cascade_required") { setResult(preview); void reload(); return }
            if (preview.changes.length > 1) { setCascade(preview.changes); return }
            refreshAfter(await applyGanttScheduleChanges(workspaceSlug, relationshipId, preview.changes))
        })
    }

    function startBarDrag(event: ReactPointerEvent<HTMLElement>, item: RelationshipGanttItem, mode: "move" | "start" | "end") {
        if (!canEdit || window.matchMedia("(max-width: 1023px)").matches || ["done", "canceled"].includes(item.status)) return
        event.preventDefault()
        const range = ranges.get(item.id)
        if (!range || range.derived) return
        const originX = event.clientX
        const barNode = event.currentTarget.closest("[data-gantt-bar]") as HTMLElement | null
        if (!barNode) return
        const originalStart = dateDay(range.start)
        const originalEnd = dateDay(range.end)
        const move = (pointer: PointerEvent) => {
            const delta = Math.round((pointer.clientX - originX) / dayWidth)
            barNode.style.transform = `translateX(${delta * dayWidth}px)`
        }
        const finish = (pointer: PointerEvent) => {
            window.removeEventListener("pointermove", move)
            window.removeEventListener("pointerup", finish)
            barNode.style.transform = ""
            const delta = Math.round((pointer.clientX - originX) / dayWidth)
            if (!delta) return
            const startDay = mode === "end" ? originalStart : Math.min(originalEnd, originalStart + delta)
            const endDay = mode === "start" ? originalEnd : Math.max(originalStart, originalEnd + delta)
            requestSchedule(item, new Date(startDay * 86_400_000).toISOString().slice(0, 10), new Date(endDay * 86_400_000).toISOString().slice(0, 10))
        }
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", finish)
    }

    function dropUnscheduled(event: React.DragEvent<HTMLElement>) {
        if (!canEdit) return
        event.preventDefault()
        const id = event.dataTransfer.getData("application/x-betelgeze-unscheduled")
        const item = plan.items.find((candidate) => candidate.id === id)
        if (!item) return
        const rect = event.currentTarget.getBoundingClientRect()
        const date = new Date((rangeStart + Math.max(0, Math.floor((event.clientX - rect.left) / dayWidth))) * 86_400_000).toISOString().slice(0, 10)
        requestSchedule(item, date, date)
    }

    function openDateEditor(item: RelationshipGanttItem) {
        const range = ranges.get(item.id)
        if (!canEdit || range?.derived) return
        setDateEditor(item)
        setEditStart(range?.start ?? today)
        setEditDue(range?.end ?? today)
    }

    function goToToday() {
        const node = scrollRef.current
        if (!node) return
        node.scrollTo({ left: Math.max(0, todayLeft - (node.clientWidth - LEFT_WIDTH) / 2), behavior: "smooth" })
    }

    function selectScale(nextScale: Scale) {
        setZoom(1)
        setScale(nextScale)
    }

    function updateTouchPoint(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.pointerType !== "touch") return
        touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        const points = [...touchPointsRef.current.values()]
        if (points.length !== 2) return
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
        if (!pinchRef.current) {
            pinchRef.current = { distance, zoom }
            return
        }
        event.preventDefault()
        zoomAt((points[0].x + points[1].x) / 2, pinchRef.current.zoom * distance / pinchRef.current.distance)
    }

    function endTouch(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.pointerType !== "touch") return
        touchPointsRef.current.delete(event.pointerId)
        if (touchPointsRef.current.size < 2) pinchRef.current = null
    }

    function renderLeft() {
        return <div
            aria-hidden="true"
            className="sticky left-0 z-20 h-[46px] border-r border-neutral-700 bg-neutral-900"
        />
    }

    function renderTimeline(row: DisplayRow) {
        const item = row.item
        const range = ranges.get(item.id) ?? (row.external && item.plannedStartDate ? { start: item.plannedStartDate, end: item.dueDate ?? item.plannedStartDate, derived: false } : null)
        const colours = relationshipPhaseColours(item.lifecyclePhase)
        return <div
            className="relative h-[46px]"
            onDragOver={(event) => { if (canEdit) event.preventDefault() }}
            onDrop={dropUnscheduled}
        >
            {range ? <div
                data-gantt-bar
                className={`group absolute top-2 h-7 select-none rounded-md border ${range.derived ? "border-dashed" : "cursor-grab"}`}
                style={{ left: `${(dateDay(range.start) - rangeStart) * dayWidth}px`, width: `${Math.max(dayWidth * .7, (dateDay(range.end) - dateDay(range.start) + 1) * dayWidth)}px`, borderColor: colours.border, backgroundColor: colours.background, color: colours.text }}
                onPointerDown={(event) => startBarDrag(event, item, "move")}
                onClick={() => { if (window.matchMedia("(max-width: 1023px)").matches) openDateEditor(item) }}
                title={`${item.title}: ${range.start} → ${range.end}`}
            >
                {item.actualStartAt ? <span className="absolute inset-y-0 left-0 rounded-l-md opacity-45" style={{ width: `${Math.min(100, Math.max(8, ((dateDay((item.actualCompletedAt ?? today).slice(0, 10)) - dateDay(range.start) + 1) / Math.max(1, dateDay(range.end) - dateDay(range.start) + 1)) * 100))}%`, backgroundColor: colours.text }} /> : null}
                {!range.derived && canEdit ? <button type="button" aria-label="Resize start" onPointerDown={(event) => { event.stopPropagation(); startBarDrag(event, item, "start") }} className="absolute inset-y-0 left-0 hidden w-2 cursor-ew-resize group-hover:block lg:block" /> : null}
                <span className="relative block truncate px-2 py-1 text-xs">{item.title}</span>
                {!range.derived && canEdit ? <button type="button" aria-label="Resize due date" onPointerDown={(event) => { event.stopPropagation(); startBarDrag(event, item, "end") }} className="absolute inset-y-0 right-0 hidden w-2 cursor-ew-resize group-hover:block lg:block" /> : null}
                {canEdit && !range.derived && !row.external ? <>
                    <button type="button" aria-label={`Start dependency from ${item.title}`} onPointerDown={(event) => { event.stopPropagation(); setDependencySource(item.id) }} className="absolute -right-1.5 top-2 hidden h-3 w-3 rounded-full border border-neutral-300 bg-neutral-950 lg:block" />
                    <button type="button" aria-label={`Complete dependency at ${item.title}`} onPointerUp={(event) => { event.stopPropagation(); if (dependencySource && dependencySource !== item.id) { mutate(() => createGanttDependency(workspaceSlug, relationshipId, item.id, dependencySource)); setDependencySource(null) } }} className="absolute -left-1.5 top-2 hidden h-3 w-3 rounded-full border border-neutral-500 bg-neutral-950 lg:block" />
                </> : null}
            </div> : null}
        </div>
    }

    const dependencyPaths = plan.dependencies.flatMap((edge) => {
        const fromTop = rowTop.get(edge.dependsOnWorkItemId)
        const toTop = rowTop.get(edge.workItemId)
        const predecessorItem = allVisibleItems.find((item) => item.id === edge.dependsOnWorkItemId)
        const fromRange = edge.source === "parent_auto" && predecessorItem?.plannedStartDate
            ? { start: predecessorItem.plannedStartDate, end: predecessorItem.dueDate ?? predecessorItem.plannedStartDate, derived: false }
            : ranges.get(edge.dependsOnWorkItemId)
        const toRange = ranges.get(edge.workItemId)
        if (fromTop === undefined || toTop === undefined || !fromRange || !toRange) return []
        const x1 = (dateDay(fromRange.end) - rangeStart + 1) * dayWidth
        const x2 = (dateDay(toRange.start) - rangeStart) * dayWidth
        const y1 = fromTop + ROW_HEIGHT / 2
        const y2 = toTop + ROW_HEIGHT / 2
        return [{ edge, path: `M ${x1} ${y1} C ${x1 + 20} ${y1}, ${x2 - 20} ${y2}, ${x2} ${y2}` }]
    })

    return <section id="plan" className="relative mt-4 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900">
        <div className="absolute right-3 top-1.5 z-[70] flex items-center gap-1.5">
            <button type="button" onClick={goToToday} className="h-8 rounded-full bg-white px-3 text-xs font-semibold text-neutral-950 shadow-sm">Today</button>
            {([['day', 'd'], ['week', 'w'], ['month', 'mo']] as const).map(([value, label]) => <button
                type="button"
                key={value}
                onClick={() => selectScale(value)}
                aria-label={`${value} view`}
                aria-pressed={scale === value}
                className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-medium text-white ${scale === value ? "border-neutral-400 bg-neutral-700" : "border-neutral-600 bg-neutral-800/95 hover:border-neutral-400"}`}
            >{label}</button>)}
        </div>
        <div
            ref={scrollRef}
            className="relative max-h-[calc(100vh-18rem)] min-h-[28rem] overflow-auto overscroll-contain"
            style={{ touchAction: "pan-x pan-y" }}
            onPointerDown={updateTouchPoint}
            onPointerMove={updateTouchPoint}
            onPointerUp={endTouch}
            onPointerCancel={endTouch}
            title="Pinch or use Ctrl/Cmd + wheel to zoom"
        >
            <div className="grid" style={{ gridTemplateColumns: `${LEFT_WIDTH}px ${timelineWidth}px`, minWidth: `${LEFT_WIDTH + timelineWidth}px` }}>
                <div className="sticky left-0 top-0 z-50 flex h-11 items-center border-b border-r border-neutral-700 bg-neutral-900 px-3 text-sm font-semibold text-white">Relationship Timeline</div>
                <div className="sticky top-0 z-40 h-11 border-b border-neutral-700 bg-neutral-900" onDragOver={(event) => { if (canEdit) event.preventDefault() }} onDrop={dropUnscheduled}>
                    {headerLabels.map((label) => <span key={label.day} className="absolute top-0 flex h-full items-center px-1 text-[10px] text-neutral-500" style={{ left: `${label.left}px` }}>{dateLabel(label.day, scale)}</span>)}
                    <span className="absolute inset-y-0 z-10 w-px bg-red-400/60" style={{ left: `${todayLeft}px` }} />
                </div>
                {plan.milestones.length ? <><div aria-hidden="true" className="sticky left-0 z-30 h-[46px] border-r border-neutral-700 bg-neutral-900" /><div className="relative h-[46px]">{plan.milestones.map((milestone) => { const left = (dateDay(milestone.occurredAt.slice(0, 10)) - rangeStart) * dayWidth; const marker = <span className="block h-3 w-3 rotate-45 border border-emerald-400 bg-emerald-950" />; return milestone.href ? <a key={milestone.id} href={milestone.href} title={`${milestone.title} · ${milestone.occurredAt.slice(0, 10)}`} className="absolute top-4" style={{ left }}>{marker}</a> : <span key={milestone.id} title={`${milestone.title} · ${milestone.occurredAt.slice(0, 10)}`} className="absolute top-4" style={{ left }}>{marker}</span> })}</div></> : null}
                {relationshipRows.map((row) => <div className="contents" key={`relationship-${row.item.id}`}>{renderLeft()}{renderTimeline(row)}</div>)}
                {[...sharedRows, ...externalRows].map((row) => <div className="contents" key={`shared-${row.item.id}`}>{renderLeft()}{renderTimeline(row)}</div>)}
                {emptyTimeline ? <div className="contents"><div aria-hidden="true" className="sticky left-0 z-20 h-24 border-r border-neutral-700 bg-neutral-900" /><div className="relative h-24" onDragOver={(event) => { if (canEdit) event.preventDefault() }} onDrop={dropUnscheduled}><span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-neutral-600">{canEdit ? "Drag a card from the tray below, or tap it, to schedule" : "Nothing scheduled"}</span></div></div> : null}
            </div>
            <div className="pointer-events-none absolute z-20 w-px bg-red-400/70" style={{ left: `${LEFT_WIDTH + todayLeft}px`, top: `${HEADER_HEIGHT}px`, height: `${Math.max(0, contentHeight - HEADER_HEIGHT)}px` }} />
            <svg aria-hidden="true" className="pointer-events-none absolute left-[360px] top-0 z-30 overflow-visible" width={timelineWidth} height={Math.max(1, contentHeight)}>{dependencyPaths.map(({ edge, path }) => <path key={`${edge.workItemId}-${edge.dependsOnWorkItemId}`} d={path} fill="none" stroke={selectedDependency === edge ? "#fff" : "#737373"} strokeWidth="1.5" className="pointer-events-auto cursor-pointer" onClick={() => setSelectedDependency(edge)} />)}</svg>
        </div>
        {unscheduledRows.length ? <div className="border-t border-neutral-800 bg-black">
            <button type="button" onClick={() => setUnscheduledOpen((value) => !value)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-neutral-400 hover:text-white">
                <span aria-hidden="true">{unscheduledOpen ? "⌄" : "›"}</span>
                <span>Unscheduled</span>
                <span className="tabular-nums text-neutral-600">{unscheduledRows.length}</span>
                {canEdit ? <span className="ml-auto font-normal text-neutral-600">Drag onto the timeline or tap to schedule</span> : null}
            </button>
            {unscheduledOpen ? <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto px-3 pb-3">
                {unscheduledRows.map((row) => {
                    const item = row.item
                    const colours = relationshipPhaseColours(item.lifecyclePhase)
                    return <button
                        key={`tray-${item.id}`}
                        type="button"
                        draggable={canEdit}
                        onDragStart={(event) => event.dataTransfer.setData("application/x-betelgeze-unscheduled", item.id)}
                        onClick={() => openDateEditor(item)}
                        title={canEdit ? "Drag onto the timeline or tap to schedule" : item.title}
                        className={`flex max-w-full items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 ${canEdit ? "cursor-grab hover:border-neutral-600" : ""}`}
                    >
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colours.border }} />
                        {item.assignees[0] ? <Assignee name={item.assignees[0].username} avatarSrc={item.assignees[0].avatarUrl} className="max-w-20 shrink-0" /> : null}
                        <span className="min-w-0 truncate">{item.section === "shared" ? "Shared · " : ""}{item.title}</span>
                    </button>
                })}
            </div> : null}
        </div> : null}
        {selectedDependency && canEdit ? <div className="flex items-center justify-between border-t border-neutral-800 px-3 py-2 text-xs text-neutral-400"><span>Dependency selected</span><button type="button" onClick={() => mutate(() => removeGanttDependency(workspaceSlug, relationshipId, selectedDependency.workItemId, selectedDependency.dependsOnWorkItemId).then((next) => { if (next.status === "saved") setSelectedDependency(null); return next }))} className="text-red-300 hover:text-red-200">Remove dependency</button></div> : null}
        <MutationError result={result} />
        {cascade ? <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-950 p-4 shadow-2xl"><h3 className="font-semibold text-white">Move dependent work?</h3><p className="mt-1 text-sm text-neutral-400">This schedule change affects {cascade.length} work items.</p><div className="mt-3 max-h-72 divide-y divide-neutral-900 overflow-y-auto rounded-lg border border-neutral-800">{cascade.map((change) => <div key={change.id} className="flex justify-between gap-3 px-3 py-2 text-sm"><span className="truncate text-neutral-200">{change.title}</span><span className="shrink-0 text-neutral-500">{change.plannedStartDate} → {change.dueDate}</span></div>)}</div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => { setCascade(null); void reload() }} className="h-9 px-3 text-sm text-neutral-400 hover:text-white">Cancel</button><button type="button" disabled={pending} onClick={() => { const changes = cascade; setCascade(null); mutate(() => applyGanttScheduleChanges(workspaceSlug, relationshipId, changes)) }} className="h-9 rounded-md bg-white px-3 text-sm font-medium text-black">Confirm changes</button></div></div></div> : null}
        {dateEditor ? <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-sm rounded-xl border border-neutral-700 bg-neutral-950 p-4"><h3 className="font-medium text-white">Schedule {dateEditor.title}</h3><div className="mt-3 grid grid-cols-2 gap-2"><label className="text-xs text-neutral-500">Start<input type="date" value={editStart} onChange={(event) => setEditStart(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-neutral-700 bg-black px-2 text-white" /></label><label className="text-xs text-neutral-500">Due<input type="date" value={editDue} onChange={(event) => setEditDue(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-neutral-700 bg-black px-2 text-white" /></label></div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setDateEditor(null)} className="h-9 px-3 text-sm text-neutral-400">Cancel</button><button type="button" onClick={() => { const item = dateEditor; setDateEditor(null); requestSchedule(item, editStart, editDue || editStart) }} className="h-9 rounded-md bg-white px-3 text-sm font-medium text-black">Save</button></div></div></div> : null}
    </section>
}
