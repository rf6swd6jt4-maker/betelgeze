import assert from "node:assert/strict"
import test from "node:test"
import { WorkspaceTabScrollStore } from "../lib/workspace-tab-scroll.ts"

test("route and tab scroll positions remain separate across panel lifetimes", () => {
    const positions = new WorkspaceTabScrollStore()
    positions.set("tab-one:/fixture/relationships", 340)
    positions.set("tab-one:/fixture/relationships?phase=lead", 120)
    positions.set("tab-two:/fixture/relationships", 780)
    assert.equal(positions.get("tab-one:/fixture/relationships"), 340)
    assert.equal(positions.get("tab-one:/fixture/relationships?phase=lead"), 120)
    assert.equal(positions.get("tab-two:/fixture/relationships"), 780)
    assert.equal(positions.get("tab-one:/fixture/appointment-setting"), 0)
})

test("scroll memory is bounded and account clear removes retained offsets", () => {
    const positions = new WorkspaceTabScrollStore(2)
    positions.set("one", 30)
    positions.set("two", 60)
    positions.set("one", 90)
    positions.set("three", 120)
    assert.equal(positions.get("two"), 0)
    assert.equal(positions.get("one"), 90)
    positions.clear()
    assert.equal(positions.get("one"), 0)
    assert.equal(positions.get("three"), 0)
})
