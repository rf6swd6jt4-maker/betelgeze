import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import ts from "typescript"

type Row = Record<string, unknown>
type QueryCall = { table: string; fields: string; filters: Array<[string, string, unknown]>; limit?: number }
type SearchResult = { id: string; label: string; description: string; href: string; hubHref?: string }
type SearchOptions = {
    role?: "owner" | "admin" | "staff" | "unknown"
    authenticated?: boolean
    member?: boolean
    workspaceStatus?: string
    relationships?: string[]
    workItems?: string[]
    canSell?: boolean
    contactRelationships?: string[]
    tables?: Record<string, Row[]>
    errors?: string[]
}

// Run with: node scripts/measure-workspace-search.ts [baseline-commit]
// Uses only synthetic rows and mocked Auth/Supabase; no production requests.
const root = fileURLToPath(new URL("../", import.meta.url))
process.chdir(root)
const base = execFileSync("git", ["rev-parse", "--verify", `${process.argv[2] ?? "c06fe1a7"}^{commit}`], { encoding: "utf8" }).trim()
const routePath = "app/api/workspaces/[workspaceSlug]/search/route.ts"
globalThis.fetch = async () => { throw new Error("Network requests are prohibited in the search fixture") }
const WORKSPACE = "workspace-a"
const USER = "user-a"
const SENTINEL = "zephyrneedle"
const codeCache = new Map<string, string>()
function sourceCode(path: string, revision?: string) {
    const key = `${revision ?? "working"}:${path}`
    let code = codeCache.get(key)
    if (!code) {
        const source = revision ? execFileSync("git", ["show", `${revision}:${path}`], { encoding: "utf8" }) : readFileSync(path, "utf8")
        code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
        codeCache.set(key, code)
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

function harness(options: SearchOptions = {}, revision?: string) {
    const role = options.role ?? "staff"
    const privileged = role === "owner" || role === "admin"
    let wave = 0
    let queued: Array<() => void> = []
    const waves: string[][] = []
    let fetchedRows = 0
    let fetchedBytes = 0
    let activeReads = 0
    let peakConcurrency = 0
    function dbDelay(label: string): Promise<void> {
        activeReads += 1
        peakConcurrency = Math.max(peakConcurrency, activeReads)
        if (!waves[wave]) waves[wave] = []
        waves[wave].push(label)
        return new Promise((resolve) => {
            const schedule = queued.length === 0
            queued.push(resolve)
            if (schedule) setImmediate(() => {
                const batch = queued
                queued = []
                wave++
                activeReads -= batch.length
                for (const done of batch) done()
            })
        })
    }
    const calls: QueryCall[] = []
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
        let single = false
        const orders: Array<{ field: string; ascending: boolean }> = []
        const query = {
            select(fields: string) { call.fields = fields; return this },
            eq(field: string, value: unknown) { call.filters.push(["eq", field, value]); return this },
            in(field: string, values: unknown[]) { call.filters.push(["in", field, values]); return this },
            is(field: string, value: unknown) { call.filters.push(["is", field, value]); return this },
            neq(field: string, value: unknown) { call.filters.push(["neq", field, value]); return this },
            order(field: string, options: { ascending?: boolean } = {}) { orders.push({ field, ascending: options.ascending !== false }); return this },
            abortSignal() { return this },
            limit(limit: number) { call.limit = limit; return this },
            maybeSingle() { single = true; return this },
            async then(resolve: (result: { data: unknown; error: unknown }) => unknown) {
                calls.push(call)
                await dbDelay(`table:${table}`)
                if (options.errors?.includes(table)) return Promise.resolve(resolve({ data: null, error: { code: "TEST_FAILURE", message: "Synthetic read failure" } }))
                let rows = (tables[table] ?? []).filter((row) => call.filters.every(([operation, field, value]) => operation === "in" ? (value as unknown[]).includes(row[field]) : operation === "neq" ? row[field] !== value : row[field] === value))
                if (orders.length) rows = [...rows].sort((left, right) => {
                    for (const { field, ascending } of orders) {
                        const a = left[field], b = right[field]
                        if (a === b) continue
                        if (a === undefined || a === null) return 1
                        if (b === undefined || b === null) return -1
                        return String(a).localeCompare(String(b)) * (ascending ? 1 : -1)
                    }
                    return 0
                })
                if (call.limit !== undefined) rows = rows.slice(0, call.limit)
                if (call.fields !== "*") rows = rows.map((row) => Object.fromEntries(call.fields.split(",").map((field) => field.trim()).filter(Boolean).map((field) => [field, row[field]])))
                fetchedRows += rows.length
                fetchedBytes += Buffer.byteLength(JSON.stringify(single ? rows[0] ?? null : rows))
                return Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, error: null }))
            },
        }
        return query
    }
    const supabase = { from, rpc: (name: string, args: Row) => {
      const run = async () => {
        rpcCalls.push({ name, args })
        await dbDelay(`rpc:${name}`)
        if (name === "workspace_delivery_access_scope") return { data: { relationships: options.relationships ?? [], full_relationships: [], work_items: options.workItems ?? [] }, error: null }
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
      }
      return { abortSignal() { return this }, then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return run().then(resolve, reject) } }
    } }
    const mocks: Record<string, unknown> = {
        "server-only": {},
        "@/lib/supabase/admin": { supabaseAdmin: supabase },
        "@/lib/supabase/server": { createSupabaseServerClient: async () => supabase },
        "@/lib/auth/aal": { getAal2User: async () => options.authenticated === false ? null : { id: USER } },
        "@/lib/workspaces": { normalizeWorkspaceRole: (value: unknown) => ["owner", "admin", "staff"].includes(String(value)) ? value : null },
        "react": { cache: (fn: unknown) => fn },
        "next/navigation": { notFound: () => { throw new Error("Unexpected notFound") } },
    }
    const modules = new Map<string, Record<string, unknown>>()
    function load(path: string): Record<string, unknown> {
        if (modules.has(path)) return modules.get(path)!
        const exports: Record<string, unknown> = {}
        modules.set(path, exports)
        new Function("require", "exports", sourceCode(path, revision))((name: string) => {
            if (name in mocks) return mocks[name]
            assert.ok(name.startsWith("@/"), `Unexpected dependency ${name}`)
            return load(`${name.slice(2)}.ts`)
        }, exports)
        return exports
    }
    const route = load(routePath)
    return { calls, rpcCalls, tables, waves, get fetchedRows() { return fetchedRows }, get fetchedBytes() { return fetchedBytes }, get peakConcurrency() { return peakConcurrency }, async search(query = SENTINEL, slug = "alpha") {
        const response = await (route.GET as (request: unknown, context: unknown) => Promise<Response>)({ nextUrl: new URL(`https://example.test/api/workspaces/${slug}/search?q=${encodeURIComponent(query)}`), signal: new AbortController().signal }, { params: Promise.resolve({ workspaceSlug: slug }) })
        const body = await response.text()
        return { response, body, results: (JSON.parse(body).results ?? []) as SearchResult[] }
    } }
}

