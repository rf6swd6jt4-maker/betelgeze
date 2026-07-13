import test from "node:test"
import assert from "node:assert/strict"
import { ganttAnchoredScrollLeft, ganttArrowHeadPath, ganttDragDayDelta } from "../lib/ui/gantt-geometry.ts"

test("drag distance always resolves to days regardless of the active view", () => {
    assert.equal(ganttDragDayDelta(56, 56), 1)
    assert.equal(ganttDragDayDelta(112, 56), 2)
    assert.equal(ganttDragDayDelta(48, 24), 2)
    assert.equal(ganttDragDayDelta(-72, 24), -3)
})

test("zoom anchoring keeps the same timeline day under the pointer", () => {
    const timelineDay = 42.5
    const localX = 480
    const leftWidth = 260
    const nextDayWidth = 84
    const scrollLeft = ganttAnchoredScrollLeft({ timelineDay, dayWidth: nextDayWidth, leftWidth, localX })
    assert.equal((scrollLeft + localX - leftWidth) / nextDayWidth, timelineDay)
})

test("arrowheads are hidden when the target lead-in cannot contain them", () => {
    assert.equal(ganttArrowHeadPath(103, 100, 40), null)
    assert.equal(ganttArrowHeadPath(108, 100, 40), "M 104 36 L 108 40 L 104 44")
})
