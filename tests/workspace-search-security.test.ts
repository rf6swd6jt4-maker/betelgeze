import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"

// These tests execute the HTTP owner against a compact RPC boundary. Actual
// policy, grants, matching and revocation execute in validate-workspace-search-retrieval.mjs.
type Row = Record<string, unknown>
type Result = { id: string; label: string; description: string; href: string }
const id = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`
const WORKSPACE = id(1), USER = id(2), RELATIONSHIP = id(3), WORK = id(4)
const categories = ["relationships", "work_items", "okrs", "key_results", "admin_activity", "modules", "services", "clients", "assets", "notes", "channels", "activities"]
function snapshot(role = "staff", records: Row = {}): Row {
    return { workspace: { id: WORKSPACE, slug: "alpha", name: "Fixture workspace" }, role, can_sell: false,
        capabilities: ["fulfilment.manage", "communications.manage"], ...Object.fromEntries(categories.map(key => [key, []])), ...records }
}
function records(): Row {
    return {
        relationships: [{ id: RELATIONSHIP, primary_person_name: "Needle person", primary_email: "needle@example.test", primary_phone: null, business_name: "Company" }],
        work_items: [{ id: WORK, title: "Needle work", description: null, kind: "standard", visibility: "workspace", native_href: "/private-canary", native_id: "private-canary" }],
        okrs: [{ id: id(5), objective: "Needle objective", objective_type: "committed", description: null, status: "active", period_end: "2026-12-31" }],
        key_results: [{ id: id(6), name: "Needle result", description: null }],
        admin_activity: [{ id: id(7), summary: "Needle event", category: "system", level: "info", entity_href: "/private-canary" }],
        modules: [{ id: id(8), name: "Needle module", description: "Module", status: "published", definition: { secret: "private-canary" } }],
        services: [{ id: id(9), name: "Needle service", description: null, state: "active" }],
        clients: [{ id: id(10), name: "Needle client", email: null, phone: null, relationship_id: RELATIONSHIP }],
        assets: [{ id: id(11), title: "Needle asset", storage_key: "private-canary" }],
        notes: [{ id: id(12), name: "Needle note", description: "Note" }],
        channels: [{ relationship_id: RELATIONSHIP, external_address: "needle@example.test", provider: "email", id: "private-canary" }],
        activities: [{ id: id(13), relationship_id: RELATIONSHIP, activity_text: "Needle activity", activity_type: "update" }],
    }
}
const codeCache = new Map<string, string>()
function sourceCode(path: string) {
    if (!codeCache.has(path)) codeCache.set(path, ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)
    return codeCache.get(path)!
}
function harness(options: { value?: unknown; authenticated?: boolean; authError?: boolean; authPending?: Promise<void>; error?: boolean; hangs?: boolean; deadlineMs?: number } = {}) {
    let value = "value" in options ? options.value : snapshot()
    const calls: Array<{ name: string; args: Row; signal: AbortSignal }> = []
    const supabase = { rpc(name: string, args: Row) { return { async abortSignal(signal: AbortSignal) {
        calls.push({ name, args, signal })
        if (options.hangs) return new Promise(() => {}) // Prove the owner also bounds noncooperative transports.
        return { data: value, error: options.error ? { message: "private backend canary" } : null }
    } } } }
    const mocks: Record<string, unknown> = {
        "server-only": {},
        "@/lib/supabase/admin": { supabaseAdmin: supabase },
        "@/lib/supabase/server": { createSupabaseServerClient: async () => ({}) },
        "@/lib/auth/aal": { getAal2User: async () => { await options.authPending; if (options.authError) throw new Error("private auth canary"); return options.authenticated === false ? null : { id: USER } } },
    }
    const modules = new Map<string, Record<string, unknown>>()
    function load(path: string): Record<string, unknown> {
        if (modules.has(path)) return modules.get(path)!
        const exports: Record<string, unknown> = {}
        modules.set(path, exports)
        new Function("require", "exports", "setTimeout", sourceCode(path))((name: string) => {
            if (name in mocks) return mocks[name]
            assert.ok(name.startsWith("@/"), `Unexpected dependency ${name}`)
            return load(`${name.slice(2)}.ts`)
        }, exports, (callback: () => void, delay: number) => setTimeout(callback, delay === 25_000 ? options.deadlineMs ?? delay : delay))
        return exports
    }
    const route = load("app/api/workspaces/[workspaceSlug]/search/route.ts")
    return { calls, setValue(next: unknown) { value = next }, async search(query = "needle", signal = new AbortController().signal, slug = "alpha") {
        const response = await (route.GET as (request: unknown, context: unknown) => Promise<Response>)({ signal, nextUrl: new URL(`https://example.test/api/workspaces/${slug}/search?q=${encodeURIComponent(query)}&userId=forged&role=owner`) }, { params: Promise.resolve({ workspaceSlug: slug }) })
        const body = await response.text()
        return { response, body, results: JSON.parse(body).results as Result[], json: JSON.parse(body) }
    } }
}