// Stage II retires this unused secondary-navigation field; all remaining
// result fields, matching, ordering and record destinations must stay identical.
const comparableResults = (results: SearchResult[]) => results.map((result) => Object.fromEntries(Object.entries(result).filter(([key]) => key !== "hubHref")))
const outputs = []
for (const role of ["staff", "admin"] as const) {
    for (const count of [1, 500]) {
      for (const queryKind of ["record", "create-action"]) {
        const growing = fixtures()
        const relationships: Row[] = Array.from({ length: count }, (_, i) => ({ ...relationship(`relationship-${i}`), updated_at: new Date(1_700_000_000_000 + i * 1000).toISOString(), source_metadata: { excluded: "x".repeat(2048) }, address: { excluded: "x".repeat(1024) } }))
        const workItems: Row[] = Array.from({ length: count }, (_, i) => ({ id: `work-${i}`, workspace_id: WORKSPACE, title: `${SENTINEL} item ${i}`, visibility: "workspace", area: "workspace" }))
        growing.relationships = relationships
        growing.work_items = workItems
        growing.clients = relationships.map((row, i) => ({ id: row.client_id, workspace_id: WORKSPACE, relationship_id: row.id, name: `${SENTINEL} client`, email: `${SENTINEL}@example.test`, created_at: new Date(1_600_000_000_000 + i * 1000).toISOString(), archived_at: null }))
        growing.client_communication_channels = relationships.map((row, i) => ({ id: `channel-${i}`, workspace_id: WORKSPACE, client_id: row.client_id, external_address: `${SENTINEL}${i}@example.test`, provider: "email" }))
        growing.onboarding_module_revisions = Array.from({ length: Math.min(count, 200) }, (_, i) => ({ ...fixtures().onboarding_module_revisions[0], id: `module-revision-${i}`, updated_at: new Date(1_650_000_000_000 + i * 1000).toISOString(), definition: { name: `${SENTINEL} module`, description: "Module", excluded: "x".repeat(8192) } }))
        let baselineResults: SearchResult[] | undefined
        for (const [name, revision] of [["baseline", base], ["candidate", undefined]] as const) {
            const fixture = harness({ role, tables: growing, relationships: relationships.map((row) => String(row.id)), workItems: workItems.map((row) => String(row.id)), contactRelationships: relationships.map((row) => String(row.id)) }, revision)
            const { response, body, results } = await fixture.search(queryKind === "record" ? SENTINEL : "new relationship")
            assert.equal(response.status, 200, `${name}: ${body}`)
            if (name === "baseline") baselineResults = results
            else assert.deepEqual(comparableResults(results), comparableResults(baselineResults ?? []), `exact result semantics ${role}/${count}/${queryKind}`)
            outputs.push({ name, role, queryKind, recordsPerGrowingCategory: count, databaseCalls: fixture.waves.flat().length, tableCalls: fixture.calls.length, rpcCalls: fixture.rpcCalls.map((call) => call.name), requestWaves: fixture.waves.length, peakConcurrency: fixture.peakConcurrency, tablePayloadBytes: fixture.fetchedBytes, tableRowsReturned: fixture.fetchedRows, resultCount: results.length, responseBytes: Buffer.byteLength(body), waves: fixture.waves })
        }
      }
    }
}
const differential: Array<{ name: string; query: string; options: SearchOptions }> = []
const searchableFields = ["primary_person_name", "primary_email", "primary_phone", "business_name", "website_url", "industry_value", "location_value", "source_label", "primary_contact_role", "notes_summary"]
for (const field of searchableFields) {
    for (const role of ["staff", "admin"] as const) differential.push({ name: `relationship-${role}-${field}`, query: "Málaga Łódź 東京", options: { role, relationships: ["relationship-a"], tables: { relationships: [{ ...relationship(), [field]: "Málaga Łódź 東京" }] } } })
}
const stamp = "2026-09-01T12:00:00.000Z"
const legacyRows = [
    { id: "legacy-name", workspace_id: WORKSPACE, name: "  Legacy Unicode Łódź  ", email: "legacy@example.test", phone: "123456", created_at: stamp, archived_at: null },
    { id: "legacy-email", workspace_id: WORKSPACE, name: " ", email: "  FallbackEmail@example.test  ", phone: "123457", created_at: "2026-09-03T12:00:00.000Z", archived_at: null },
    { id: "legacy-phone", workspace_id: WORKSPACE, name: null, email: " ", phone: "  +35389222222  ", created_at: "2026-09-02T12:00:00.000Z", archived_at: null },
    { id: "legacy-unknown", workspace_id: WORKSPACE, name: null, email: null, phone: null, created_at: stamp, archived_at: null },
    { id: "legacy-archived", workspace_id: WORKSPACE, name: "ArchivedCanary", email: null, phone: null, created_at: stamp, archived_at: stamp },
    { id: "client-relationship-a", workspace_id: WORKSPACE, relationship_id: "relationship-a", name: "WrappedClientCanary", email: null, phone: null, created_at: stamp, archived_at: null },
]
for (const query of ["legacy", "łódź", "fallbackemail", "+35389", "unknown relationship", "archivedcanary", "wrappedclientcanary", SENTINEL]) {
    differential.push({ name: `legacy-merge-${query}`, query, options: { role: "admin", tables: { clients: legacyRows, relationships: [{ ...relationship(), updated_at: stamp }, { ...relationship("relationship-b"), updated_at: stamp }] } } })
}
for (const [name, definition] of Object.entries({ strings: { name: "ModuleValueCanary", description: "DescriptionCanary" }, empty: { name: "", description: "" }, numbers: { name: 123, description: 456 }, objects: { name: { hidden: "ObjectCanary" }, description: ["ArrayCanary"] }, nulls: { name: null, description: null }, missing: {}, array: ["ArrayCanary"], null: null })) {
    for (const query of ["module", "modulevaluecanary", "descriptioncanary", "123", "objectcanary", "arraycanary", "reusable onboarding"]) differential.push({ name: `module-${name}-${query}`, query, options: { role: "admin", tables: { onboarding_module_revisions: [{ id: "latest", module_id: "module-a", workspace_id: WORKSPACE, updated_at: "2026-09-03T00:00:00Z", status: "draft", definition }, { id: "older", module_id: "module-a", workspace_id: WORKSPACE, updated_at: stamp, status: "published", definition: { name: "MustNotMatchOlder" } }] } } })
}
const fieldCases: Array<[string, string[]]> = [
    ["work_items", ["title", "description", "lifecycle_phase"]],
    ["workspace_okrs", ["objective", "description", "status"]],
    ["workspace_okr_key_results", ["name", "description", "unit", "comparator"]],
    ["workspace_admin_activity", ["category", "level", "event_key", "summary", "entity_type", "entity_id"]],
    ["onboarding_services", ["internal_code"]],
    ["onboarding_service_revisions", ["name", "description"]],
    ["client_activity", ["activity_text", "activity_type"]],
    ["assets", ["asset_kind", "source_kind", "title", "description"]],
    ["notes", ["name", "description"]],
    ["client_communication_channels", ["external_address", "provider"]],
]
for (const [table, fields] of fieldCases) for (const field of fields) differential.push({ name: `${table}-${field}`, query: "fieldonlycanary", options: { role: "admin", contactRelationships: ["relationship-a"], tables: { [table]: [{ ...fixtures()[table][0], [field]: "FieldOnlyCanary" }] } } })
for (const index of [0, 79, 80, 499]) {
    const rows: Row[] = Array.from({ length: 500 }, (_, n) => ({ ...relationship(`ordered-${n}`), primary_person_name: "No match", primary_email: null, notes_summary: null, updated_at: stamp }))
    const clients = rows.map((row, n) => ({ id: row.client_id, workspace_id: WORKSPACE, relationship_id: row.id, name: `OnlyClientMarker${n}End`, email: null, phone: null, created_at: new Date(1_700_000_000_000 - n * 1000).toISOString(), archived_at: null }))
    differential.push({ name: `client-sample-${index}`, query: `OnlyClientMarker${index}End`, options: { role: "admin", tables: { relationships: rows, clients } } })
}
for (const { name, query, options } of differential) {
    const previous = await harness(options, base).search(query)
    const candidate = await harness(options).search(query)
    assert.equal(previous.response.status, 200, `baseline ${name}`)
    assert.equal(candidate.response.status, 200, `candidate ${name}: ${candidate.body}`)
    assert.deepEqual(comparableResults(candidate.results), comparableResults(previous.results), `exact result semantics ${name}`)
}
console.log(JSON.stringify({ base, productionCalls: 0, retiredUnusedOutputFields: ["hubHref"], differentialCases: differential.length, method: "Actual baseline/candidate route and real access/relationships modules, synthetic in-memory data. Every DB table/RPC read waits one deterministic asynchronous wave; these are dependency rounds, not timing predictions. Auth/MFA mocked equally; React cache identity models Route Handler no memoization. This compares call topology only, not production database costs or end-to-end latency. Table row/payload counts exclude RPC JSON. Module and relationship JSON are synthetic stress payloads. Baseline route and shared modules are read from the pinned Git commit; candidate modules come from the working tree.", outputs }, null, 2))
