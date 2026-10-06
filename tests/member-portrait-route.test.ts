import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

const actor = "00000000-0000-4000-8000-000000000003"
const member = "00000000-0000-4000-8000-000000000004"
const code = ts.transpileModule(readFileSync("app/api/workspaces/[workspaceSlug]/members/[userId]/profile/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
function fixture({ membership = true, failure = false, avatar = true } = {}) {
    const reads: Array<{ table: string; fields: string; filters: Record<string, string> }> = []
    const modules: Record<string, unknown> = {
        "@/lib/workspaces": { requireWorkspace: async () => ({ workspace: { id: "workspace" }, user: { id: actor } }) },
        "@/lib/profile-avatar": { profileAvatarUrl: (username: string, path: string) => `/avatar/${username}/${path}` },
        "@/lib/supabase/admin": { supabaseAdmin: { from: (table: string) => {
            const read = { table, fields: "", filters: {} as Record<string, string> }; reads.push(read)
            const query = {
                select(fields: string) { read.fields = fields; return query },
                eq(key: string, value: string) { read.filters[key] = value; return query },
                async maybeSingle() { return { error: failure ? { message: "Unavailable" } : null, data: table === "workspace_memberships" ? membership ? { user_id: member } : null : { username: "alex", avatar_path: avatar ? "portrait" : null } } },
            }
            return query
        } } },
    }
    const compiled = { exports: {} as { GET: (request: Request, context: unknown) => Promise<Response> } }
    new Function("require", "module", "exports", code)((name: string) => { assert.ok(name in modules); return modules[name] }, compiled, compiled.exports)
    return { reads, get: (expectedActor = actor, memberId = member) => compiled.exports.GET(new Request("https://fixture/profile?view=avatar", { headers: { "x-workspace-user": expectedActor } }), { params: Promise.resolve({ workspaceSlug: "fixture", userId: memberId }) }) }
}
test("portrait read returns only the versioned avatar for a member of the authorized workspace", async () => {
    const f = fixture(), response = await f.get()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(await response.json(), { avatarSrc: "/avatar/alex/portrait" })
    assert.deepEqual(f.reads, [
        { table: "workspace_memberships", fields: "user_id", filters: { workspace_id: "workspace", user_id: member } },
        { table: "user_profiles", fields: "username, avatar_path", filters: { user_id: member } },
    ])
})
test("portrait read rejects changed actors and malformed identities before database reads", async () => {
    const f = fixture()
    assert.equal((await f.get("other")).status, 409)
    assert.equal((await f.get(actor, "bad-id")).status, 404)
    assert.deepEqual(f.reads, [])
})
test("portrait read withholds nonmember images and distinguishes lookup failure from no photo", async () => {
    const denied = await fixture({ membership: false }).get()
    assert.equal(denied.status, 404)
    assert.equal((await denied.json()).avatarSrc, undefined)
    assert.equal((await fixture({ failure: true }).get()).status, 503)
    assert.deepEqual(await (await fixture({ avatar: false }).get()).json(), { avatarSrc: null })
})
