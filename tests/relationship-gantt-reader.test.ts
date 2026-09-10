import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import ts from "typescript"
import { createRelationshipGanttReader, readRelationshipGanttPlan } from "../lib/relationship-gantt-reader.ts"
import type { RelationshipGanttPlan } from "../lib/relationship-gantt"

const userId = "8177f546-b2e7-4dee-9a49-9b2b0c83f13d"
const relationshipId = "6801c9bd-cfea-4460-8ef7-000000000001"
const plan = (title: string) => ({ items: [{ id: "item", title }], externalItems: [] }) as unknown as RelationshipGanttPlan

test("Gantt refresh is a no-store GET with account identity and no Server Action or mutation header", async () => {
    let requested: { url: string; init?: RequestInit } | undefined
    const expected = plan("Current")
    const signal = new AbortController().signal
    const result = await readRelationshipGanttPlan({ workspaceSlug: "example", relationshipId, userId, signal }, (async (url, init) => {
        requested = { url: String(url), init }
        return Response.json({ userId, relationshipId, plan: expected })
    }) as typeof fetch)
    assert.deepEqual(result, expected)
    assert.equal(requested?.url, `/api/workspaces/example/relationships/${relationshipId}/gantt`)
    assert.equal(requested?.init?.method, "GET")
    assert.equal(requested?.init?.cache, "no-store")
    assert.equal(requested?.init?.credentials, "same-origin")
    assert.equal(requested?.init?.redirect, "error")
    assert.equal(requested?.init?.signal, signal)
    const headers = new Headers(requested?.init?.headers)
    assert.equal(headers.get("x-workspace-user"), userId)
    assert.equal(headers.has("Next-Action"), false)
})

test("Gantt reads reject changed account/record, denied access and invalid payloads", async () => {
    const input = { workspaceSlug: "example", relationshipId, userId, signal: new AbortController().signal }
    for (const status of [401, 403, 404, 409, 503]) {
        await assert.rejects(readRelationshipGanttPlan(input, (async () => Response.json({ error: "Private server detail" }, { status })) as typeof fetch), status === 503 ? /Could not refresh/ : /access or session changed/)
    }
    for (const value of [
        { userId: "other", relationshipId, plan: plan("Other account") },
        { userId, relationshipId: "other", plan: plan("Other relationship") },
        { userId, relationshipId, plan: { items: [] } },
    ]) await assert.rejects(readRelationshipGanttPlan(input, (async () => Response.json(value)) as typeof fetch), /could not be verified/)
})

function readerFixture() {
    const requests: Array<{ signal: AbortSignal; resolve: (plan: RelationshipGanttPlan) => void; reject: (error: Error) => void }> = []
    const accepted: RelationshipGanttPlan[] = []
    const failures: unknown[] = []
    const reader = createRelationshipGanttReader((signal) => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })), (next) => accepted.push(next), (error) => failures.push(error))
    return { reader, requests, accepted, failures }
}

test("concurrent background signals coalesce into one read", async () => {
    const fixture = readerFixture()
    const first = fixture.reader.refresh()
    const second = fixture.reader.refresh()
    assert.equal(first, second)
    await Promise.resolve()
    assert.equal(fixture.requests.length, 1)
    fixture.requests[0].resolve(plan("Current"))
    await first
    assert.equal(fixture.accepted.length, 1)
})

test("a pre-edit read cannot overwrite a committed plan even when transport ignores abort", async () => {
    const fixture = readerFixture()
    const previous = fixture.reader.refresh()
    await Promise.resolve()
    fixture.reader.setBlocked(true) // local optimistic edit or pending mutation
    fixture.accepted.push(plan("Committed edit"))
    fixture.requests[0].resolve(plan("Old read"))
    await previous
    assert.equal(fixture.requests[0].signal.aborted, true)
    assert.deepEqual(fixture.accepted.map((value) => value.items[0].title), ["Committed edit"])
    fixture.reader.dispose()
})

test("inactive tabs and open edit confirmations defer reads and reconcile once unblocked", async () => {
    const fixture = readerFixture()
    fixture.reader.setBlocked(true)
    await fixture.reader.refresh(); await fixture.reader.refresh()
    assert.equal(fixture.requests.length, 0)
    fixture.reader.setBlocked(false)
    await Promise.resolve()
    assert.equal(fixture.requests.length, 1)
    fixture.requests[0].resolve(plan("Latest after edit"))
    await fixture.reader.refresh()
    assert.equal(fixture.accepted[0].items[0].title, "Latest after edit")
})

