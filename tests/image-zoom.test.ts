import assert from "node:assert/strict"
import test from "node:test"
import { clampImageZoom, moveImageZoom } from "../lib/communications/image-zoom.ts"

const bounds = { width: 400, height: 600, viewportWidth: 400, viewportHeight: 600 }
const initial = { scale: 1, x: 0, y: 0 }

test("pinch doubles the image around the fingers' focal point", () => {
    assert.deepEqual(moveImageZoom(initial, [{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: -50, y: 0 }, { x: 150, y: 0 }], bounds), { scale: 2, x: -50, y: 0 })
})

test("zoomed image follows a single remaining finger and stays in bounds", () => {
    assert.deepEqual(moveImageZoom({ scale: 2, x: 0, y: 0 }, [{ x: 0, y: 0 }], [{ x: 500, y: -500 }], bounds), { scale: 2, x: 200, y: -300 })
})

test("pinching back to fit recentres the image; maximum zoom is bounded", () => {
    assert.deepEqual(clampImageZoom({ scale: 0.5, x: 90, y: -100 }, bounds), initial)
    assert.deepEqual(clampImageZoom({ scale: 10, x: 9000, y: -9000 }, bounds), { scale: 5, x: 800, y: -1200 })
})

test("fit images cannot be dragged away and pointer-count changes do not jump", () => {
    assert.deepEqual(moveImageZoom(initial, [{ x: 0, y: 0 }], [{ x: 50, y: 50 }], bounds), initial)
    assert.deepEqual(moveImageZoom(initial, [{ x: 0, y: 0 }], [{ x: 50, y: 50 }, { x: 80, y: 80 }], bounds), initial)
})
