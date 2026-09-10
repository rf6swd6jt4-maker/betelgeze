import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import ts from "typescript"

test("cold Comms entry awaits only the selected legacy bootstrap and no new history RPC", async () => {
    const path = "app/[workspaceSlug]/communications/page.tsx"
    const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText
    const calls: string[] = []
    const dependencies: Record<string, unknown> = {
        "@/components/communications/CommunicationsPanel": { CommunicationsPanel: () => null },
        "@/components/workspace/WorkspaceTopBar": { WorkspaceTopBar: () => null },
        "@/lib/workspace-access": { requireWorkspacePanel: async () => { calls.push("authorize"); return { workspace: { id: "workspace", slug: "example" }, user: { id: "actor" }, role: "owner" } } },
        "@/lib/communications/bootstrap": { loadClientCommunicationsBootstrap: async () => { calls.push("clients"); return { selectedConversationId: "client" } } },
        "@/lib/teams/server": { loadNativeCommunications: async () => { calls.push("team"); return { requestedConversationId: "team" } } },
    }
    const localRequire = createRequire(resolve(path))
    const compiled = new Module(resolve(path)) as Module & { _compile: (source: string, filename: string) => void }
    compiled.require = ((name: string) => name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiled.require
    compiled._compile(source, path)
    for (const [query, mode] of [[{}, "clients"], [{ mode: "team" }, "team"], [{ dm: "person" }, "team"], [{ nativeConversation: "team" }, "team"], [{ mode: "clients", nativeConversation: "team" }, "clients"]] as const) {
        calls.length = 0
        const page = await compiled.exports.default({ params: Promise.resolve({ workspaceSlug: "example" }), searchParams: Promise.resolve(query) })
        assert.deepEqual(calls, ["authorize", mode])
        const panel = page.props.children[1]
        assert.equal(panel.props.initialMode, mode)
        assert.equal(panel.props[mode === "clients" ? "nativeBootstrap" : "clientBootstrap"], null)
    }
})