test("incoming authoritative props and account disposal fence both late data and errors", async () => {
    const fixture = readerFixture()
    const previous = fixture.reader.refresh()
    await Promise.resolve()
    fixture.reader.invalidate()
    const current = fixture.reader.refresh()
    await Promise.resolve()
    fixture.requests[0].resolve(plan("Old props"))
    await previous
    assert.equal(fixture.accepted.length, 0)
    fixture.reader.dispose()
    fixture.requests[1].reject(new Error("Old account error"))
    await current
    await fixture.reader.refresh()
    assert.equal(fixture.requests.length, 2)
    assert.deepEqual(fixture.accepted, [])
    assert.deepEqual(fixture.failures, [])
})

function loadModule(path: string, dependencies: Record<string, unknown>) {
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const localRequire = createRequire(resolve(path))
    const compiledModule = new Module(resolve(path)) as Module & { _compile: (source: string, filename: string) => void }
    compiledModule.require = ((name: string) => name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiledModule.require
    compiledModule._compile(compiled, path)
    return compiledModule.exports
}

test("shared Gantt access preserves admin minimum and scopes relationship existence to authorized workspace", async () => {
    const events: unknown[] = []
    let exists = true
    const chain = {
        select(fields: string) { events.push(["select", fields]); return chain },
        eq(field: string, value: string) { events.push([field, value]); return chain },
        async maybeSingle() { return { data: exists ? { id: relationshipId } : null, error: null } },
    }
    const server = loadModule("lib/relationship-gantt-server.ts", {
        "server-only": {},
        "@/lib/workspaces": { requireWorkspace: async (slug: string, role: string) => { events.push(["access", slug, role]); return { user: { id: userId }, workspace: { id: "authorized-workspace", slug } } } },
        "@/lib/supabase/admin": { supabaseAdmin: { from: (table: string) => { events.push(["table", table]); return chain } } },
        "@/lib/relationships": { getRelationship: async (workspace: string, id: string) => { events.push(["relationship", workspace, id]); return { id } } },
        "@/lib/relationship-gantt": { getRelationshipGanttPlan: async () => plan("Scoped") },
    })
    const context = await server.requireGantt("example", relationshipId)
    await server.loadAuthorizedGanttPlan(context, relationshipId)
    assert.deepEqual(events.slice(0, 5), [["access", "example", "admin"], ["table", "relationships"], ["select", "id, lifecycle_phase"], ["workspace_id", "authorized-workspace"], ["id", relationshipId]])
    assert.deepEqual(events.at(-1), ["relationship", "authorized-workspace", relationshipId])
    exists = false
    await assert.rejects(server.requireGantt("example", relationshipId), server.RelationshipGanttNotFoundError)
})

test("Gantt GET preserves authentication/MFA/role denials as private JSON and rejects changed actors before loading", async () => {
    const localRequire = createRequire(import.meta.url)
    const { getRedirectError } = localRequire("next/dist/client/components/redirect")
    let denial: unknown = null, reads = 0
    class Missing extends Error {}
    const route = loadModule("app/api/workspaces/[workspaceSlug]/relationships/[relationshipId]/gantt/route.ts", {
        "@/lib/relationship-gantt-server": {
            RelationshipGanttNotFoundError: Missing,
            requireGantt: async () => { if (denial) throw denial; return { user: { id: userId }, workspace: { id: "workspace" } } },
            loadAuthorizedGanttPlan: async () => { reads++; return plan("Authorized") },
        },
    })
    const context = { params: Promise.resolve({ workspaceSlug: "example", relationshipId }) }
    const request = (actor = userId) => new Request(`https://example.test/api/workspaces/example/relationships/${relationshipId}/gantt`, { headers: { "x-workspace-user": actor } })
    for (const [path, status] of [["/login?next=x", 401], ["/mfa?next=x", 401], ["/workspaces", 403]] as const) {
        denial = getRedirectError(path, "replace", 307)
        const response = await route.GET(request(), context)
        assert.equal(response.status, status)
        assert.equal(response.headers.get("cache-control"), "private, no-store")
        assert.match(response.headers.get("content-type"), /application\/json/)
        assert.equal(response.headers.has("location"), false)
    }
    denial = null
    assert.equal((await route.GET(request("another-actor"), context)).status, 409)
    assert.equal(reads, 0)
    const response = await route.GET(request(), context)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).userId, userId)
    assert.equal(reads, 1)
    denial = new Missing()
    assert.equal((await route.GET(request(), context)).status, 404)
    denial = new Error("Private database detail")
    const failed = await route.GET(request(), context)
    assert.equal(failed.status, 503)
    assert.equal((await failed.text()).includes("Private database detail"), false)
})
