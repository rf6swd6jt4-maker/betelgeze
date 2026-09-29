import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"

type Row = Record<string, unknown>
type QueryCall = { table: string; fields: string; filters: Array<[string, string, unknown]>; limit?: number }
type SearchResult = { id: string; label: string; description: string; href: string; hubHref?: string }
type SearchOptions = {
    role?: "owner" | "admin" | "staff" | "unknown"
    authenticated?: boolean
    member?: boolean
    workspaceStatus?: string
    schemaReady?: boolean
    capabilities?: string[]
    relationships?: string[]
    workItems?: string[]
    canSell?: boolean
    contactRelationships?: string[]
    scopeError?: boolean
    scopeValue?: unknown
    tables?: Record<string, Row[]>
    errors?: string[]
}

const WORKSPACE = "workspace-a"
const USER = "user-a"
const SENTINEL = "zephyrneedle"
const adminTables = [ "client_activity", "workspace_okrs", "workspace_okr_key_results", "workspace_admin_activity", "onboarding_modules", "onboarding_module_revisions", "onboarding_services", "onboarding_service_revisions", "assets", "notes"]
const codeCache = new Map<string, string>()
function sourceCode(path: string) {
    let code = codeCache.get(path)
    if (!code) {
        code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
        codeCache.set(path, code)
    }
    return code
}

function relationship(id = "relationship-a", workspaceId = WORKSPACE): Row {
    return { id, workspace_id: workspaceId, client_id: `client-${id}`, leadgen_company_id: null, primary_person_name: `${SENTINEL} person`, primary_email: `${SENTINEL}@example.test`, primary_phone: null, business_name: "Fixture company", notes_summary: `${SENTINEL} reference`, lifecycle_phase: "fulfilment", status: "active" }
}
function fixtures(): Record<string, Row[]> {
    return {
        relationships: [relationship()],
        work_items: [{ id: "work-a", workspace_id: WORKSPACE, title: `${SENTINEL} work`, description: `${SENTINEL} instructions`, visibility: "workspace", kind: "standard", native_href: "/alpha/relationships/relationship-a" }, { id: "work-private", workspace_id: WORKSPACE, title: `${SENTINEL} private`, visibility: "admins_only", kind: "maintenance" }],
        client_communication_channels: [{ id: "channel-a", workspace_id: WORKSPACE, client_id: "client-relationship-a", external_address: `${SENTINEL}@example.test`, provider: "email" }],
        clients: [{ id: "client-relationship-a", workspace_id: WORKSPACE, relationship_id: "relationship-a", name: `${SENTINEL} client`, email: `${SENTINEL}@example.test`, archived_at: null }],
        client_activity: [{ id: "activity-a", workspace_id: WORKSPACE, client_id: "client-relationship-a", activity_text: `${SENTINEL} activity`, activity_type: "update" }],
        assets: [{ id: "asset-a", workspace_id: WORKSPACE, title: `${SENTINEL} asset`, description: "Asset", asset_kind: "file", source_kind: "upload" }],
        notes: [{ id: "note-a", workspace_id: WORKSPACE, name: `${SENTINEL} note`, description: "Note" }],
        workspace_okrs: [{ id: "okr-a", workspace_id: WORKSPACE, objective: `${SENTINEL} objective`, description: "Objective", objective_type: "committed", status: "active", period_end: "2026-12-31" }],
        workspace_okr_key_results: [{ id: "kr-a", workspace_id: WORKSPACE, okr_id: "okr-a", name: `${SENTINEL} key result`, description: "Key result" }],
        workspace_admin_activity: [{ id: "event-a", workspace_id: WORKSPACE, summary: `${SENTINEL} admin event`, category: "system", level: "info" }],
        onboarding_modules: [{ id: "module-a", workspace_id: WORKSPACE, internal_code: "module-a", status: "published" }],
        onboarding_module_revisions: [{ id: "module-revision-a", module_id: "module-a", workspace_id: WORKSPACE, definition: { name: `${SENTINEL} module`, description: "Module" }, status: "published" }],
        onboarding_services: [{ id: "service-a", workspace_id: WORKSPACE, internal_code: "service-a", state: "active" }],
        onboarding_service_revisions: [{ id: "service-revision-a", service_id: "service-a", workspace_id: WORKSPACE, name: `${SENTINEL} service`, description: "Service" }],
    }
}

