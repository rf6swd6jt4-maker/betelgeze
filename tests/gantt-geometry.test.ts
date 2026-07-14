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

test("repeated mobile zoom-out steps keep the original focal day anchored", () => {
    const timelineDay = 61.25
    const localX = 286
    const leftWidth = 152
    for (const dayWidth of [56, 42, 28, 21, 14, 7]) {
        const scrollLeft = ganttAnchoredScrollLeft({ timelineDay, dayWidth, leftWidth, localX })
        assert.equal((scrollLeft + localX - leftWidth) / dayWidth, timelineDay)
    }
})

test("a gutter lets the first day be centred instead of clamping short", () => {
    const leftWidth = 260
    const chart = 900
    const centre = leftWidth + chart / 2
    const dayWidth = 64
    // The first day (timelineDay 0) anchored to the viewport centre. Without a
    // gutter the required scroll is negative, clamps to 0, and the day lands far
    // from centre; half a chart of gutter gives it room to sit dead centre.
    const gutter = chart / 2
    const clamped = ganttAnchoredScrollLeft({ timelineDay: 0, dayWidth, leftWidth, localX: centre })
    assert.equal(clamped, 0)
    assert.notEqual((clamped + centre - leftWidth) / dayWidth, 0)
    const anchored = ganttAnchoredScrollLeft({ timelineDay: 0, dayWidth, leftWidth, localX: centre, gutter })
    assert.equal((anchored + centre - leftWidth - gutter) / dayWidth, 0)
})

test("an absolute calendar anchor survives a timeline-range change", () => {
    const calendarDay = 20_500.25
    const nextRangeStart = 20_440
    const localX = 480
    const leftWidth = 260
    const dayWidth = 64
    const scrollLeft = ganttAnchoredScrollLeft({ timelineDay: calendarDay - nextRangeStart, dayWidth, leftWidth, localX })
    assert.equal(nextRangeStart + (scrollLeft + localX - leftWidth) / dayWidth, calendarDay)
})

test("arrowheads are hidden when the target lead-in cannot contain them", () => {
    assert.equal(ganttArrowHeadPath(103, 100, 40), null)
    assert.equal(ganttArrowHeadPath(108, 100, 40), "M 104 36 L 108 40 L 104 44")
})
