import assert from "node:assert/strict"
import test from "node:test"
import { scrollOnboardingRoadmap } from "../lib/onboarding/roadmap-scroll.ts"

function fixture({ height = 300, scrollTop = 0, stepTop = 120, stepHeight = 40, scrollHeight = 900 } = {}) {
    const calls: ScrollToOptions[] = []
    const container = {
        clientHeight: height, clientTop: 0, scrollTop, scrollHeight,
        getBoundingClientRect: () => ({ top: 100 }),
        scrollTo: (options: ScrollToOptions) => calls.push(options),
    } as unknown as HTMLElement
    const step = {
        getBoundingClientRect: () => ({ top: stepTop, bottom: stepTop + stepHeight, height: stepHeight }),
        scrollIntoView: () => { throw new Error("Must not scroll ancestor containers") },
    } as unknown as HTMLElement
    return { container, step, calls }
}

test("visible and hidden mobile roadmaps do not move the page", () => {
    for (const input of [{}, { height: 0, stepTop: 600 }]) {
        const { container, step, calls } = fixture(input)
        scrollOnboardingRoadmap(container, step)
        assert.deepEqual(calls, [])
    }
})

test("a clipped step is centered by scrolling only its list", () => {
    const { container, step, calls } = fixture({ scrollTop: 200, stepTop: 450 })
    scrollOnboardingRoadmap(container, step)
    assert.deepEqual(calls, [{ top: 420, behavior: "instant" }])
})

test("first and last steps clamp to the list's scroll bounds", () => {
    for (const [input, expected] of [
        [{ scrollTop: 100, stepTop: -10 }, 0],
        [{ scrollTop: 500, stepTop: 480 }, 600],
    ] as const) {
        const { container, step, calls } = fixture(input)
        scrollOnboardingRoadmap(container, step)
        assert.equal(calls[0]?.top, expected)
    }
})
