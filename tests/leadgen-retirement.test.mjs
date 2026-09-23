import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { runInNewContext } from "node:vm"
import test from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")

function load(file, dependencies = {}) {
    const compiled = { exports: {} }
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    runInNewContext(code, {
        module: compiled, exports: compiled.exports, Response, URLSearchParams,
        require: name => {
            if (Object.hasOwn(dependencies, name)) return dependencies[name]
            if (name === "react/jsx-runtime") return require(name)
            throw new Error(`Unexpected runtime dependency: ${name}`)
        },
    }, { filename: file })
    return compiled.exports
}

const policy = load("lib/leadgen/availability.ts")
const history = load("lib/leadgen/history.ts")

test("retired write URLs reject before reading a request", async () => {
    for (const file of ["app/api/leadgen/polls/process/route.ts", "app/api/leadgen/sunbiz/import/route.ts"]) {
        const { POST } = load(file, { "@/lib/leadgen/availability": policy })
        const request = new Proxy({}, { get: () => { throw new Error("Request read") } })
        const response = await POST(request)
        assert.equal(response.status, 503)
        assert.equal(response.headers.get("cache-control"), "no-store")
        assert.equal((await response.json()).status, "paused")
    }
    assert.equal("leadgenOperationsAvailable" in policy, false)
})

test("history remains admin scoped and bounded to one keyset page", async () => {
    const reads = []
    const rows = Array.from({ length: 41 }, (_, i) => ({ id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, created_at: "2026-09-23T10:00:00.123456+00:00" }))
    const query = new Proxy({}, { get: (_, method) => {
        if (method === "then") return resolve => { reads.push({ method: "execute" }); return Promise.resolve({ data: rows, error: null }).then(resolve) }
        return (...args) => { reads.push({ method, args }); return query }
    } })
    const page = load("app/[workspaceSlug]/leadgen/polls/page.tsx", {
        "@/lib/leadgen/history": history,
        "@/components/leadgen/LeadgenPollHistory": { LeadgenPollHistory: props => props },
        "@/lib/supabase/admin": { supabaseAdmin: { from: table => { assert.equal(table, "leadgen_polls"); return query } } },
        "@/lib/workspaces": { requireWorkspace: async (slug, role) => { assert.equal(slug, "agency"); assert.equal(role, "admin"); return { workspace: { id: "workspace", slug }, user: { id: "user" } } } },
        "react/jsx-runtime": { jsx: (_component, props) => props },
    })
    const props = await page.default({ params: Promise.resolve({ workspaceSlug: "agency" }), searchParams: Promise.resolve({ before: rows[0].created_at, beforeId: rows[0].id }) })
    assert.equal(props.polls.length, 40)
    assert.ok(props.olderHref.includes(encodeURIComponent(rows[39].created_at)))
    assert.ok(reads.some(read => read.method === "eq" && read.args[0] === "workspace_id" && read.args[1] === "workspace"))
    assert.ok(reads.some(read => read.method === "limit" && read.args[0] === 41))
    assert.ok(reads.some(read => read.method === "or"))
    assert.equal(reads.filter(read => read.method === "execute").length, 1)
})

test("saved company archive uses one admin-only bounded workspace read", async () => {
    const reads = []
    const rows = Array.from({ length: 41 }, (_, i) => ({ id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, created_at: "2026-09-23T10:00:00.123456+00:00", display_name: "Saved company", qualification_status: "qualified" }))
    const query = new Proxy({}, { get: (_, method) => {
        if (method === "then") return resolve => { reads.push({ method: "execute" }); return Promise.resolve({ data: rows, error: null }).then(resolve) }
        return (...args) => { reads.push({ method, args }); return query }
    } })
    const jsx = (_component, props) => props
    const page = load("app/[workspaceSlug]/leadgen/page.tsx", {
        "next/link": { default: () => null },
        "@/components/list/List": {}, "@/components/panel/PanelTabHeader": {}, "@/components/ui": {}, "@/components/workspace/WorkspaceTopBar": {},
        "@/lib/leadgen/history": history,
        "@/lib/supabase/admin": { supabaseAdmin: { from: table => { assert.equal(table, "leadgen_companies"); return query } } },
        "@/lib/ui/relative-time": { shortId: value => value, formatRelativeTime: () => "saved" },
        "@/lib/workspaces": { requireWorkspace: async (_slug, role) => { assert.equal(role, "admin"); return { workspace: { id: "workspace", slug: "agency" }, user: { id: "user" } } } },
        "react/jsx-runtime": { jsx, jsxs: jsx },
    })
    assert.ok(await page.default({ params: Promise.resolve({ workspaceSlug: "agency" }), searchParams: Promise.resolve({ before: rows[0].created_at, beforeId: rows[0].id }) }))
    assert.ok(reads.some(read => read.method === "eq" && read.args[0] === "workspace_id" && read.args[1] === "workspace"))
    assert.ok(reads.some(read => read.method === "limit" && read.args[0] === 41))
    assert.ok(reads.some(read => read.method === "or"))
    assert.equal(reads.filter(read => read.method === "execute").length, 1)
})

