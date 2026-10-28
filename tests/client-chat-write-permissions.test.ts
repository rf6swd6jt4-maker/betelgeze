import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
for (const [name, method] of [["messages", "POST"], ["reactions", "POST"], ["attachments", "POST"], ["attachments", "DELETE"], ["typing", "POST"], ["reconfirm", "POST"], ["pins", "POST"], ["checklist", "PATCH"]]) {
    test(`View-only ${name} ${method} stops before database writes or provider calls`, async () => {
        const calls: unknown[][] = []
        const deniedSideEffect = new Proxy({}, { get: (_, field) => { throw new Error(`Unexpected side effect: ${String(field)}`) } })
        const access = async (...args: unknown[]) => { calls.push(args); return false }
        const session = async () => ({ workspace: { id: id(1), slug: "scaylup" }, user: { id: id(2) } })
        const modules: Record<string, unknown> = {
            "@/lib/communications/access": { clientConversationCanAccess: async () => true, clientConversationCanWrite: access },
            "@/lib/workspace-access": { requireWorkspacePanel: session },
            "@/lib/communications/workspace-access": { requireCommunicationsWorkspace: session },
            "@/lib/communications/performance-server": { withChatPerformance: (_: string, handler: unknown) => handler },
            "@/lib/communications/checklists": { checkboxInput: (raw: unknown) => raw, validChatId: () => true },
        }
        const code = ts.transpileModule(readFileSync(`app/api/workspaces/[workspaceSlug]/communications/${name}/route.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
        const compiled = { exports: {} as Record<string, (request: Request, context: unknown) => Promise<Response>> }
        new Function("require", "module", "exports", code)((key: string) => modules[key] ?? deniedSideEffect, compiled, compiled.exports)
        const response = await compiled.exports[method](new Request("https://fixture/route", { method, body: JSON.stringify({ relationshipId: id(3), messageId: id(4), clientRequestId: id(5), body: "Must not send", emoji: "👍", line: 0, checked: true, expectedBody: "- [ ] item" }) }), { params: Promise.resolve({ workspaceSlug: "scaylup" }) })
        assert.equal(response.status, 404)
        assert.deepEqual(calls, [[id(1), id(3), id(2)]], "one replacement authorization call, using trusted session identity")
    })
}
