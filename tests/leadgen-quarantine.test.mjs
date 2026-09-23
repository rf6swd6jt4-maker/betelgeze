import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"
import { spawnSync } from "node:child_process"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const workspace = { id: "workspace", slug: "agency", name: "Agency", status: "active" }
const user = { id: "administrator" }

function load(file, dependencies = {}, fallback = () => ({})) {
    const compiled = { exports: {} }
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText
    runInNewContext(code, {
        module: compiled, exports: compiled.exports, Response, Request, URL, URLSearchParams, FormData, console,
        require: (name) => {
            if (Object.hasOwn(dependencies, name)) return dependencies[name]
            if (name === "react" || name === "react/jsx-runtime") return require(name)
            if (name === "@/lib/leadgen/availability" || name === "./leadgen/availability.ts") return policy
            if (name === "@/lib/leadgen/history") return history
            return fallback(name)
        },
    }, { filename: file })
    return compiled.exports
}
const policy = load("lib/leadgen/availability.ts")
const history = load("lib/leadgen/history.ts")
const panels = load("lib/workspace-panels.ts")
const noCallDependencies = (calls) => (name) => new Proxy({}, { get: (_, key) => {
    if (key === "__esModule") return true
    return (...args) => { calls.push({ name, key, args }); throw new Error(`Unexpected operation: ${name}.${String(key)}`) }
} })

function readDatabase(rows = {}) {
    const reads = [], writes = []
    const db = { from(table) {
        const query = { table, filters: [], limit: null, single: false, or: null }
        const builder = new Proxy({}, { get: (_, method) => {
            if (method === "then") return (resolve, reject) => {
                reads.push(query)
                const data = rows[table] ?? []
                return Promise.resolve({ data: query.single ? (Array.isArray(data) ? data[0] ?? null : data) : data, error: null }).then(resolve, reject)
            }
            if (["insert", "update", "upsert", "delete", "rpc"].includes(method)) return () => { writes.push({ table, method }); throw new Error("Unexpected database mutation") }
            return (...args) => {
                if (method === "limit") query.limit = args[0]
                if (method === "or") query.or = args[0]
                if (method === "eq") query.filters.push(args)
                if (method === "maybeSingle" || method === "single") query.single = true
                return builder
            }
        } })
        return builder
    } }
    return { db, reads, writes }
}
function authorizedWorkspace() { return { workspace, user, role: "admin" } }
function historyDependencies(database, authorize = authorizedWorkspace) {
    return {
        "@/lib/workspaces": { requireWorkspace: async (slug, role) => { assert.equal(slug, "agency"); assert.equal(role, "admin"); return authorize() }, workspaceRoleLabel: () => "Admin" },
        "@/lib/supabase/admin": { supabaseAdmin: database.db },
        "@/lib/ui/relative-time": { shortId: value => String(value ?? "").slice(0, 8), formatRelativeTime: () => "saved", compactText: value => value },
        "@/lib/leadgen/source-catalog-ui": { sourceCatalogMap: () => new Map() },
        "@/lib/leadgen/sources": { sourceLabel: key => key },
    }
}

// Run actual exported entry points with side-effect dependencies that fail if called.
test("every stale Lead Gen action denies before database, storage, or provider work", async () => {
    const calls = []
    for (const file of ["app/[workspaceSlug]/leadgen/actions.ts", "app/[workspaceSlug]/leadgen/settings/actions.ts"]) {
        const actions = load(file, {}, noCallDependencies(calls))
        for (const [name, action] of Object.entries(actions)) {
            assert.equal(typeof action, "function", name)
            await assert.rejects(action("agency", new FormData()), /Lead Gen is paused/)
        }
    }
    assert.deepEqual(calls, [])
})

test("processor and import HTTP endpoints return truthful non-cacheable pause without reading payloads", async () => {
    const calls = []
    for (const file of ["app/api/leadgen/polls/process/route.ts", "app/api/leadgen/sunbiz/import/route.ts"]) {
        const { POST } = load(file, {}, noCallDependencies(calls))
        const request = new Proxy({}, { get: () => { throw new Error("Quarantine must precede request parsing") } })
        const response = await POST(request)
        assert.equal(response.status, 503)
        assert.equal(response.headers.get("cache-control"), "no-store")
        assert.equal((await response.json()).status, "paused")
    }
    assert.deepEqual(calls, [])
})