test("historical company detail uses an exact workspace and ID read", async () => {
    const reads = []
    const company = { id: "company-id", display_name: "Saved company", created_at: "2026-09-23T10:00:00Z", qualification_status: "qualified" }
    const query = new Proxy({}, { get: (_, method) => (...args) => {
        reads.push({ method, args })
        return method === "maybeSingle" ? Promise.resolve({ data: company, error: null }) : query
    } })
    const jsx = (_component, props) => props
    const page = load("app/[workspaceSlug]/leadgen/company/[companyId]/page.tsx", {
        "next/link": { default: () => null },
        "next/navigation": { notFound: () => { throw new Error("Missing company") } },
        "@/components/detail": {}, "@/components/ui": {}, "@/components/workspace/WorkspaceTopBar": {},
        "@/lib/supabase/admin": { supabaseAdmin: { from: table => { assert.equal(table, "leadgen_companies"); return query } } },
        "@/lib/ui/relative-time": { shortId: value => value, formatRelativeTime: () => "saved" },
        "@/lib/workspaces": { requireWorkspace: async (_slug, role) => { assert.equal(role, "admin"); return { workspace: { id: "workspace", slug: "agency" }, user: { id: "user" } } } },
        "react/jsx-runtime": { jsx, jsxs: jsx },
    })
    assert.ok(await page.default({ params: Promise.resolve({ workspaceSlug: "agency", companyId: "company-id" }) }))
    assert.deepEqual(reads.filter(read => read.method === "eq").map(read => [...read.args]), [["workspace_id", "workspace"], ["id", "company-id"]])
    assert.equal(reads.filter(read => read.method === "maybeSingle").length, 1)
})

test("saved poll detail reads one authorized record and exposes no mutation", async () => {
    const reads = []
    const poll = { id: "poll-id", status: "failed", trigger: "manual", source_count: 1, candidate_count: 3, qualified_count: 0, created_at: "2026-09-23T10:00:00Z", completed_at: null, started_at: null, error: "Saved error", source_snapshot: [], icp_snapshot: {}, stage_summary: {} }
    const query = new Proxy({}, { get: (_, method) => (...args) => {
        reads.push({ method, args })
        return method === "maybeSingle" ? Promise.resolve({ data: poll, error: null }) : query
    } })
    const jsx = (_component, props) => props
    const page = load("app/[workspaceSlug]/leadgen/poll/[pollId]/page.tsx", {
        "next/link": { default: () => null },
        "next/navigation": { notFound: () => { throw new Error("Missing poll") } },
        "@/components/detail": {}, "@/components/ui": {}, "@/components/workspace/WorkspaceTopBar": {},
        "@/lib/supabase/admin": { supabaseAdmin: { from: table => { assert.equal(table, "leadgen_polls"); return query } } },
        "@/lib/ui/relative-time": { shortId: value => value, formatRelativeTime: () => "saved" },
        "@/lib/workspaces": { requireWorkspace: async (_slug, role) => { assert.equal(role, "admin"); return { workspace: { id: "workspace", slug: "agency" }, user: { id: "user" } } } },
        "react/jsx-runtime": { jsx, jsxs: jsx },
    })
    assert.ok(await page.default({ params: Promise.resolve({ workspaceSlug: "agency", pollId: "poll-id" }) }))
    assert.deepEqual(reads.filter(read => read.method === "eq").map(read => [...read.args]), [["workspace_id", "workspace"], ["id", "poll-id"]])
    assert.equal(reads.filter(read => read.method === "maybeSingle").length, 1)
})

test("history cursor rejects PostgREST injection and retired entrypoints are absent", () => {
    const id = "00000000-0000-0000-0000-000000000001"
    assert.equal(history.leadgenHistoryCursor("2026-09-23T10:00:00.123456Z", id).before, "2026-09-23T10:00:00.123456Z")
    assert.equal(history.leadgenHistoryCursor("2026-09-23T10:00:00Z),status.eq.running", id), null)
    for (const path of ["lib/leadgen/poll-runner.ts", "scripts/import-sunbiz-owner-index.ts", "services/ner/app.py", ".github/workflows/deploy-ner.yml"]) {
        assert.equal(existsSync(path), false, path)
    }
})

test("retained relationship provenance opens its exact saved company", () => {
    const relationships = readFileSync("lib/relationships.ts", "utf8")
    assert.match(relationships, /relationship\.leadgen_company_id \? `leadgen\/company\/\$\{relationship\.leadgen_company_id\}` : "leadgen"/)
})


test("retired NER keeps its automatic deployment denial without service code", () => {
    const config = JSON.parse(readFileSync("services/ner/vercel.json", "utf8"))
    assert.equal(config.git.deploymentEnabled, false)
    assert.equal(existsSync("services/ner/app.py"), false)
    assert.equal(existsSync(".github/workflows/deploy-ner.yml"), false)
})