function harness(options: SearchOptions = {}) {
    const role = options.role ?? "staff"
    const privileged = role === "owner" || role === "admin"
    const calls: QueryCall[] = []
    const ownerCalls: string[] = []
    const rpcCalls: Array<{ name: string; args: Row }> = []
    const tables: Record<string, Row[]> = {
        ...fixtures(),
        workspaces: [{ id: WORKSPACE, slug: "alpha", name: "Fixture workspace", status: options.workspaceStatus ?? "active" }],
        workspace_memberships: options.member === false ? [] : [{ workspace_id: WORKSPACE, user_id: USER, role }],
        search_contact_participants: (options.contactRelationships ?? []).map((relationship_id) => ({ workspace_id: WORKSPACE, user_id: USER, relationship_id })),
        ...options.tables,
    }
    function from(table: string) {
        const call: QueryCall = { table, fields: "*", filters: [] }
        calls.push(call)
        let single = false
        const query = {
            select(fields: string) { call.fields = fields; return this },
            eq(field: string, value: unknown) { call.filters.push(["eq", field, value]); return this },
            in(field: string, values: unknown[]) { call.filters.push(["in", field, values]); return this },
            is(field: string, value: unknown) { call.filters.push(["is", field, value]); return this },
            neq(field: string, value: unknown) { call.filters.push(["neq", field, value]); return this },
            order() { return this },
            limit(limit: number) { call.limit = limit; return this },
            maybeSingle() { single = true; return this },
            then(resolve: (result: { data: unknown; error: unknown }) => unknown) {
                if (options.errors?.includes(table)) return Promise.resolve(resolve({ data: null, error: { code: "TEST_FAILURE", message: "Synthetic read failure" } }))
                let rows = (tables[table] ?? []).filter((row) => call.filters.every(([operation, field, value]) => operation === "in" ? (value as unknown[]).includes(row[field]) : operation === "neq" ? row[field] !== value : row[field] === value))
                if (call.limit !== undefined) rows = rows.slice(0, call.limit)
                if (call.fields !== "*") rows = rows.map((row) => Object.fromEntries(call.fields.split(",").map((field) => field.trim()).filter(Boolean).map((field) => [field, row[field]])))
                return Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, error: null }))
            },
        }
        return query
    }
    const supabase = { from, rpc: async (name: string, args: Row) => {
        rpcCalls.push({ name, args })
        if (name === "read_search_contact_channels") {
            assert.equal(args.p_workspace_id, WORKSPACE)
            assert.equal(args.p_user_id, USER)
            if (options.errors?.includes(name)) return { data: null, error: { message: "Synthetic contact access failure" } }
            const membership = tables.workspace_memberships.some((row) => row.workspace_id === args.p_workspace_id && row.user_id === args.p_user_id)
            const readable = new Set(tables.search_contact_participants.filter((row) => membership && row.workspace_id === args.p_workspace_id && row.user_id === args.p_user_id).map((row) => row.relationship_id))
            const clients = new Map(tables.clients.filter((row) => row.workspace_id === args.p_workspace_id && row.archived_at === null && readable.has(row.relationship_id)).map((row) => [row.id, row]))
            return { data: tables.client_communication_channels.filter((row) => row.workspace_id === args.p_workspace_id && clients.has(row.client_id)).slice(0, 60).map((row) => ({ id: row.id, relationship_id: clients.get(row.client_id)!.relationship_id, external_address: row.external_address, provider: row.provider })), error: null }
        }
        if (name === "workspace_user_can_sell") return { data: options.canSell ?? privileged, error: options.errors?.includes(name) ? { message: "Synthetic failure" } : null }
        throw new Error(`Unexpected RPC: ${name}`)
    } }
    const allowedRelationships = privileged ? null : new Set(options.relationships ?? [])
    const allowedWorkItems = privileged ? null : new Set(options.workItems ?? [])
    const workspaceAccess = { workspaceId: WORKSPACE, workspaceSlug: "alpha", userId: USER, role, capabilities: options.capabilities ?? ["fulfilment.manage", "communications.manage"], allowedServiceIds: [], serviceAccessSchemaReady: options.schemaReady !== false }
    const mocks: Record<string, unknown> = {
        "server-only": {},
        "@/lib/supabase/admin": { supabaseAdmin: supabase },
        "@/lib/supabase/server": { createSupabaseServerClient: async () => supabase },
        "@/lib/auth/aal": { getAal2User: async () => options.authenticated === false ? null : { id: USER } },
        "@/lib/workspaces": { normalizeWorkspaceRole: (value: unknown) => ["owner", "admin", "staff"].includes(String(value)) ? value : null },
        "@/lib/workspace-access": {
            loadDeliveryScope: async (workspaceId: string, userId: string) => {
                ownerCalls.push("loadDeliveryScope")
                assert.equal(workspaceId, WORKSPACE)
                assert.equal(userId, USER)
                if (options.scopeError) throw new Error("Could not verify client delivery access.")
                return "scopeValue" in options ? options.scopeValue : { relationships: [...(allowedRelationships ?? [])], full_relationships: [], work_items: [...(allowedWorkItems ?? [])] }
            },
            loadWorkspaceAccess: async () => { ownerCalls.push("loadWorkspaceAccess"); return workspaceAccess },
            workspaceAccessHasCapability: (access: typeof workspaceAccess, capability: string) => privileged || access.capabilities.includes(capability),
        },
    }
    const modules = new Map<string, Record<string, unknown>>()
    function load(path: string): Record<string, unknown> {
        if (modules.has(path)) return modules.get(path)!
        const exports: Record<string, unknown> = {}
        modules.set(path, exports)
        new Function("require", "exports", sourceCode(path))((name: string) => {
            if (name in mocks) return mocks[name]
            assert.ok(name.startsWith("@/"), `Unexpected dependency ${name}`)
            return load(`${name.slice(2)}.ts`)
        }, exports)
        return exports
    }
    const route = load("app/api/workspaces/[workspaceSlug]/search/route.ts")
    return { calls, ownerCalls, rpcCalls, tables, async search(query = SENTINEL, slug = "alpha") {
        const response = await (route.GET as (request: unknown, context: unknown) => Promise<Response>)({ nextUrl: new URL(`https://example.test/api/workspaces/${slug}/search?q=${encodeURIComponent(query)}`) }, { params: Promise.resolve({ workspaceSlug: slug }) })
        const body = await response.text()
        return { response, body, results: (JSON.parse(body).results ?? []) as SearchResult[] }
    } }
}