test("one abortable RPC uses only the verified actor and requested workspace", async () => {
    const fixture = harness()
    assert.equal((await fixture.search("  NeEdLe  ")).response.status, 200)
    assert.equal(fixture.calls.length, 1)
    assert.deepEqual(fixture.calls[0].args, { p_workspace_slug: "alpha", p_user_id: USER, p_query: "needle" })
    assert.equal(fixture.calls[0].name, "search_workspace_records")
    assert.equal(fixture.calls[0].signal.aborted, true)
})

test("unauthenticated or incomplete MFA and failed authentication never query records", async () => {
    for (const options of [{ authenticated: false }, { authError: true }]) {
        const fixture = harness(options), response = await fixture.search()
        assert.equal(response.response.status, options.authenticated === false ? 401 : 503)
        assert.deepEqual(response.results, [])
        assert.deepEqual(fixture.calls, [])
        assert.ok(!response.body.includes("canary"))
    }
})

test("denied workspace/member RPC snapshot has no navigation, scope or record disclosure", async () => {
    const response = await harness({ value: null }).search("work")
    assert.equal(response.response.status, 401)
    assert.deepEqual(response.json, { results: [] })
})

test("owner and admin retain all existing record categories with canonical destinations", async () => {
    for (const role of ["owner", "admin"]) {
        const response = await harness({ value: snapshot(role, records()) }).search()
        assert.equal(response.response.status, 200)
        assert.equal(response.results.length, 12)
        for (const result of response.results) assert.ok(result.href.startsWith("/alpha/"))
        assert.equal(response.results.find(item => item.id === `work-${WORK}`)?.href, `/alpha/work-items/${WORK}`)
        assert.equal(response.results.find(item => item.id.startsWith("admin-activity-"))?.href, `/alpha/admin/activity/${id(7)}`)
        assert.equal(response.results.find(item => item.id.startsWith("contact-"))?.href, `/alpha/communications?conversation=${RELATIONSHIP}`)
        assert.equal(response.results.find(item => item.id.startsWith("client-"))?.href, `/alpha/onboarding/${RELATIONSHIP}`)
        assert.ok(!response.body.includes("private-canary"))
    }
})

test("staff relationship destination follows the permitted panel without a private native link", async () => {
    for (const [capability, path] of [["fulfilment.manage", "work"], ["onboarding.manage", "onboarding"], ["relationships.view", "relationships"]]) {
        const value = snapshot("staff", { relationships: records().relationships, work_items: records().work_items, capabilities: [capability] })
        const response = await harness({ value }).search()
        assert.equal(response.response.status, 200)
        assert.equal(response.results.find(item => item.id.startsWith("relationship-"))?.href, `/alpha/${path}/${RELATIONSHIP}`)
        assert.ok(!response.body.includes("private-canary"))
    }
})

test("contact-only permission does not require a relationship hit or expose a channel ID", async () => {
    for (const role of ["owner", "admin", "staff"]) {
        const { results, body } = await harness({ value: snapshot(role, { channels: records().channels }) }).search()
        assert.equal(results.length, 1)
        assert.equal(results[0].href, `/alpha/communications?conversation=${RELATIONSHIP}`)
        assert.ok(!body.includes("private-canary"))
    }
})

test("staff rejects unexpected private rows instead of trusting capability flags", async () => {
    for (const category of categories.filter(key => !["relationships", "work_items", "channels"].includes(key))) {
        const value = snapshot("staff", { capabilities: ["library.manage", "admin.manage"], [category]: records()[category] })
        const response = await harness({ value }).search("work")
        assert.equal(response.response.status, 503, category)
        assert.deepEqual(response.json, { results: [], error: "Search unavailable" })
    }
    const value = snapshot("staff", { work_items: [{ ...(records().work_items as Row[])[0], visibility: "admins_only" }] })
    assert.equal((await harness({ value }).search()).response.status, 503)
})

test("malformed or wrong-workspace snapshots fail closed with no partial navigation", async () => {
    for (const value of [undefined, {}, [], snapshot("unknown"), snapshot("staff", { workspace: { id: WORKSPACE, slug: "beta", name: "Foreign" } }),
        snapshot("staff", { capabilities: ["unknown"] }), snapshot("staff", { can_sell: null }), snapshot("staff", { channels: null }),
        snapshot("staff", { relationships: [{ ...(records().relationships as Row[])[0], id: "../private-canary" }] }),
        snapshot("staff", { relationships: [{ ...(records().relationships as Row[])[0], primary_person_name: null }] }),
        snapshot("staff", { relationships: Array.from({ length: 9 }, () => (records().relationships as Row[])[0]) })]) {
        const response = await harness({ value }).search("work")
        assert.equal(response.response.status, 503)
        assert.deepEqual(response.json, { results: [], error: "Search unavailable" })
    }
})

