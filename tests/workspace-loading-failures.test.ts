import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { WorkspaceRecordCache } from "../lib/workspace-record-cache.ts"
import { nativeWorkspaceRoute } from "../lib/workspace-native.ts"

// Execute production functions with isolated network/auth fixtures, without
// loading server-only modules or contacting a real account.
function moduleFunctions(path: string, context: Record<string, unknown>, names?: string[]) {
    const source = ts.createSourceFile(path, readFileSync(`${process.env.LOADING_BASELINE_DIR ?? "."}/${path}`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const statements = source.statements.filter((node) => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node) && (!names ||
        ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && names.includes(node.name.text))))
    const code = statements.map((node) => node.getText(source)).join("\n")
    const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    // The evaluated modules retain their own TypeScript signatures; fixtures call
    // different functions through this isolated dynamic boundary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exports: Record<string, (...args: any[]) => any> = {}
    new Function("exports", ...Object.keys(context), js)(exports, ...Object.values(context))
    return exports
}

const user = { id: "fixture-user" }
const workspace = { id: "fixture-workspace", slug: "fixture", status: "active" }
function workspaceFixture(results: Array<{ data: unknown; error: unknown }>) {
    const queue = [...results]
    const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => { assert.ok(queue.length); return queue.shift() } }
    const redirects: string[] = []
    const functions = moduleFunctions("lib/workspaces.ts", {
        cache: (fn: unknown) => fn, createSupabaseServerClient: async () => ({}), requireAal2User: async () => user,
        supabaseAdmin: { from: () => builder }, normalizeWorkspaceRole: (role: unknown) => role,
        workspaceRoleMeetsMinimum: () => true,
        redirect: (path: string) => { redirects.push(path); throw new Error(`redirect:${path}`) },
    })
    return { run: () => functions.requireWorkspace("fixture"), redirects }
}

for (const stage of ["workspace", "membership", "legacy workspace"] as const) test(`${stage} read failures fail closed without redirecting a valid session`, async () => {
    const failure = { data: null, error: { message: "connection unavailable" } }
    const results = stage === "workspace" ? [failure] : stage === "membership" ? [{ data: workspace, error: null }, failure] : [{ data: null, error: { message: "custom_client_portal_domain missing" } }, failure]
    const fixture = workspaceFixture(results)
    await assert.rejects(fixture.run(), /Please retry/)
    assert.deepEqual(fixture.redirects, [])
})

test("verified absent membership still denies entry", async () => {
    const fixture = workspaceFixture([{ data: workspace, error: null }, { data: null, error: null }])
    await assert.rejects(fixture.run(), /redirect:\/workspaces/)
    assert.deepEqual(fixture.redirects, ["/workspaces"])
})

test("verified active membership still opens the workspace", async () => {
    const fixture = workspaceFixture([{ data: workspace, error: null }, { data: { role: "staff" }, error: null }])
    assert.equal((await fixture.run()).user.id, user.id)
})

for (const kind of ["enrollment", "assurance", "required", "aal1", "valid"] as const) test(`MFA ${kind} result preserves retry versus genuine challenge`, async () => {
    const functions = moduleFunctions("lib/auth/aal.ts", {
        getVerifiedUser: async () => user,
        redirectToLogin: () => { throw new Error("login redirect") },
        redirectToMfa: () => { throw new Error("MFA redirect") },
        supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { mfa_reenrollment_required: kind === "required" }, error: kind === "enrollment" ? new Error("network") : null }) }) }) }) },
    })
    const supabase = { auth: { mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: kind === "aal1" ? "aal1" : "aal2" }, error: kind === "assurance" ? new Error("assurance temporarily unavailable") : null }) } } }
    if (kind === "valid") assert.equal(await functions.requireAal2User(supabase), user)
    else await assert.rejects(functions.requireAal2User(supabase), kind === "required" || kind === "aal1" ? /MFA redirect/ : kind === "enrollment" ? /Please retry/ : /temporarily unavailable/)
})

