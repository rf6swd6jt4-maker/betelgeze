import test from "node:test"
import assert from "node:assert/strict"
import { effectiveGanttRanges, previewScheduleCascade, type GanttScheduleDependency, type GanttScheduleItem } from "../lib/relationship-gantt-schedule.ts"

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

test("parent ranges are derived from dated descendants", () => {
    const ranges = effectiveGanttRanges([
        item("parent", "2026-07-01", "2026-07-02"),
        item("first", "2026-07-04", "2026-07-06", "parent"),
        item("second", "2026-07-02", "2026-07-09", "parent"),
    ])
    assert.deepEqual(ranges.get("parent"), { start: "2026-07-02", end: "2026-07-09", derived: true })
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

test("a child waiting for its parent uses the parent's own dates rather than its derived summary", () => {
    const changes = previewScheduleCascade(
        [item("parent", "2026-07-01", "2026-07-03"), item("child", "2026-07-02", "2026-07-04", "parent")],
        [dependency("child", "parent")],
        { id: "parent", plannedStartDate: "2026-07-01", dueDate: "2026-07-03" },
    )
    const shifted = changes.find((change) => change.id === "child")
    assert.equal(shifted?.plannedStartDate, "2026-07-03")
    assert.equal(shifted?.dueDate, "2026-07-05")
})
