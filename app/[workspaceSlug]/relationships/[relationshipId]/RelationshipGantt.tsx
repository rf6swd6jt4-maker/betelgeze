"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react"
import { useRouter } from "next/navigation"
import { Assignee, relationshipPhaseColours } from "@/components/ui"
import { dateDay, effectiveGanttRanges, type ScheduleChange } from "@/lib/relationship-gantt-schedule"
import type { RelationshipGanttDependency, RelationshipGanttItem, RelationshipGanttPlan } from "@/lib/relationship-gantt"
import {
    applyGanttScheduleChanges,
    createGanttDependency,
    createGanttWorkItem,
    moveGanttWorkItem,
    previewGanttScheduleChange,
    removeGanttDependency,
    type GanttMutationResult,
} from "./gantt-actions"

type Scale = "day" | "week" | "month"
type DisplayRow = { item: RelationshipGanttItem; depth: number; external?: boolean }

const ROW_HEIGHT = 46
const LEFT_WIDTH = 360
const RANGE_DAYS = 730
const SCALE_WIDTH: Record<Scale, number> = { day: 64, week: 28, month: 12 }

function ArrowIcon() {
    return <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5"><path d="M5 11 11 5M6 5h5v5" /></svg>
}

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
        if (!collapsed.has(item.id)) for (const child of children.get(item.id) ?? []) visit(child, depth + 1)
    }
    for (const root of roots) visit(root, 0)
    return output
}

function MutationError({ result }: { result: GanttMutationResult | null }) {
    if (!result || result.status === "saved" || result.status === "cascade_required") return null
    return <p className="border-t border-red-500/20 px-3 py-2 text-sm text-red-300">{result.message}</p>
}