test("fresh snapshots reflect access revocation without sharing private results across requests", async () => {
    const fixture = harness({ value: snapshot("staff", { relationships: records().relationships }) })
    assert.equal((await fixture.search()).results.length, 1)
    fixture.setValue(snapshot())
    assert.equal((await fixture.search()).results.length, 0)
    fixture.setValue(null)
    assert.equal((await fixture.search()).response.status, 401)
    assert.equal(fixture.calls.length, 3)
})

test("seller-only action follows can_sell while manager visibility does not grant it", async () => {
    for (const can_sell of [false, true]) {
        const { results } = await harness({ value: snapshot("staff", { capabilities: ["relationships.view"], can_sell }) }).search("new relationship")
        assert.equal(results.some(item => item.id === "action-new-relationship"), can_sell)
    }
})

test("private shortcuts remain private even with staff capability flags", async () => {
    for (const role of ["owner", "admin", "staff"]) {
        const fixture = harness({ value: snapshot(role, { capabilities: ["library.manage", "admin.manage"] }) })
        assert.equal((await fixture.search("teams")).results.some(item => item.id === "settings-teams"), role !== "staff")
        assert.equal((await fixture.search("add note")).results.some(item => item.id === "action-new-note"), role !== "staff")
    }
})

test("successful responses echo current account/workspace and final results remain capped at twenty", async () => {
    const data = records()
    for (const key of categories) data[key] = Array.from({ length: key === "relationships" ? 8 : ["activities", "channels"].includes(key) ? 4 : 6 }, () => (data[key] as Row[])[0])
    const response = await harness({ value: snapshot("admin", data) }).search()
    assert.equal(response.response.status, 200)
    assert.equal(response.results.length, 20)
    assert.deepEqual(response.json.scope, { userId: USER, workspaceId: WORKSPACE })
})

test("query admission and short queries preserve authentication, scope and parameterized literals", async () => {
    const fixture = harness()
    for (const query of ["", "x", "%_\\", "x".repeat(200)]) {
        const response = await fixture.search(query)
        assert.equal(response.response.status, 200)
        assert.deepEqual(response.json.scope, { userId: USER, workspaceId: WORKSPACE })
        assert.equal(fixture.calls.at(-1)?.args.p_query, query)
    }
    const before = fixture.calls.length
    assert.equal((await fixture.search("x".repeat(201))).response.status, 400)
    assert.equal(fixture.calls.length, before)
    assert.equal((await harness({ authenticated: false }).search("x")).response.status, 401)
})

test("RPC failure, even with data, returns no partial discovery or diagnostics", async () => {
    const response = await harness({ value: snapshot("admin", records()), error: true }).search("work")
    assert.equal(response.response.status, 503)
    assert.deepEqual(response.json, { results: [], error: "Search unavailable" })
})

test("success, denial, validation, error and timeout responses all forbid private caching", async () => {
    for (const options of [{}, { authenticated: false }, { value: {} }, { error: true }, { hangs: true, deadlineMs: 10 }]) {
        const { response } = await harness(options).search()
        assert.equal(response.headers.get("cache-control"), "private, no-store")
        assert.equal(response.headers.get("vary"), "Cookie")
    }
})

test("the search deadline and cancellation bound even a noncooperative RPC", async () => {
    const fixture = harness({ hangs: true, deadlineMs: 10 })
    const response = await fixture.search()
    assert.equal(response.response.status, 504)
    assert.deepEqual(response.json, { results: [], error: "Search timed out" })
    assert.ok(fixture.calls.every(call => call.signal.aborted))
    const source = new AbortController(), cancelled = harness({ hangs: true })
    const pending = cancelled.search("work", source.signal)
    await new Promise(resolve => setImmediate(resolve)); source.abort()
    assert.equal((await pending).response.status, 503)
    assert.equal(cancelled.calls.length, 1)
    assert.equal(cancelled.calls[0].signal.aborted, true)
})

test("late authentication after deadline cannot dispatch search retrieval", async () => {
    let release!: () => void
    const fixture = harness({ authPending: new Promise<void>(resolve => { release = resolve }), deadlineMs: 10 })
    assert.equal((await fixture.search()).response.status, 504)
    release(); await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(fixture.calls, [])
})
