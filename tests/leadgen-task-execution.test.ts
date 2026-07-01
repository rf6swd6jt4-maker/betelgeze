import assert from "node:assert/strict"
import test from "node:test"

import { groupByKey, runWithConcurrency } from "../lib/leadgen/task-execution.ts"

test("runWithConcurrency caps simultaneous work while processing every item", async () => {
    let running = 0
    let maxRunning = 0
    const processed: number[] = []

    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
        running += 1
        maxRunning = Math.max(maxRunning, running)
        await new Promise((resolve) => setTimeout(resolve, 5))
        processed.push(item)
        running -= 1
    })

    assert.equal(maxRunning, 2)
    assert.deepEqual(processed.sort((left, right) => left - right), [1, 2, 3, 4, 5])
})

test("groupByKey keeps item order inside each group", () => {
    const groups = groupByKey([
        { source: "a", task: 1 },
        { source: "b", task: 2 },
        { source: "a", task: 3 },
    ], (item) => item.source)

    assert.deepEqual(groups.get("a")?.map((item) => item.task), [1, 3])
    assert.deepEqual(groups.get("b")?.map((item) => item.task), [2])
})
