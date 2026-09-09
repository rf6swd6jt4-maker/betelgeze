import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { AppointmentRefreshPolicy, fetchAppointmentSettingSnapshot } from "../lib/appointment-setting-refresh.ts"

test("returning briefly reuses current appointments, while stale returns refresh", () => {
    const policy = new AppointmentRefreshPolicy(1000)
    for (const now of [1100, 2000, 5000, 15999]) assert.equal(policy.needsRefresh(now, true), false)
    assert.equal(policy.needsRefresh(16000, true), true)
    policy.completed(policy.capture(), 16000)
    assert.equal(policy.needsRefresh(17000, true), false)
})

test("hidden tabs defer changes and reconnects until activated", () => {
    const policy = new AppointmentRefreshPolicy(1000)
    policy.invalidate()
    assert.equal(policy.needsRefresh(2000, false), false)
    assert.equal(policy.needsRefresh(2000, true), true)
    policy.completed(policy.capture(), 2000)
    assert.equal(policy.needsRefresh(2001, true), false)
    assert.equal(policy.needsRefresh(60000, false), false)
})

test("an event during a refresh is not swallowed by the older response", () => {
    const policy = new AppointmentRefreshPolicy(1000)
    policy.invalidate()
    const started = policy.capture()
    policy.invalidate()
    policy.completed(started, 2000)
    assert.equal(policy.needsRefresh(2001, true), true)
    policy.completed(policy.capture(), 2100)
    assert.equal(policy.needsRefresh(2101, true), false)
})

test("snapshot reads use an uncached GET with no Server Action or mutation header", async (t) => {
    const snapshot = { appointments: [], delivery: { checkedAt: 123, notifications: {}, messagingError: null, notificationError: null } }
    const abort = new AbortController()
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
        assert.equal(url, "/api/workspaces/acme/appointment-setting/relationship-1")
        assert.equal(init.method, "GET")
        assert.equal(init.cache, "no-store")
        assert.equal(init.signal, abort.signal)
        assert.equal(new Headers(init.headers).has("Next-Action"), false)
        return Response.json(snapshot)
    })
    assert.deepEqual(await fetchAppointmentSettingSnapshot("acme", "relationship-1", abort.signal), snapshot)
})

test("failed or redirected refreshes reject without supplying a replacement snapshot", async (t) => {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response("Sign in", { headers: { "Content-Type": "text/html" } }))
    await assert.rejects(fetchAppointmentSettingSnapshot("acme", "r"), /Could not refresh/)
    mock.mock.mockImplementation(async () => Response.json({ error: "Unavailable" }, { status: 503 }))
    await assert.rejects(fetchAppointmentSettingSnapshot("acme", "r"), /Could not refresh/)
})

test("appointment refresh route retains workspace, relationship, service and lifecycle authorization", () => {
    const route = readFileSync("app/api/workspaces/[workspaceSlug]/appointment-setting/[relationshipId]/route.ts", "utf8")
    const table = readFileSync("components/appointment-setting/AppointmentTable.tsx", "utf8")
    const server = readFileSync("lib/appointment-setting-server.ts", "utf8")
    assert.match(route, /requireWorkspacePanel\(workspaceSlug, "appointment-setting"\)/)
    assert.match(route, /requireRelationshipAccess\(access, relationshipId\)/)
    assert.match(route, /loadAppointmentSettingRelationshipService\(access, relationshipId\)/)
    assert.match(route, /relationship\.status === "archived"/)
    assert.match(route, /relationship\.lifecycle_phase !== "retention"/)
    assert.match(route, /listAppointmentSettingAppointments\(\{ workspaceId: workspace.id, relationshipId, serviceId \}\)/)
    assert.match(route, /private, no-store/)
    assert.doesNotMatch(route, /loadAppointmentSettingConfiguration/)
    assert.match(server, /if \(relationshipId\) query = query.eq\("relationship_id", relationshipId\)/)
    assert.doesNotMatch(table, /readAppointmentSettingState|router\.refresh\(/)
    assert.match(table, /fetchAppointmentSettingSnapshot\(workspaceSlug, relationshipId, controller.signal\)/)
})
