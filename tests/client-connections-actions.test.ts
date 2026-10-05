import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

const workspaceId = "00000000-0000-4000-8000-000000000001"
const userId = "00000000-0000-4000-8000-000000000002"
const ownerId = "00000000-0000-4000-8000-000000000003"
const otherWorkspace = "00000000-0000-4000-8000-000000000004"
const relationshipId = "00000000-0000-4000-8000-000000000005"
const payload = { relationshipId, accountType: "client_account", locationId: "fixture-location", privateToken: "fixture-private-token-long-enough" }

function compiled(path: string, modules: Record<string, unknown>) {
    const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const compiledModule = { exports: {} as Record<string, (...args: unknown[]) => Promise<{ ok: boolean; error?: string }>> }
    new Function("require", "module", "exports", output)((id: string) => {
        if (!(id in modules)) throw new Error(`Unexpected test dependency: ${id}`)
        return modules[id]
    }, compiledModule, compiledModule.exports)
    return compiledModule.exports
}

function fixture(options: { grantedUser?: string; grantedWorkspace?: string; panelDenied?: boolean } = {}) {
    const calls: Array<Record<string, unknown>> = []
    const invalidations: string[] = []
    let providerCalls = 0
    class GhlError extends Error {
        code: string
        constructor(code: string) { super(code); this.code = code }
    }
    const manager = compiled("lib/client-connections.ts", {
        "server-only": {},
        "node:crypto": { randomUUID },
        "@/lib/client-portal/ghl-provider": {
            GhlError,
            parseGhlCredentials: (input: Record<string, unknown>) => ({ locationId: input.locationId, privateToken: input.privateToken }),
            fetchGhlMetrics: async () => {
                providerCalls++
                return { locationName: "Fixture location", metrics: { contacts: 0, opportunities: 0, open: 0, won: 0, lost: 0 } }
            },
        },
        "@/lib/workspace-integrations": { getWorkspaceProviderConfig: async () => ({}) },
        "@/lib/supabase/admin": { supabaseAdmin: { rpc: async (name: string, values: Record<string, unknown>) => {
            assert.equal(name, "manage_client_ghl_connection")
            calls.push(values)
            // SQL's real actor/client grant is covered by the isolated migration
            // fixture. This boundary exposes which identity the action supplies.
            const permitted = values.p_workspace_id === (options.grantedWorkspace ?? workspaceId)
                && values.p_user_id === (options.grantedUser ?? userId)
                && values.p_relationship_id === relationshipId
            if (!permitted) return { data: { failure: "access" }, error: null }
            return { data: values.p_action === "begin_refresh" ? { ...payload, accountType: "client_account" } : { accepted: true }, error: null }
        } } },
    })
    const actions = compiled("app/[workspaceSlug]/client-connections/actions.ts", {
        "next/cache": { revalidatePath: (path: string) => invalidations.push(path) },
        "@/lib/client-connections": manager,
        "@/lib/workspace-access": { requireWorkspacePanel: async (slug: string, panel: string) => {
            assert.equal(slug, "fixture")
            assert.equal(panel, "client-connections")
            if (options.panelDenied) throw new Error("Panel access denied")
            return { workspace: { id: workspaceId }, user: { id: userId } }
        } },
    })
    return { actions, calls, invalidations, providerCalls: () => providerCalls }
}

test("connection actions ignore forged context fields and pass the authenticated actor and exact target", async () => {
    const f = fixture()
    const result = await f.actions.connectClientAccount("fixture", { ...payload, workspaceId: otherWorkspace, userId: ownerId })
    assert.equal(result.ok, true)
    assert.equal(f.providerCalls(), 1)
    assert.deepEqual(f.calls.map(call => [call.p_workspace_id, call.p_user_id, call.p_relationship_id, call.p_action]), [
        [workspaceId, userId, relationshipId, "begin_connect"],
        [workspaceId, userId, relationshipId, "finish"],
    ])
    assert.deepEqual(f.invalidations, ["/fixture/client-connections"])
})

test("a staff caller cannot forge an authorized owner's context to reach the provider", async () => {
    const f = fixture({ grantedUser: ownerId, grantedWorkspace: otherWorkspace })
    const result = await f.actions.connectClientAccount("fixture", { ...payload, workspaceId: otherWorkspace, userId: ownerId })
    assert.equal(result.ok, false)
    assert.match(result.error ?? "", /do not have access/)
    assert.equal(f.providerCalls(), 0)
    assert.equal(f.invalidations.length, 0)
    assert.ok(f.calls.length > 0)
    assert.ok(f.calls.every(call => call.p_workspace_id === workspaceId && call.p_user_id === userId))
})

test("panel denial reaches neither connection RPC nor provider", async () => {
    const f = fixture({ panelDenied: true })
    assert.equal((await f.actions.connectClientAccount("fixture", payload)).ok, false)
    assert.equal((await f.actions.refreshClientAccount("fixture", relationshipId)).ok, false)
    assert.equal(f.calls.length, 0)
    assert.equal(f.providerCalls(), 0)
})

test("refresh checks the authenticated actor's exact client before requesting provider metrics", async () => {
    const f = fixture({ grantedUser: ownerId })
    const result = await f.actions.refreshClientAccount("fixture", relationshipId)
    assert.equal(result.ok, false)
    assert.equal(f.providerCalls(), 0)
    assert.ok(f.calls.every(call => call.p_workspace_id === workspaceId && call.p_user_id === userId && call.p_relationship_id === relationshipId))
})
