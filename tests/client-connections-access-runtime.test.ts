import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { performance } from "node:perf_hooks"
import test from "node:test"
import ts from "typescript"
import * as capabilities from "../lib/workspace-capabilities.ts"
import * as panels from "../lib/workspace-panels.ts"
import * as roles from "../lib/workspace-roles.ts"
import type { WorkspaceAccess } from "../lib/workspace-access.ts"

function compile<T>(path: string, dependencies: Record<string, unknown>): T {
    const compiled = { exports: {} }
    const javascript = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("require", "module", "exports", javascript)((name: string) => {
        assert.ok(name in dependencies, `Unexpected dependency ${name}`)
        return dependencies[name]
    }, compiled, compiled.exports)
    return compiled.exports as T
}

const identity = { workspaceId: "workspace", workspaceSlug: "fixture", userId: "staff", role: "staff" as const }
function accessFixture(options: { eligible?: boolean; legacyAllocation?: boolean; explicit?: boolean; failure?: string } = {}) {
    const calls: Array<{ table: string; filters: Array<[string, unknown]>; limit?: number }> = []
    const data: Record<string, unknown> = {
        workspace_member_service_access: options.eligible ? [{ service_id: "appointment", onboarding_services: { workspace_service_capabilities: [] } }] : [],
        workspace_operational_roles: { can_sell: false, can_manage: false },
        relationship_services: options.legacyAllocation ? [{ service_id: "appointment" }] : [],
        appointment_setting_setup_assignees: options.explicit ? [{ relationship_id: "client" }] : [],
        onboarding_services: [{ id: "appointment" }],
        onboarding_service_revisions: [{ service_id: "appointment", definition: { templateId: "appointment-setting" } }],
    }
    const supabaseAdmin = {
        from(table: string) {
            assert.ok(table in data, `Unexpected access query ${table}`)
            const call: typeof calls[number] = { table, filters: [] }
            calls.push(call)
            const query = {
                select() { return query },
                eq(key: string, value: unknown) { call.filters.push([key, value]); return query },
                neq(key: string, value: unknown) { call.filters.push([key, value]); return query },
                in(key: string, value: unknown) { call.filters.push([key, value]); return query },
                limit(value: number) { call.limit = value; return query },
                maybeSingle() { return query },
                then(resolve: (value: { data: unknown; error: { code: string } | null }) => unknown) {
                    return Promise.resolve(resolve({ data: data[table], error: options.failure === table ? { code: "fixture" } : null }))
                },
            }
            return query
        },
        rpc() { throw new Error("Routine access must not query current client assignments") },
    }
    const loaded = compile<{ loadWorkspaceAccess(input: typeof identity): Promise<WorkspaceAccess> }>("lib/workspace-access.ts", {
        "server-only": {}, react: { cache: <T>(value: T) => value },
        "next/navigation": { notFound: () => { throw new Error("not found") } },
        "@/lib/supabase/admin": { supabaseAdmin },
        "@/lib/workspace-capabilities": capabilities,
        "@/lib/workspace-panels": panels,
        "@/lib/workspaces": {},
    })
    return { load: () => loaded.loadWorkspaceAccess(identity), calls }
}

test("eligible unassigned staff can open Client Connections without new client assignment reads", async () => {
    const fixture = accessFixture({ eligible: true })
    const access = await fixture.load()
    assert.ok(access.capabilities.includes("client_connections.manage"))
    assert.ok(access.capabilities.includes("appointment_setting.manage"))
    assert.equal(panels.canAccessWorkspaceUrl("/fixture/client-connections", "fixture", "staff", access.capabilities), true)
    assert.deepEqual(fixture.calls.map(call => call.table), [
        "workspace_member_service_access", "workspace_operational_roles", "relationship_services", "appointment_setting_setup_assignees", "onboarding_services", "onboarding_service_revisions",
    ])
    assert.deepEqual(fixture.calls[3], { table: "appointment_setting_setup_assignees", filters: [["workspace_id", "workspace"], ["user_id", "staff"]], limit: 1 })
})

test("independent setup grants and existing service allocations preserve panel visibility", async () => {
    const explicit = accessFixture({ explicit: true })
    const explicitAccess = await explicit.load()
    assert.ok(explicitAccess.capabilities.includes("client_connections.manage"))
    assert.equal(explicitAccess.capabilities.includes("appointment_setting.manage"), false)
    assert.equal(explicit.calls.length, 4)
    const allocated = await accessFixture({ legacyAllocation: true }).load()
    assert.ok(allocated.capabilities.includes("client_connections.manage"))
    const unrelated = await accessFixture().load()
    assert.equal(unrelated.capabilities.includes("client_connections.manage"), false)
})

test("missing access evidence still fails closed instead of exposing Client Connections", async () => {
    const access = await accessFixture({ eligible: true, failure: "appointment_setting_setup_assignees" }).load()
    assert.equal(access.serviceAccessSchemaReady, false)
    assert.deepEqual(access.capabilities, ["fulfilment.manage", "communications.manage"])
})

test("the existing single shell bootstrap supplies Client Connections visibility without another query", async () => {
    for (const supplied of [["appointment_setting.manage"], ["client_connections.manage"], ["fulfilment.manage"], ["appointment_setting.manage", "client_connections.manage"]]) {
        const calls: unknown[] = []
        const loaded = compile<{ requireWorkspaceShellBootstrap(slug: string): Promise<{ access: WorkspaceAccess; timing: { fallback: boolean } }> }>("lib/workspace-shell-bootstrap.ts", {
            "server-only": {}, "node:perf_hooks": { performance },
            "next/navigation": { redirect: () => { throw new Error("Unexpected redirect") } },
            "@/lib/supabase/server": { createSupabaseServerClient: async () => ({}) },
            "@/lib/auth/aal": { requireAal2User: async () => ({ id: "staff" }) },
            "@/lib/supabase/admin": { supabaseAdmin: { rpc: async (...args: unknown[]) => {
                calls.push(args)
                return { error: null, data: { workspace_id: "workspace", workspace_name: "Fixture", workspace_slug: "fixture", role: "staff", capabilities: supplied, allowed_service_ids: ["appointment"], service_access_schema_ready: true } }
            } } },
            "@/lib/workspace-capabilities": capabilities,
            "@/lib/workspace-roles": roles,
            "@/lib/workspace-access": { requireWorkspaceAccess: () => { throw new Error("Unexpected fallback reads") } },
        })
        const result = await loaded.requireWorkspaceShellBootstrap("fixture")
        assert.equal(result.access.capabilities.includes("client_connections.manage"), supplied.includes("appointment_setting.manage") || supplied.includes("client_connections.manage"))
        assert.equal(result.access.capabilities.filter(value => value === "client_connections.manage").length, supplied[0] === "fulfilment.manage" ? 0 : 1)
        assert.deepEqual(calls, [["workspace_shell_bootstrap", { p_workspace_slug: "fixture", p_user_id: "staff" }]])
        assert.equal(result.timing.fallback, false)
    }
})