test("search does not disclose unrelated contact identifiers or values to staff, sellers, or managers", async () => {
    for (const capabilities of [["fulfilment.manage", "communications.manage"], ["relationships.view", "communications.manage"]]) {
        const fixture = harness({ capabilities })
        const { response, body, results } = await fixture.search()
        assert.equal(response.status, 200)
        assert.deepEqual(results, [])
        assert.ok(!body.includes("channel-a") && !body.includes(SENTINEL))
    }
})

test("owners and admins retain every existing searchable record category", async () => {
    const expected = ["relationship-relationship-a", "work-work-a", "work-work-private", "okr-okr-a", "okr-key-result-kr-a", "admin-activity-event-a", "onboarding-module-module-a", "onboarding-service-service-a", "client-client-relationship-a", "asset-asset-a", "note-note-a", "contact-relationship-a-email", "activity-activity-a"]
    for (const role of ["owner", "admin"] as const) {
        const { results } = await harness({ role, contactRelationships: ["relationship-a"] }).search()
        assert.deepEqual(results.map((item) => item.id).sort(), [...expected].sort())
    }
})

test("assigned staff can find readable relationship references and work without private native links", async () => {
    const { results } = await harness({ relationships: ["relationship-a"], workItems: ["work-a"] }).search()
    assert.ok(results.some((item) => item.id === "relationship-relationship-a"))
    const work = results.find((item) => item.id === "work-work-a")
    assert.ok(work)
    assert.equal(work.hubHref, undefined)
    assert.ok(!results.some((item) => item.id === "work-work-private"))
})

test("staff never query admin-only category tables or private work items", async () => {
    const fixture = harness({ relationships: ["relationship-a"], workItems: ["work-a"] })
    await fixture.search()
    assert.deepEqual(fixture.calls.filter((call) => adminTables.includes(call.table)), [])
    assert.ok(!fixture.calls.some((call) => call.table === "work_items" && call.filters.some(([, field, value]) => field === "visibility" && value === "admins_only")))
})

test("authorization lookup failure closes search before record retrieval", async () => {
    const fixture = harness({ schemaReady: false })
    const { response, results, body } = await fixture.search()
    assert.equal(response.status, 503)
    assert.deepEqual(results, [])
    assert.ok(!body.includes(SENTINEL))
    assert.ok(fixture.calls.every((call) => ["workspaces", "workspace_memberships"].includes(call.table)))
})

test("scope failure returns no partial navigation or record results", async () => {
    const fixture = harness({ scopeError: true })
    const { response, results } = await fixture.search("work")
    assert.equal(response.status, 503)
    assert.deepEqual(results, [])
})

