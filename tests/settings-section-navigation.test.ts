import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { resolveSettingsSectionIndex } from "../lib/settings-section-navigation.ts"

test("settings rail reconciles a stale later selection after content moves upward", () => {
    assert.equal(resolveSettingsSectionIndex({
        tops: [-2400, -1900, -1400, -900, -400, 20, 720, 1100, 1500],
        currentIndex: 8,
        activationLine: 150,
    }), 5)
})

test("settings rail advances from geometry without depending on scroll direction", () => {
    assert.equal(resolveSettingsSectionIndex({
        tops: [-900, -500, -40, 260, 700],
        currentIndex: 0,
        activationLine: 150,
    }), 2)
})

test("settings rail preserves hysteresis near a section boundary", () => {
    assert.equal(resolveSettingsSectionIndex({
        tops: [-500, -100, 130, 700],
        currentIndex: 1,
        activationLine: 150,
    }), 1)
    assert.equal(resolveSettingsSectionIndex({
        tops: [-500, -100, 120, 700],
        currentIndex: 1,
        activationLine: 150,
    }), 2)
})

test("settings rail selects the final section at the true scroll boundary", () => {
    assert.equal(resolveSettingsSectionIndex({
        tops: [-1000, -600, -200, 220],
        currentIndex: 1,
        activationLine: 150,
        atEnd: true,
    }), 3)
})

test("settings rail observes streamed geometry and nested scroll owners", () => {
    const source = readFileSync("components/workspace/SettingsSectionNav.tsx", "utf8")
    assert.match(source, /new ResizeObserver\(scheduleUpdate\)/)
    assert.match(source, /document\.addEventListener\("scroll", scheduleUpdate, \{ capture: true, passive: true \}\)/)
    assert.match(source, /document\.scrollingElement/)
    assert.match(source, /scrollIntoView\(\{ behavior: "auto", block: "start" \}\)/)
    assert.ok(source.indexOf("scrollIntoView") < source.indexOf("activeRef.current = id"))
})