test("quarantine preserves accepted queued/running/terminal jobs and blocks direct import replacement", async () => {
    const calls = []
    const runner = load("lib/leadgen/poll-runner.ts", {}, noCallDependencies(calls))
    const accepted = ["queued", "running", "completed", "failed", "cancelled"].map((status, index) => ({ id: `poll-${index}`, workspace_id: "workspace", status }))
    const before = structuredClone(accepted)
    for (const poll of accepted) assert.equal((await runner.processLeadgenPoll({ workspaceId: poll.workspace_id, pollId: poll.id })).reason, "quarantined")
    await assert.rejects(runner.createInitialLeadgenPollTasks({ workspaceId: "workspace", pollId: "poll", sourcePlan: [] }), /Lead Gen is paused/)
    const importer = load("lib/leadgen/sunbiz-import.ts", {}, noCallDependencies(calls))
    await assert.rejects(importer.clearSunbizOwnerIndex("registry.fl.sunbiz"), /Lead Gen is paused/)
    await assert.rejects(importer.upsertSunbizOwnerIndexRows([]), /Lead Gen is paused/)
    await assert.rejects(importer.markSunbizOwnerIndexImportHealthy({ sourceKey: "registry.fl.sunbiz" }), /Lead Gen is paused/)
    await assert.rejects(importer.importSunbizOwnerIndexFromText({ sourceKey: "registry.fl.sunbiz", text: "fixture", mode: "replace" }), /Lead Gen is paused/)
    assert.deepEqual(calls, [])
    assert.deepEqual(accepted, before)
})

test("restoring the code policy exposes existing job eligibility without changing terminal history", async () => {
    const database = readDatabase({ leadgen_polls: [{ id: "old", status: "completed", source_snapshot: [] }] })
    const runner = load("lib/leadgen/poll-runner.ts", {
        "@/lib/leadgen/availability": { ...policy, leadgenOperationsAvailable: () => true, requireLeadgenOperations: () => {} },
        "@/lib/supabase/admin": { supabaseAdmin: database.db },
    })
    assert.equal((await runner.processLeadgenPoll({ workspaceId: "workspace", pollId: "old" })).reason, "not_runnable")
    assert.equal(database.reads.length, 1)
    assert.deepEqual(database.writes, [])
})

test("navigation omits Lead Gen while saved history URLs retain admin-only panel identity", () => {
    assert.equal(panels.WORKSPACE_PANELS.some(panel => panel.key === "leadgen"), false)
    const panel = panels.workspacePanelForUrl("/agency/leadgen/poll/old", "agency")
    assert.equal(panel.key, "leadgen")
    assert.equal(panels.workspacePanelByKey("leadgen"), panel)
    assert.equal(panels.canAccessWorkspacePanel(panel, "admin", []), true)
    assert.equal(panels.canAccessWorkspacePanel(panel, "staff", ["leadgen.manage"]), false)
})

test("old New Poll URL is authenticated but performs no Lead Gen reads", async () => {
    const database = readDatabase()
    const page = load("app/[workspaceSlug]/leadgen/new/page.tsx", historyDependencies(database))
    assert.ok(await page.default({ params: Promise.resolve({ workspaceSlug: "agency" }) }))
    assert.deepEqual(database.reads, [])
    assert.deepEqual(database.writes, [])
})

test("poll history remains authorized, keyset paginated, and avoids all child scans", async () => {
    const polls = Array.from({ length: 41 }, (_, i) => ({ id: `00000000-0000-0000-0000-${String(100-i).padStart(12, "0")}`, status: "failed", created_at: "2026-09-23T10:00:00.123456+00:00", source_snapshot: [], candidate_count: 4, qualified_count: 1 }))
    const database = readDatabase({ leadgen_polls: polls })
    const page = load("app/[workspaceSlug]/leadgen/polls/page.tsx", historyDependencies(database))
    const result = await page.default({ params: Promise.resolve({ workspaceSlug: "agency" }), searchParams: Promise.resolve({ before: polls[0].created_at, beforeId: polls[0].id }) })
    assert.equal(result.props.polls.length, 40)
    assert.ok(result.props.olderHref.includes(encodeURIComponent(polls[39].created_at)))
    assert.equal(database.reads.length, 1)
    assert.equal(database.reads[0].table, "leadgen_polls")
    assert.equal(database.reads[0].limit, 41)
    assert.ok(database.reads[0].or.includes(".123456+00:00"))
    assert.deepEqual(database.writes, [])
    const denied = load("app/[workspaceSlug]/leadgen/polls/page.tsx", historyDependencies(readDatabase(), () => { throw new Error("Forbidden") }))
    await assert.rejects(denied.default({ params: Promise.resolve({ workspaceSlug: "agency" }), searchParams: Promise.resolve({}) }), /Forbidden/)
})

test("history cursor rejects filter injection and preserves PostgreSQL precision", () => {
    const id = "00000000-0000-0000-0000-000000000001"
    assert.equal(history.leadgenHistoryCursor("2026-09-23T10:00:00.123456Z", id).before, "2026-09-23T10:00:00.123456Z")
    assert.equal(history.leadgenHistoryCursor("2026-09-23T10:00:00Z),status.eq.running", id), null)
    assert.equal(history.leadgenHistoryCursor("2026-09-23T10:00:00Z", `${id},status.eq.running`), null)
})

test("all manual Lead Gen CLI entry points stop before loading local configuration or importing", () => {
    for (const name of ["import-sunbiz-owner-index", "build-sunbiz-shards", "upload-sunbiz-shards", "build-arizona-owner-shards", "upload-arizona-owner-shards"]) {
        const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", `scripts/${name}.ts`], { encoding: "utf8", timeout: 10_000 })
        assert.equal(result.status, 1, name)
        assert.match(result.stderr, /Lead Gen is paused/, name)
        assert.equal(result.stdout, "", name)
    }
})