test("search requires MFA, current membership, an active workspace and a recognized role", async () => {
    for (const options of [{ authenticated: false }, { member: false }, { workspaceStatus: "archived" }, { role: "unknown" as const }]) {
        const fixture = harness(options)
        const { response, results } = await fixture.search()
        assert.equal(response.status, 401)
        assert.deepEqual(results, [])
        assert.deepEqual(fixture.ownerCalls, [])
        assert.ok(fixture.calls.every((call) => ["workspaces", "workspace_memberships"].includes(call.table)))
    }
})

test("cross-workspace records cannot appear even for an administrator", async () => {
    const foreign = Object.fromEntries(Object.entries(fixtures()).map(([table, rows]) => [table, rows.map((row) => ({ ...row, workspace_id: "workspace-b" }))]))
    const { response, results, body } = await harness({ role: "admin", tables: foreign }).search()
    assert.equal(response.status, 200)
    assert.deepEqual(results, [])
    assert.ok(!body.includes(SENTINEL))
    const unknownWorkspace = await harness({ role: "admin" }).search(SENTINEL, "beta")
    assert.equal(unknownWorkspace.response.status, 401)
})

test("revoked scopes do not reuse another request's readable results", async () => {
    const granted = await harness({ relationships: ["relationship-a"], workItems: ["work-a"] }).search()
    assert.ok(granted.results.some((item) => item.id === "work-work-a"))
    const revoked = await harness().search()
    assert.deepEqual(revoked.results, [])
    assert.ok(!revoked.body.includes(SENTINEL))
})

test("manager-only relationship visibility does not advertise the seller-only creation action", async () => {
    const manager = await harness({ capabilities: ["relationships.view"], canSell: false }).search("new relationship")
    assert.ok(!manager.results.some((item) => item.id === "action-new-relationship"))
    const seller = await harness({ capabilities: ["relationships.view"], canSell: true }).search("new relationship")
    assert.ok(seller.results.some((item) => item.id === "action-new-relationship"))
})

test("search responses explicitly forbid private-data caching on success and denial", async () => {
    for (const options of [{ role: "admin" as const }, { member: false }, { schemaReady: false }]) {
        const { response } = await harness(options).search()
        assert.match(response.headers.get("cache-control") ?? "", /no-store/)
        assert.match(response.headers.get("cache-control") ?? "", /private/)
    }
})


test("contact discovery follows conversation participation for every role, independently of delivery scope", async () => {
    for (const role of ["owner", "admin", "staff"] as const) {
        const nonParticipant = await harness({ role, relationships: ["relationship-a"] }).search()
        assert.ok(!nonParticipant.results.some((item) => item.id.startsWith("contact-")))
        const fixture = harness({ role, contactRelationships: ["relationship-a"] })
        const participant = await fixture.search()
        const contact = participant.results.find((item) => item.id.startsWith("contact-"))
        assert.ok(contact)
        assert.equal(contact.label, `${SENTINEL}@example.test`)
        assert.ok(!participant.body.includes("channel-a"))
        assert.equal(contact.href, "/alpha/communications?conversation=relationship-a")
        assert.equal(fixture.rpcCalls.filter((call) => call.name === "read_search_contact_channels").length, 1)
        assert.ok(!fixture.calls.some((call) => call.table === "client_communication_channels"))
    }
})

test("contact matching excludes internal channel and client identifiers", async () => {
    for (const query of ["channel-a", "client-relationship-a"]) {
        const { results } = await harness({ contactRelationships: ["relationship-a"] }).search(query)
        assert.ok(!results.some((item) => item.id.startsWith("contact-")))
    }
})

test("contact authorization errors disclose neither partial results nor backend diagnostics", async () => {
    const { response, body, results } = await harness({ contactRelationships: ["relationship-a"], errors: ["read_search_contact_channels"] }).search()
    assert.equal(response.status, 503)
    assert.deepEqual(results, [])
    assert.ok(!body.includes(SENTINEL) && !body.includes("Synthetic"))
})


test("malformed staff delivery scope cannot become unrestricted access", async () => {
    for (const scopeValue of [null, {}, { relationships: null, work_items: [] }, { relationships: [], work_items: null }]) {
        const { response, results, body } = await harness({ scopeValue }).search()
        assert.equal(response.status, 503)
        assert.deepEqual(results, [])
        assert.ok(!body.includes(SENTINEL))
    }
})

test("workspace, membership and seller permission errors fail closed", async () => {
    for (const failed of ["workspaces", "workspace_memberships", "workspace_user_can_sell"]) {
        const { response, results, body } = await harness({ errors: [failed] }).search(failed === "workspace_user_can_sell" ? "new relationship" : SENTINEL)
        assert.equal(response.status, 503)
        assert.deepEqual(results, [])
        assert.ok(!body.includes(SENTINEL) && !body.includes("Synthetic"))
    }
})

