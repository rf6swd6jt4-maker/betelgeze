import test from "node:test"
import assert from "node:assert/strict"
import { dateDay, effectiveGanttRanges, ganttTimelineRange, persistedScheduleMatchesChange, previewScheduleCascade, rangeContainsRange, type GanttScheduleDependency, type GanttScheduleItem, type ScheduleChange } from "../lib/relationship-gantt-schedule.ts"

function item(id: string, start: string | null, due: string | null, parentWorkItemId: string | null = null, status = "todo"): GanttScheduleItem {
    return {
        id, title: id, status, parentWorkItemId,
        plannedStartDate: start, plannedStartTime: null, dueDate: due, dueTime: null,
        updatedAt: `2026-07-11T00:00:0${id.length}Z`,
    }
}

function dependency(workItemId: string, dependsOnWorkItemId: string): GanttScheduleDependency {
    return { workItemId, dependsOnWorkItemId }
}

test("an explicit parent timeframe stays fixed around its children", () => {
    const ranges = effectiveGanttRanges([
        item("parent", "2026-07-01", "2026-07-02"),
        item("first", "2026-07-04", "2026-07-06", "parent"),
        item("second", "2026-07-02", "2026-07-09", "parent"),
    ])
    assert.deepEqual(ranges.get("parent"), { start: "2026-07-01", end: "2026-07-02", derived: false })
})

test("an undated parent still derives its timeframe from descendants", () => {
    const ranges = effectiveGanttRanges([
        item("parent", null, null),
        item("first", "2026-07-04", "2026-07-06", "parent"),
        item("second", "2026-07-02", "2026-07-09", "parent"),
    ])
    assert.deepEqual(ranges.get("parent"), { start: "2026-07-02", end: "2026-07-09", derived: true })
})

test("a start-only work item stays scheduled without inventing an end date", () => {
    const ranges = effectiveGanttRanges([item("open", "2026-07-13", null)])
    assert.deepEqual(ranges.get("open"), { start: "2026-07-13", end: "2026-07-13", derived: false })
})

test("child ranges must stay inside their parent timeframe", () => {
    const parent = { start: "2026-07-01", end: "2026-07-31" }
    assert.equal(rangeContainsRange(parent, { start: "2026-07-08", end: "2026-07-20" }), true)
    assert.equal(rangeContainsRange(parent, { start: "2026-06-30", end: "2026-07-20" }), false)
    assert.equal(rangeContainsRange(parent, { start: "2026-07-08", end: "2026-08-01" }), false)
})

test("same-date finish-to-start is valid", () => {
    const changes = previewScheduleCascade(
        [item("a", "2026-07-01", "2026-07-10"), item("b", "2026-07-10", "2026-07-12")],
        [dependency("b", "a")],
        { id: "a", plannedStartDate: "2026-07-01", dueDate: "2026-07-10" },
    )
    assert.equal(changes.length, 1)
    assert.equal(changes[0].id, "a")
})

test("cascade moves only conflicting dependants and preserves duration", () => {
    const changes = previewScheduleCascade(
        [item("a", "2026-07-01", "2026-07-03"), item("b", "2026-07-04", "2026-07-06"), item("c", "2026-07-12", "2026-07-13")],
        [dependency("b", "a"), dependency("c", "b")],
        { id: "a", plannedStartDate: "2026-07-05", dueDate: "2026-07-08" },
    )
    const byId = new Map(changes.map((change) => [change.id, change]))
    assert.equal(byId.get("b")?.plannedStartDate, "2026-07-08")
    assert.equal(byId.get("b")?.dueDate, "2026-07-10")
    assert.equal(byId.has("c"), false)
})

test("canceled dependants are not rescheduled", () => {
    const changes = previewScheduleCascade(
        [item("a", "2026-07-01", "2026-07-03"), item("b", "2026-07-02", "2026-07-04", null, "canceled")],
        [dependency("b", "a")],
        { id: "a", plannedStartDate: "2026-07-05", dueDate: "2026-07-08" },
    )
    assert.deepEqual(changes.map((change) => change.id), ["a"])
})

test("explicit times on the same date obey the finish-to-start boundary", () => {
    const predecessor = item("a", "2026-07-10", "2026-07-10")
    predecessor.dueTime = "16:00"
    const dependent = item("b", "2026-07-10", "2026-07-10")
    dependent.plannedStartTime = "09:00"
    dependent.dueTime = "11:00"
    const changes = previewScheduleCascade([predecessor, dependent], [dependency("b", "a")], { id: "a", plannedStartDate: "2026-07-10", dueDate: "2026-07-10" })
    const shifted = changes.find((change) => change.id === "b")
    assert.equal(shifted?.plannedStartTime, "16:00")
    assert.equal(shifted?.dueTime, "18:00")
})

test("a parent-child hierarchy edge does not push the child outside the parent timeframe", () => {
    const changes = previewScheduleCascade(
        [item("parent", "2026-07-01", "2026-07-03"), item("child", "2026-07-02", "2026-07-04", "parent")],
        [dependency("child", "parent")],
        { id: "parent", plannedStartDate: "2026-07-01", dueDate: "2026-07-03" },
    )
    assert.deepEqual(changes.map((change) => change.id), ["parent"])
})

test("the timeline range includes work, milestones, today, and padding", () => {
    const range = ganttTimelineRange(
        [item("a", "2026-01-10", "2026-02-12")],
        ["2026-03-04T10:00:00Z"],
        "2026-02-01",
        { paddingDays: 10, minimumDays: 30 },
    )
    assert.equal(range.start, Math.floor(Date.parse("2025-12-31T00:00:00Z") / 86_400_000))
    assert.equal(range.end, Math.floor(Date.parse("2026-03-14T00:00:00Z") / 86_400_000))
    assert.equal(range.days, range.end - range.start + 1)
})

test("the timeline range keeps an empty plan useful and compact", () => {
    const range = ganttTimelineRange([], [], "2026-07-12", { paddingDays: 7, minimumDays: 60 })
    assert.equal(range.days, 60)
    assert.ok(range.start < dateDay("2026-07-12"))
    assert.ok(range.end > dateDay("2026-07-12"))
})

test("a persisted schedule must exactly match the requested dates and minute times", () => {
    const change: ScheduleChange = {
        id: "item-a", title: "Item A", plannedStartDate: "2026-07-13", plannedStartTime: "09:30",
        dueDate: "2026-07-17", dueTime: "16:45", expectedUpdatedAt: "2026-07-13T09:00:00Z",
    }
    assert.equal(persistedScheduleMatchesChange({
        id: "item-a", planned_start_date: "2026-07-13", planned_start_time: "09:30:00",
        due_date: "2026-07-17", due_time: "16:45:00",
    }, change), true)
    assert.equal(persistedScheduleMatchesChange({
        id: "item-a", planned_start_date: "2026-07-12", planned_start_time: "09:30:00",
        due_date: "2026-07-17", due_time: "16:45:00",
    }, change), false)
})