export function RelationshipGantt({ workspaceSlug, relationshipId, plan, canEdit }: {
    workspaceSlug: string
    relationshipId: string
    plan: RelationshipGanttPlan
    canEdit: boolean
}) {
    const router = useRouter()
    const scrollRef = useRef<HTMLDivElement>(null)
    const [scale, setScale] = useState<Scale>("week")
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
    const [unscheduledOpen, setUnscheduledOpen] = useState(true)
    const [quickTitle, setQuickTitle] = useState("")
    const [quickParent, setQuickParent] = useState<string | null>(null)
    const [cascade, setCascade] = useState<ScheduleChange[] | null>(null)
    const [result, setResult] = useState<GanttMutationResult | null>(null)
    const [selectedDependency, setSelectedDependency] = useState<RelationshipGanttDependency | null>(null)
    const [dependencySource, setDependencySource] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const [dateEditor, setDateEditor] = useState<RelationshipGanttItem | null>(null)
    const [editStart, setEditStart] = useState("")
    const [editDue, setEditDue] = useState("")

    const dayWidth = SCALE_WIDTH[scale]
    const today = new Date().toISOString().slice(0, 10)
    const rangeStart = dateDay(today) - 180
    const timelineWidth = RANGE_DAYS * dayWidth
    const allVisibleItems = useMemo(() => [...plan.items, ...plan.externalItems], [plan])
    const ranges = useMemo(() => effectiveGanttRanges(allVisibleItems), [allVisibleItems])
    const relationshipItems = plan.items.filter((item) => item.section === "relationship")
    const sharedItems = plan.items.filter((item) => item.section === "shared")
    const relationshipRows = flattenRows(relationshipItems, collapsed, true)
    const sharedRows = flattenRows(sharedItems, collapsed, true)
    const unscheduledRelationship = flattenRows(relationshipItems, collapsed, false)
    const unscheduledShared = flattenRows(sharedItems, collapsed, false)
    const externalRows: DisplayRow[] = plan.externalItems.map((item) => ({ item, depth: 0, external: true }))
    const milestoneHeight = plan.milestones.length ? ROW_HEIGHT : 0
    const relationshipRowsTop = 44 + milestoneHeight + 36
    const sharedRowsTop = relationshipRowsTop + relationshipRows.length * ROW_HEIGHT + ((sharedRows.length || externalRows.length) ? 36 : 0)
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
        node.scrollLeft = Math.max(0, (dateDay(today) - rangeStart) * dayWidth - (node.clientWidth - LEFT_WIDTH) / 2)
    }, [dayWidth, rangeStart, today])

    useEffect(() => {
        if (!dependencySource) return
        const clear = () => setDependencySource(null)
        window.addEventListener("pointerup", clear, { once: true })
        return () => window.removeEventListener("pointerup", clear)
    }, [dependencySource])

    function refreshAfter(next: GanttMutationResult) {
        setResult(next)
        if (next.status === "saved") router.refresh()
    }

    function mutate(action: () => Promise<GanttMutationResult>) {
        setResult(null)
        startTransition(async () => refreshAfter(await action()))
    }

    function requestSchedule(item: RelationshipGanttItem, start: string, due: string) {
        startTransition(async () => {
            const preview = await previewGanttScheduleChange(workspaceSlug, relationshipId, { id: item.id, plannedStartDate: start, dueDate: due })
            if (preview.status !== "cascade_required") return refreshAfter(preview)
            if (preview.changes.length > 1) setCascade(preview.changes)
            else refreshAfter(await applyGanttScheduleChanges(workspaceSlug, relationshipId, preview.changes))
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

    function dropRow(event: React.DragEvent<HTMLDivElement>, target: RelationshipGanttItem) {
        if (!canEdit) return
        event.preventDefault()
        const draggedId = event.dataTransfer.getData("application/x-betelgeze-work-item")
        const dragged = plan.items.find((item) => item.id === draggedId)
        if (!dragged || dragged.id === target.id) return
        const rect = event.currentTarget.getBoundingClientRect()
        const relativeY = event.clientY - rect.top
        const parentWorkItemId = relativeY > rect.height * 0.25 && relativeY < rect.height * 0.75 ? target.id : target.parentWorkItemId
        const sortOrder = target.sortOrder + (relativeY >= rect.height * 0.75 ? 1 : -1)
        mutate(() => moveGanttWorkItem(workspaceSlug, relationshipId, { workItemId: dragged.id, parentWorkItemId, sortOrder, expectedUpdatedAt: dragged.updatedAt }))
    }

    function dropUnscheduled(event: React.DragEvent<HTMLDivElement>) {
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

    function renderLeft(row: DisplayRow) {
        const item = row.item
        const hasChildren = plan.items.some((candidate) => candidate.parentWorkItemId === item.id)
        return <div
            draggable={canEdit && !row.external}
            onDragStart={(event) => event.dataTransfer.setData("application/x-betelgeze-work-item", item.id)}
            onDragOver={(event) => { if (canEdit && !row.external) event.preventDefault() }}
            onDrop={(event) => dropRow(event, item)}
            className={`sticky left-0 z-20 flex h-[46px] items-center gap-1.5 border-b border-r border-neutral-900 bg-neutral-950 px-2 ${row.external ? "text-neutral-500" : ""}`}
            style={{ paddingLeft: `${8 + row.depth * 18}px` }}
        >
            {hasChildren ? <button type="button" onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next })} className="h-6 w-5 text-neutral-500 hover:text-white">{collapsed.has(item.id) ? "›" : "⌄"}</button> : <span className="w-5" />}
            {canEdit && !row.external ? <span className="hidden cursor-grab text-neutral-700 lg:inline" aria-hidden="true">⋮⋮</span> : null}
            {item.assignees[0] ? <Assignee name={item.assignees[0].username} avatarSrc={item.assignees[0].avatarUrl} className="max-w-28 shrink-0" /> : null}
            {item.assignees.length > 1 ? <span className="shrink-0 text-xs text-neutral-500">+{item.assignees.length - 1}</span> : null}
            <span className="min-w-0 flex-1 truncate text-sm">{row.external ? "External · " : ""}{item.title}</span>
            {canEdit && !row.external ? <button type="button" aria-label={`Edit schedule for ${item.title}`} onClick={() => openDateEditor(item)} className="shrink-0 text-neutral-600 hover:text-white lg:hidden">▦</button> : null}
            {!row.external ? <Link href={`/${workspaceSlug}/work-items/${item.id}`} aria-label={`Open ${item.title}`} className="shrink-0 text-neutral-600 hover:text-white"><ArrowIcon /></Link> : <Link href={`/${workspaceSlug}/work-items/${item.id}`} aria-label={`Open ${item.title}`} className="shrink-0 text-neutral-700 hover:text-white"><ArrowIcon /></Link>}
            {canEdit && !row.external ? <button type="button" aria-label={`Add child to ${item.title}`} onClick={() => setQuickParent(item.id)} className="hidden h-6 w-5 text-neutral-600 hover:text-white lg:inline">+</button> : null}
        </div>
    }

    function renderTimeline(row: DisplayRow) {
        const item = row.item
        const range = ranges.get(item.id) ?? (row.external && item.plannedStartDate ? { start: item.plannedStartDate, end: item.dueDate ?? item.plannedStartDate, derived: false } : null)
        const colours = relationshipPhaseColours(item.lifecyclePhase)
        return <div
            className="relative h-[46px] border-b border-neutral-900"
            style={{ backgroundImage: `repeating-linear-gradient(to right, rgba(64,64,64,.22) 0, rgba(64,64,64,.22) 1px, transparent 1px, transparent ${dayWidth}px)` }}
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

    function sectionHeader(label: string, count: number) {
        return <div className="contents"><div className="sticky left-0 z-30 flex h-9 items-center border-b border-r border-neutral-800 bg-black px-3 text-xs font-medium text-neutral-400">{label}<span className="ml-2 tabular-nums text-neutral-600">{count}</span></div><div className="h-9 border-b border-neutral-800 bg-black" /></div>
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

    return <section id="plan" className="mt-4 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-black px-3 py-2">
            <div><h2 className="text-sm font-semibold text-white">Relationship plan</h2><p className="text-xs text-neutral-500">{plan.items.length} work items · {plan.milestones.length} milestones</p></div>
            <button type="button" onClick={() => { const node = scrollRef.current; if (node) node.scrollLeft = Math.max(0, (dateDay(today) - rangeStart) * dayWidth - (node.clientWidth - LEFT_WIDTH) / 2) }} className="ml-auto h-8 rounded-md px-2 text-xs text-neutral-400 hover:bg-neutral-900 hover:text-white">Today</button>
            <div className="flex rounded-md border border-neutral-800 p-0.5">{(["day", "week", "month"] as Scale[]).map((value) => <button type="button" key={value} onClick={() => setScale(value)} className={`h-7 rounded px-2 text-xs capitalize ${scale === value ? "bg-white text-black" : "text-neutral-500 hover:text-white"}`}>{value}</button>)}</div>
        </div>
        {canEdit ? <div className="flex items-center gap-2 border-b border-neutral-900 px-3 py-2">
            <span className="text-xs text-neutral-500">{quickParent ? `Add child to ${plan.items.find((item) => item.id === quickParent)?.title ?? "work item"}` : "Quick add"}</span>
            <input value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && quickTitle.trim()) mutate(() => createGanttWorkItem(workspaceSlug, relationshipId, { title: quickTitle, parentWorkItemId: quickParent, startDate: null }).then((next) => { if (next.status === "saved") { setQuickTitle(""); setQuickParent(null) } return next })) }} placeholder="Work-item title" className="h-8 min-w-44 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-600" />
            {quickParent ? <button type="button" onClick={() => setQuickParent(null)} className="text-xs text-neutral-500 hover:text-white">Cancel child</button> : null}
            <button type="button" disabled={pending || !quickTitle.trim()} onClick={() => mutate(() => createGanttWorkItem(workspaceSlug, relationshipId, { title: quickTitle, parentWorkItemId: quickParent, startDate: null }).then((next) => { if (next.status === "saved") { setQuickTitle(""); setQuickParent(null) } return next }))} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-40">Add</button>
        </div> : null}
        <div ref={scrollRef} className="relative max-h-[calc(100vh-15rem)] min-h-[32rem] overflow-auto overscroll-contain">
            <div className="grid" style={{ gridTemplateColumns: `${LEFT_WIDTH}px ${timelineWidth}px`, minWidth: `${LEFT_WIDTH + timelineWidth}px` }}>
                <div className="sticky left-0 top-0 z-50 flex h-11 items-center border-b border-r border-neutral-800 bg-neutral-950 px-3 text-xs text-neutral-500">Work-item hierarchy</div>
                <div className="sticky top-0 z-40 h-11 border-b border-neutral-800 bg-neutral-950">
                    {headerLabels.map((label) => <span key={label.day} className="absolute top-0 flex h-full items-center border-l border-neutral-800 px-1 text-[10px] text-neutral-500" style={{ left: `${label.left}px` }}>{dateLabel(label.day, scale)}</span>)}
                    <span className="absolute inset-y-0 z-10 w-px bg-red-400/60" style={{ left: `${(dateDay(today) - rangeStart) * dayWidth}px` }} />
                </div>
                {plan.milestones.length ? <><div className="sticky left-0 z-30 flex h-[46px] items-center border-b border-r border-neutral-900 bg-neutral-950 px-3 text-xs text-neutral-500">Milestones</div><div className="relative h-[46px] border-b border-neutral-900">{plan.milestones.map((milestone) => { const left = (dateDay(milestone.occurredAt.slice(0, 10)) - rangeStart) * dayWidth; const marker = <span className="block h-3 w-3 rotate-45 border border-emerald-400 bg-emerald-950" />; return milestone.href ? <a key={milestone.id} href={milestone.href} title={`${milestone.title} · ${milestone.occurredAt.slice(0, 10)}`} className="absolute top-4" style={{ left }}>{marker}</a> : <span key={milestone.id} title={`${milestone.title} · ${milestone.occurredAt.slice(0, 10)}`} className="absolute top-4" style={{ left }}>{marker}</span> })}</div></> : null}
                {sectionHeader("This Relationship", relationshipRows.length)}
                {relationshipRows.map((row) => <div className="contents" key={`relationship-${row.item.id}`}>{renderLeft(row)}{renderTimeline(row)}</div>)}
                {(sharedRows.length || externalRows.length) ? sectionHeader("Shared", sharedRows.length + externalRows.length) : null}
                {[...sharedRows, ...externalRows].map((row) => <div className="contents" key={`shared-${row.item.id}`}>{renderLeft(row)}{renderTimeline(row)}</div>)}
                {(unscheduledRelationship.length || unscheduledShared.length) ? <><button type="button" onClick={() => setUnscheduledOpen((value) => !value)} className="sticky left-0 z-30 flex h-9 items-center border-b border-r border-neutral-800 bg-black px-3 text-left text-xs font-medium text-neutral-400">{unscheduledOpen ? "⌄" : "›"} <span className="ml-2">Unscheduled</span><span className="ml-2 text-neutral-600">{unscheduledRelationship.length + unscheduledShared.length}</span></button><div className="h-9 border-b border-neutral-800 bg-black" /></> : null}
                {unscheduledOpen ? [...unscheduledRelationship, ...unscheduledShared].map((row) => <div className="contents" key={`unscheduled-${row.item.id}`}><div draggable={canEdit} onDragStart={(event) => event.dataTransfer.setData("application/x-betelgeze-unscheduled", row.item.id)}>{renderLeft(row)}</div>{renderTimeline(row)}</div>) : null}
            </div>
            <svg aria-hidden="true" className="pointer-events-none absolute left-[360px] top-0 z-30 overflow-visible" width={timelineWidth} height={Math.max(1, sharedRowsTop + (sharedRows.length + externalRows.length) * ROW_HEIGHT)}>{dependencyPaths.map(({ edge, path }) => <path key={`${edge.workItemId}-${edge.dependsOnWorkItemId}`} d={path} fill="none" stroke={selectedDependency === edge ? "#fff" : "#737373"} strokeWidth="1.5" className="pointer-events-auto cursor-pointer" onClick={() => setSelectedDependency(edge)} />)}</svg>
        </div>
        {selectedDependency && canEdit ? <div className="flex items-center justify-between border-t border-neutral-800 px-3 py-2 text-xs text-neutral-400"><span>Dependency selected</span><button type="button" onClick={() => mutate(() => removeGanttDependency(workspaceSlug, relationshipId, selectedDependency.workItemId, selectedDependency.dependsOnWorkItemId).then((next) => { if (next.status === "saved") setSelectedDependency(null); return next }))} className="text-red-300 hover:text-red-200">Remove dependency</button></div> : null}
        <MutationError result={result} />
        {cascade ? <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-950 p-4 shadow-2xl"><h3 className="font-semibold text-white">Move dependent work?</h3><p className="mt-1 text-sm text-neutral-400">This schedule change affects {cascade.length} work items.</p><div className="mt-3 max-h-72 divide-y divide-neutral-900 overflow-y-auto rounded-lg border border-neutral-800">{cascade.map((change) => <div key={change.id} className="flex justify-between gap-3 px-3 py-2 text-sm"><span className="truncate text-neutral-200">{change.title}</span><span className="shrink-0 text-neutral-500">{change.plannedStartDate} → {change.dueDate}</span></div>)}</div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setCascade(null)} className="h-9 px-3 text-sm text-neutral-400 hover:text-white">Cancel</button><button type="button" disabled={pending} onClick={() => { const changes = cascade; setCascade(null); mutate(() => applyGanttScheduleChanges(workspaceSlug, relationshipId, changes)) }} className="h-9 rounded-md bg-white px-3 text-sm font-medium text-black">Confirm changes</button></div></div></div> : null}
        {dateEditor ? <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-sm rounded-xl border border-neutral-700 bg-neutral-950 p-4"><h3 className="font-medium text-white">Schedule {dateEditor.title}</h3><div className="mt-3 grid grid-cols-2 gap-2"><label className="text-xs text-neutral-500">Start<input type="date" value={editStart} onChange={(event) => setEditStart(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-neutral-700 bg-black px-2 text-white" /></label><label className="text-xs text-neutral-500">Due<input type="date" value={editDue} onChange={(event) => setEditDue(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-neutral-700 bg-black px-2 text-white" /></label></div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setDateEditor(null)} className="h-9 px-3 text-sm text-neutral-400">Cancel</button><button type="button" onClick={() => { const item = dateEditor; setDateEditor(null); requestSchedule(item, editStart, editDue || editStart) }} className="h-9 rounded-md bg-white px-3 text-sm font-medium text-black">Save</button></div></div></div> : null}
    </section>
}