function elements(node) {
    if (!node || typeof node !== "object") return []
    if (Array.isArray(node)) return node.flatMap(elements)
    return [node, ...Object.values(node.props ?? {}).flatMap(elements)]
}

test("ordinary Settings does not mount or read Lead Gen configuration", async () => {
    let leadgenReads = 0
    const database = readDatabase()
    const page = load("app/[workspaceSlug]/settings/page.tsx", {
        ...historyDependencies(database),
        "@/lib/leadgen/settings-page-data": { loadLeadgenSettingsPageData: () => { leadgenReads++; throw new Error("Unexpected Lead Gen settings read") } },
        "@/lib/onboarding/configuration": { loadOnboardingSettingsPageData: async () => ({}) },
    })
    const result = await page.default({ params: Promise.resolve({ workspaceSlug: "agency" }), searchParams: Promise.resolve({}) })
    const nodes = elements(result)
    assert.equal(nodes.some(node => node.type?.name === "LeadgenSettingsSection"), false)
    const sections = nodes.find(node => Array.isArray(node.props?.sections))?.props.sections
    assert.ok(sections.some(section => section.id === "connections"))
    assert.equal(sections.some(section => section.id === "leadgen"), false)
    assert.equal(leadgenReads, 0)
})

test("ordinary search never reads Lead Gen tables but still finds historical relationship provenance", async () => {
    const database = readDatabase({ workspaces: workspace, workspace_memberships: { role: "admin" } })
    const relationship = { id: "relationship", client_id: null, leadgen_company_id: "legacy-company", primary_person_name: "Saved Client" }
    const route = load("app/api/workspaces/[workspaceSlug]/search/route.ts", {
        "@/lib/supabase/admin": { supabaseAdmin: database.db },
        "@/lib/supabase/server": { createSupabaseServerClient: async () => ({}) },
        "@/lib/auth/aal": { getAal2User: async () => user },
        "@/lib/workspaces": { normalizeWorkspaceRole: value => value },
        "@/lib/workspace-panels": panels,
        "@/lib/workspace-access": {
            loadWorkspaceAccess: async input => ({ ...input, capabilities: [] }),
            workspaceAccessHasCapability: () => true,
            accessibleRelationshipIds: async () => null,
            accessibleWorkItemIds: async () => null,
        },
        "@/lib/relationships": {
            workspaceHref: (slug, suffix) => `/${slug}/${suffix}`,
            listRelationshipsForWorkspace: async () => [relationship],
            relationshipSearchHaystack: () => "saved client",
            relationshipHubHref: (slug, id) => `/${slug}/relationships/${id}`,
            onboardingDetailHref: (slug, id) => `/${slug}/onboarding/${id}`,
        },
        "@/lib/ui/relative-time": { shortId: value => String(value ?? "").slice(0, 8) },
    })
    for (const query of ["leadgen", "poll", "lead gen", "legacy-company", "settings"]) {
        const response = await route.GET({ nextUrl: new URL(`https://example.test/search?q=${encodeURIComponent(query)}`) }, { params: Promise.resolve({ workspaceSlug: "agency" }) })
        const { results } = await response.json()
        assert.equal(results.some(result => result.href?.includes("/leadgen") || result.href?.includes("#leadgen")), false)
        if (query === "legacy-company") assert.ok(results.some(result => result.id === "relationship-relationship"))
    }
    assert.equal(database.reads.some(read => read.table.startsWith("leadgen_")), false)
    assert.deepEqual(database.writes, [])
})

test("direct poll detail retains saved diagnostics with bounded authorized reads and no refresh", async () => {
    const poll = { id: "old", status: "failed", created_at: "2026-09-23T10:00:00Z", source_snapshot: [], icp_snapshot: {}, stage_summary: {} }
    const database = readDatabase({ leadgen_polls: poll })
    const refresh = () => null
    const page = load("app/[workspaceSlug]/leadgen/poll/[pollId]/page.tsx", { ...historyDependencies(database), "@/components/leadgen/PollLiveRefresh": { PollLiveRefresh: refresh } })
    const result = await page.default({ params: Promise.resolve({ workspaceSlug: "agency", pollId: "old" }) })
    assert.ok(result)
    assert.equal(elements(result).some(node => node.type === refresh), false)
    assert.equal(elements(result).some(node => node.props?.live === true), false)
    assert.equal(database.reads.length, 11)
    for (const read of database.reads) {
        if (read.table === "leadgen_polls") assert.equal(read.single, true)
        else assert.ok(read.limit > 0 && read.limit <= 1000, read.table)
        if (read.table !== "leadgen_source_catalog") assert.ok(read.filters.some(([key, value]) => key === "workspace_id" && value === "workspace"), read.table)
    }
    assert.deepEqual(database.writes, [])
})
