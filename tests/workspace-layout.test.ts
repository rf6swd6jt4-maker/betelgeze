import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { workspaceLayoutFor } from "../lib/workspace-layout.ts"

const workspace = "11111111-1111-4111-8111-111111111111"
const other = "22222222-2222-4222-8222-222222222222"
const person = "33333333-3333-4333-8333-333333333333"
const colleague = "44444444-4444-4444-8444-444444444444"

test("the redesigned layout is off unless its workspace gate names the workspace", () => {
    assert.equal(workspaceLayoutFor(workspace, person, {}), "tabs")
    assert.equal(workspaceLayoutFor(workspace, person, { WORKSPACE_NATIVE_PANELS: "all" }), "tabs")
    assert.equal(workspaceLayoutFor(workspace, person, { WORKSPACE_NATIVE_PANELS: "all", WORKSPACE_TODAY_LAYOUT: other }), "tabs")
    assert.equal(workspaceLayoutFor(workspace, person, { WORKSPACE_NATIVE_PANELS: "all", WORKSPACE_TODAY_LAYOUT: `${other}, ${workspace}` }), "today")
    assert.equal(workspaceLayoutFor(workspace, person, { WORKSPACE_NATIVE_PANELS: "all", WORKSPACE_TODAY_LAYOUT: "all" }), "today")
})

test("it builds on the native panels, so their gates must also allow the person", () => {
    assert.equal(workspaceLayoutFor(workspace, person, { WORKSPACE_TODAY_LAYOUT: "all" }), "tabs")
    assert.equal(workspaceLayoutFor(workspace, person, { WORKSPACE_NATIVE_PANELS: other, WORKSPACE_TODAY_LAYOUT: "all" }), "tabs")
    assert.equal(workspaceLayoutFor(workspace, person, { WORKSPACE_NATIVE_PANELS: "all", WORKSPACE_PERFORMANCE_USERS: colleague, WORKSPACE_TODAY_LAYOUT: "all" }), "tabs")
    assert.equal(workspaceLayoutFor(workspace, person, { WORKSPACE_NATIVE_PANELS: "all", WORKSPACE_PERFORMANCE_USERS: person, WORKSPACE_TODAY_LAYOUT: "all" }), "today")
})

test("an optional user list narrows a pilot to named people, and a missing user stays on tabs", () => {
    const pilot = { WORKSPACE_NATIVE_PANELS: "all", WORKSPACE_TODAY_LAYOUT: workspace, WORKSPACE_TODAY_LAYOUT_USERS: person }
    assert.equal(workspaceLayoutFor(workspace, person, pilot), "today")
    assert.equal(workspaceLayoutFor(workspace, colleague, pilot), "tabs")
    assert.equal(workspaceLayoutFor(workspace, undefined, pilot), "tabs")
    assert.equal(workspaceLayoutFor(workspace, colleague, { ...pilot, WORKSPACE_TODAY_LAYOUT_USERS: "  " }), "today")
})

test("the shell receives the layout from the server and only marks it for now", () => {
    const server = readFileSync(new URL("../components/workspace/WorkspaceTopBar.tsx", import.meta.url), "utf8")
    assert.match(server, /layout=\{workspaceLayoutFor\(workspace\.id, userId\)\}/)
    const client = readFileSync(new URL("../components/workspace/WorkspaceTopBarClient.tsx", import.meta.url), "utf8")
    assert.match(client, /layout = "tabs"/, "defaults to today's tabbed shell")
    assert.match(client, /data-workspace-layout=\{layout\}/)
    assert.match(readFileSync(new URL("../.env.example", import.meta.url), "utf8"), /^WORKSPACE_TODAY_LAYOUT=$/m)
})
