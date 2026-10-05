import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

const source = readFileSync(new URL("../components/relationships/RelationshipServicePos.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("RelationshipServicePos.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const field = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "AssigneeField")!
const code = ts.transpileModule(field.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText

function fixture() {
    const state: unknown[] = []
    let cursor = 0, effect: (() => void | (() => void)) | undefined, cleanup: (() => void) | undefined
    let previousDependencies: unknown[] | undefined
    const requests: Array<{ url: string; options: RequestInit; resolve: (response: { ok: boolean; json: () => Promise<unknown> }) => void }> = []
    const renderField = new Function("useState", "useEffect", "fetch", "React", "AssignmentSelector", `${code}; return AssigneeField`)(
        (initial: unknown) => {
            const index = cursor++
            if (!(index in state)) state[index] = initial
            return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? value(state[index]) : value }]
        },
        (next: typeof effect, dependencies: unknown[]) => {
            if (!previousDependencies || dependencies.some((value, index) => value !== previousDependencies![index])) {
                effect = next
                previousDependencies = dependencies
            }
        },
        (url: string, options: RequestInit) => new Promise(resolve => requests.push({ url, options, resolve })),
        { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }) },
        "AssignmentSelector",
    )
    function render(userId = "actor", serviceId = "service") {
        cursor = 0
        renderField({ endpoint: "/api/services", userId, row: { service_id: serviceId, name: "Appointment Setting" }, value: "", onChange() {}, disabled: false })
        if (effect) { cleanup?.(); cleanup = effect() || undefined; effect = undefined }
    }
    return { render, requests, state, unmount: () => cleanup?.() }
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

test("POS threads the authenticated account into its assignee request and accepts the authorized list", async () => {
    const f = fixture()
    f.render()
    const call = f.requests[0]
    const matchingAccount = new Headers(call.options.headers).get("x-workspace-user") === "actor"
    call.resolve({ ok: matchingAccount, json: async () => matchingAccount ? [{ id: "person", name: "Assigned person" }] : { error: "Your account changed." } })
    await settle()
    assert.deepEqual(f.state[0], [{ id: "person", name: "Assigned person" }])
    assert.equal(f.state[1], "")
    assert.equal(call.url, "/api/services?kind=assignees&service=service")
    assert.match(source, /<AssigneeField[^>]*userId=\{userId\}/)
    f.unmount()
})

test("late POS assignee responses cannot overwrite a newer service or account", async () => {
    const f = fixture()
    f.render("actor", "first")
    f.render("actor", "second")
    f.requests[1].resolve({ ok: true, json: async () => [{ id: "second", name: "Current person" }] })
    await settle()
    f.requests[0].resolve({ ok: true, json: async () => [{ id: "first", name: "Stale person" }] })
    await settle()
    assert.deepEqual(f.state[0], [{ id: "second", name: "Current person" }])
    f.render("new-actor", "second")
    assert.equal(f.requests.length, 3)
    assert.equal(new Headers(f.requests[2].options.headers).get("x-workspace-user"), "new-actor")
    f.unmount()
    f.requests[2].resolve({ ok: true, json: async () => [{ id: "departed", name: "Departed account" }] })
    await settle()
    assert.deepEqual(f.state[0], [{ id: "second", name: "Current person" }])
})

test("POS account mismatch exposes an error without accepting returned assignees", async () => {
    const f = fixture()
    f.render()
    f.requests[0].resolve({ ok: false, json: async () => ({ error: "Your account changed." }) })
    await settle()
    assert.equal(f.state[0], null)
    assert.equal(f.state[1], "Your account changed.")
    f.unmount()
})
