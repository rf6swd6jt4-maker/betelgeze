import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import ts from "typescript"

function archiveFixture(options: { missing?: boolean; databaseError?: boolean; denied?: boolean } = {}) {
    const events: unknown[] = []
    const source = readFileSync("app/[workspaceSlug]/relationships/actions.ts", "utf8")
    const archive = source.slice(source.indexOf("type ArchiveRelationshipState"), source.indexOf("export async function proceedRelationshipCurrentWork"))
    const compiled = ts.transpileModule(archive, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const dependencies = {
        requireWorkspace: async (slug: string, role: string) => {
            events.push(["access", slug, role])
            if (options.denied) throw new Error("Denied")
            return { workspace: { id: "workspace" }, user: { id: "actor" } }
        },
        supabaseAdmin: { rpc: async (name: string, payload: unknown) => {
            events.push([name, payload])
            return { data: options.missing ? null : true, error: options.databaseError ? { code: "PGRST202", message: "Missing RPC" } : null }
        } },
        relationshipRevalidatePaths: (slug: string, id: string) => events.push(["revalidate", slug, id]),
        workspaceHref: (slug: string, section: string) => `/${slug}/${section}`,
        workspaceTabFrameUrl: (href: string, id: string) => `${href}?frame=${id}`,
        WORKSPACE_TAB_FRAME_PARAM: "frame",
        formString: (form: FormData, key: string) => form.get(key),
        redirect: (href: string) => { throw new Error(`REDIRECT:${href}`) },
        reportPlatformFailure: async () => events.push("reported"),
        platformFailureFingerprint: () => "fingerprint",
        relationshipHubHref: () => "/example/relationships/record",
    }
    const exports = {} as Record<string, (slug: string, id: string, state: object, form: FormData) => Promise<{ href?: string; error?: string }>>
    new Function("exports", ...Object.keys(dependencies), compiled)(exports, ...Object.values(dependencies))
    return { actions: exports, events }
}

test("native archive returns a tab destination while legacy archive keeps its frame redirect", async () => {
    const fixture = archiveFixture()
    assert.deepEqual(await fixture.actions.archiveRelationshipForNativePanel("example", "record", {}, new FormData()), { href: "/example/relationships" })
    assert.deepEqual(fixture.events, [
        ["access", "example", "admin"],
        ["archive_workspace_relationship", { p_workspace_id: "workspace", p_relationship_id: "record", p_actor_user_id: "actor" }],
        ["revalidate", "example", "record"],
    ])
    const form = new FormData()
    form.set("frame", "tab")
    await assert.rejects(fixture.actions.archiveRelationship("example", "record", {}, form), /REDIRECT:\/example\/relationships\?frame=tab/)
})

test("archive permission and database failures never return a navigation destination", async () => {
    for (const options of [{ missing: true }, { databaseError: true }]) {
        const fixture = archiveFixture(options)
        const result = await fixture.actions.archiveRelationshipForNativePanel("example", "record", {}, new FormData())
        assert.equal(result.href, undefined)
        assert.ok(result.error)
        assert.equal(fixture.events.some((event) => Array.isArray(event) && event[0] === "revalidate"), false)
    }
    const denied = archiveFixture({ denied: true })
    await assert.rejects(denied.actions.archiveRelationshipForNativePanel("example", "record", {}, new FormData()), /Denied/)
    assert.deepEqual(denied.events, [["access", "example", "admin"]])
})

test("native archive form pushes only a confirmed destination and preserves visible failures", async () => {
    const path = "app/[workspaceSlug]/relationships/[relationshipId]/ArchiveRelationshipForm.tsx"
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText
    let submit!: (state: object, form: FormData) => Promise<{ href?: string; error?: string }>
    const destinations: string[] = []
    const dependencies: Record<string, unknown> = {
        react: { useActionState: (action: typeof submit) => { submit = action; return [{}, () => {}, false] } },
        "@/components/workspace/WorkspaceNavigation": { useSearchParams: () => new URLSearchParams(), useWorkspaceNavigation: () => ({ push: (href: string) => destinations.push(href) }) },
        "@/components/detail": { DetailDangerButton: () => null },
        "@/lib/workspace-tabs": { WORKSPACE_TAB_FRAME_PARAM: "frame" },
        "@/lib/workspace-mutations": { runWorkspaceMutation: (action: () => unknown) => action() },
    }
    const localRequire = createRequire(resolve(path))
    const compiledModule = new Module(resolve(path)) as Module & { _compile: (source: string, filename: string) => void }
    compiledModule.require = ((name: string) => name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiledModule.require
    compiledModule._compile(compiled, path)
    const render = (action: () => Promise<object>) => compiledModule.exports.ArchiveRelationshipForm({ action, relationshipName: "Example" })
    render(async () => ({ href: "/example/relationships" }))
    await submit({}, new FormData())
    assert.deepEqual(destinations, ["/example/relationships"])
    render(async () => ({ error: "Archive rejected" }))
    assert.deepEqual(await submit({}, new FormData()), { error: "Archive rejected" })
    render(async () => { throw new Error("Connection lost") })
    assert.match((await submit({}, new FormData())).error!, /could not be confirmed/)
    assert.equal(destinations.length, 1)
})