test("staff cannot discover admin-area work even if a stale delivery scope includes its id", async () => {
    const { results } = await harness({ workItems: ["work-a", "work-private"], tables: {
        work_items: [{ id: "work-a", workspace_id: WORKSPACE, title: `${SENTINEL} admin`, area: "admin", visibility: "workspace" }, { id: "work-private", workspace_id: WORKSPACE, title: `${SENTINEL} private`, visibility: "admins_only" }],
    } }).search()
    assert.ok(!results.some((item) => item.id.startsWith("work-")))
})

test("library capability alone cannot reveal administrator collections or actions", async () => {
    const fixture = harness({ capabilities: ["library.manage", "communications.manage"] })
    const { results } = await fixture.search()
    assert.deepEqual(results, [])
    assert.ok(!fixture.calls.some((call) => adminTables.includes(call.table)))
    const navigation = await fixture.search("add note")
    assert.ok(!navigation.results.some((item) => item.id === "action-new-note"))
})

test("search shares delivery authorization once per request and never checks permission per result", async () => {
    for (const count of [1, 500]) {
        const rows = Array.from({ length: count }, (_, i) => ({ id: `work-${i}`, workspace_id: WORKSPACE, title: `${SENTINEL} item ${i}`, visibility: "workspace" }))
        const fixture = harness({ workItems: rows.map((row) => row.id), tables: { work_items: rows } })
        const { results } = await fixture.search()
        assert.ok(results.length <= 20)
        assert.equal(fixture.ownerCalls.filter((name) => name === "loadDeliveryScope").length, 1)
        assert.equal(fixture.rpcCalls.filter((call) => call.name === "workspace_user_can_sell").length, 0)
        assert.equal(fixture.rpcCalls.filter((call) => call.name === "read_search_contact_channels").length, 1)
        const workReads = fixture.calls.filter((call) => call.table === "work_items")
        assert.equal(workReads.length, 1)
        assert.ok(workReads[0].limit !== undefined && workReads[0].limit <= 80)
    }
})


test("relationship matching does not expose hidden legacy client or lead identifiers", async () => {
    const fixture = harness({ relationships: ["relationship-a"], tables: {
        relationships: [{ ...relationship(), client_id: "hidden-client-canary", leadgen_company_id: "hidden-lead-canary" }],
    } })
    for (const query of ["hidden-client-canary", "hidden-lead-canary"]) {
        const { results, body } = await fixture.search(query)
        assert.deepEqual(results, [])
        assert.ok(!body.includes("relationship-a"))
    }
})

test("query admission accepts 200 characters and rejects 201 before search data reads", async () => {
    const atLimit = await harness().search("x".repeat(200))
    assert.equal(atLimit.response.status, 200)
    const fixture = harness()
    const beyondLimit = await fixture.search("x".repeat(201))
    assert.equal(beyondLimit.response.status, 400)
    assert.deepEqual(beyondLimit.results, [])
    assert.deepEqual(fixture.rpcCalls, [])
    assert.ok(fixture.calls.every((call) => ["workspaces", "workspace_memberships"].includes(call.table)))
    assert.match(beyondLimit.response.headers.get("cache-control") ?? "", /private, no-store/)
    const unauthenticated = await harness({ authenticated: false }).search("x")
    assert.equal(unauthenticated.response.status, 401)
})

test("authorization failures expose only the generic private JSON response", async () => {
    for (const options of [{ scopeError: true }, { schemaReady: false }, { errors: ["workspaces"] }, { errors: ["workspace_memberships"] }, { errors: ["workspace_user_can_sell"] }, { errors: ["read_search_contact_channels"] }]) {
        const { response, body } = await harness(options).search(options.errors?.includes("workspace_user_can_sell") ? "new relationship" : SENTINEL)
        assert.equal(response.status, 503)
        assert.deepEqual(JSON.parse(body), { results: [], error: "Search unavailable" })
        assert.match(response.headers.get("cache-control") ?? "", /private, no-store/)
    }
})


test("seller authorization runs only when the create action matches the search", async () => {
    const unrelated = harness({ errors: ["workspace_user_can_sell"] })
    assert.equal((await unrelated.search()).response.status, 200)
    assert.equal(unrelated.rpcCalls.filter((call) => call.name === "workspace_user_can_sell").length, 0)
    const action = harness({ canSell: true, capabilities: ["relationships.view"] })
    const { results } = await action.search("new relationship")
    assert.ok(results.some((item) => item.id === "action-new-relationship"))
    assert.equal(action.rpcCalls.filter((call) => call.name === "workspace_user_can_sell").length, 1)
})