function panelReader(fetcher: () => Promise<unknown>) {
    return moduleFunctions("components/workspace/NativeWorkspaceTab.tsx", { nativeWorkspaceRoute, fetch: fetcher }, ["readNativePanel", "NativePanelAccessError", "NativePanelUnavailableError"]).readNativePanel
}
const readInput = () => ({ url: "/fixture/relationships", workspaceSlug: "fixture", workspaceId: workspace.id, userId: user.id, signal: new AbortController().signal })
for (const status of [403, 404]) test(`panel ${status} does not require an account-wide reload`, async () => {
    const read = panelReader(async () => new Response(null, { status }))
    await assert.rejects(read(readInput()), (error: Error) => error.constructor.name === "NativePanelUnavailableError" && !error.message.includes("Reload"))
})
for (const status of [401, 409]) test(`panel ${status} still blocks a changed session`, async () => {
    await assert.rejects(panelReader(async () => new Response(null, { status }))(readInput()), (error: Error) => error.constructor.name === "NativePanelAccessError")
})
test("transient server failure stays retryable", async () => {
    await assert.rejects(panelReader(async () => new Response(null, { status: 500 }))(readInput()), /Please retry/)
})
test("a superseded response cannot revoke the current workspace", async () => {
    const controller = new AbortController()
    const read = panelReader(async () => { controller.abort(); return new Response(null, { status: 409 }) })
    await assert.rejects(read({ ...readInput(), signal: controller.signal }), { name: "AbortError" })
})
test("a superseded JSON parse cannot report another account", async () => {
    const controller = new AbortController()
    const read = panelReader(async () => ({ ok: true, status: 200, redirected: false, headers: new Headers({ "content-type": "application/json" }), json: async () => { controller.abort(); return { userId: "other" } } }))
    await assert.rejects(read({ ...readInput(), signal: controller.signal }), { name: "AbortError" })
})
test("identity mismatch still rejects otherwise successful private data", async () => {
    const read = panelReader(async () => Response.json({ ...workspace, workspaceId: workspace.id, workspaceSlug: workspace.slug, userId: "other" }))
    await assert.rejects(read(readInput()), (error: Error) => error.constructor.name === "NativePanelAccessError")
})
test("record denial removes only its private snapshot; explicit retry can recover", async () => {
    const cache = new WorkspaceRecordCache<string>()
    cache.seed("denied", "private record")
    cache.seed("queue", "usable work queue")
    const unchangedQueue = cache.getSnapshot("queue")
    await assert.rejects(cache.load("denied", async () => { throw new Error("denied") }, { force: true, discardDataOnError: () => true }))
    assert.equal(cache.getSnapshot("denied").data, null)
    assert.equal(cache.getSnapshot("denied").error, "denied")
    assert.equal(cache.getSnapshot("queue"), unchangedQueue)
    await cache.load("denied", async () => "authorized again", { force: true })
    assert.equal(cache.getSnapshot("denied").data, "authorized again")
})

for (const scenario of ["failed retry", "old route", "cancelled", "cached content"] as const) test(`${scenario} settles only a matching empty-panel retry`, async () => {
    const path = "components/workspace/NativeWorkspaceTab.tsx"
    const source = ts.createSourceFile(path, readFileSync(`${process.env.LOADING_BASELINE_DIR ?? "."}/${path}`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let declaration: ts.VariableDeclaration | undefined
    function visit(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === "refresh") declaration = node
        ts.forEachChild(node, visit)
    }
    visit(source)
    assert.ok(declaration)
    const messages: unknown[] = []
    const context = {
        useCallback: (fn: unknown) => fn,
        current: { current: { active: true, accountCleared: false, tab: { url: "/fixture/work" } } },
        tab: { url: "/fixture/work" }, key: "work", accessError: null,
        cache: { getSnapshot: () => ({ data: scenario === "cached content" ? "usable" : null }), invalidate() {} },
        read: async () => { throw scenario === "cancelled" ? new DOMException("Cancelled", "AbortError") : new Error("temporary failure") },
        post: (message: unknown) => messages.push(message),
    }
    const js = ts.transpileModule(`const ${declaration.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const refresh = new Function(...Object.keys(context), `${js}; return refresh;`)(...Object.values(context))
    refresh()
    if (scenario === "old route") context.current.current.tab.url = "/fixture/relationships"
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(messages, scenario === "failed retry" ? [{ type: "navigation-failed", url: "/fixture/work" }] : [])
})
