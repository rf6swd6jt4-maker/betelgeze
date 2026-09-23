import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
const note = "00000000-0000-4000-8000-000000000001", a = "00000000-0000-4000-8000-000000000002", b = "00000000-0000-4000-8000-000000000003", c = "00000000-0000-4000-8000-000000000004"
function fixture() {
    const row = { name: "Original", description: "Description" }, links = new Set([a]), calls: Array<{ name: string; values: Record<string, unknown> }> = []
    const mock = { rpc: async (name: string, values: Record<string, unknown>) => {
        calls.push({ name, values })
        if (name === "edit_note_relationships") { for (const id of values.p_remove as string[]) links.delete(id); for (const id of values.p_add as string[]) links.add(id); return { data: [...links] } }
        assert.equal(name, "save_note_text")
        const field = values.p_field as "name" | "description"
        if (row[field] !== values.p_baseline && row[field] !== values.p_value) return { data: { ok: false, version: "v2" } }
        row[field] = (values.p_value as string).trim(); return { data: { ok: true, version: "v2" } }
    } }
    const stubs: Record<string, unknown> = { "next/cache": { revalidatePath() {} }, "@/lib/notes": { noteHref: () => "/note" }, "@/lib/supabase/admin": { supabaseAdmin: mock }, "@/lib/workspaces": { requireWorkspace: async () => ({ workspace: { id: "workspace" }, user: { id: "user" } }) } }
    const compiled = { exports: {} }
    new Function("require", "module", "exports", ts.transpileModule(readFileSync("app/[workspaceSlug]/notes/[id]/actions.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)((id: string) => stubs[id], compiled, compiled.exports)
    return { actions: compiled.exports as typeof import("../app/[workspaceSlug]/notes/[id]/actions"), row, links, calls }
}
test("note link action sends only explicit intent from submitted baseline", async () => {
    const f = fixture(); f.links.add(b)
    assert.equal((await f.actions.updateNoteRelationships("slug", note, [a, c], [a], "user")).ok, true)
    assert.deepEqual([...f.links].sort(), [a, b, c].sort())
    assert.deepEqual(f.calls[0].values.p_remove, []); assert.deepEqual(f.calls[0].values.p_add, [c])
})
test("note text action saves fields independently and exposes same-field conflict", async () => {
    const f = fixture()
    assert.equal((await f.actions.saveNoteText("slug", note, "name", "New", "Original", "user")).ok, true)
    assert.equal((await f.actions.saveNoteText("slug", note, "description", "New description", "Description", "user")).ok, true)
    const conflict = await f.actions.saveNoteText("slug", note, "name", "Stale", "Original", "user")
    assert.equal(conflict.ok, false); assert.equal("conflict" in conflict && conflict.conflict, true)
    assert.deepEqual(f.row, { name: "New", description: "New description" })
})
test("old blind-note commands and changed sessions never issue writes", async () => {
    const f = fixture()
    assert.equal((await f.actions.saveNoteFields("slug", note, new FormData())).ok, false)
    assert.equal((await f.actions.updateNote("slug", note, new FormData())).ok, false)
    assert.equal((await f.actions.updateNoteRelationships("slug", note, [])).ok, false)
    assert.equal((await f.actions.saveNoteText("slug", note, "name", "Changed", "Original", "other")).ok, false)
    assert.equal(f.calls.length, 0)
})
