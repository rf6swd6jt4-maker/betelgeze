import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import ts from "typescript"

const require = createRequire(import.meta.url)
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
function fixture() {
    Object.assign(process.env, { GHL_OAUTH_ENABLED: "true", GHL_OAUTH_CLIENT_ID: "synthetic-client", GHL_OAUTH_CLIENT_SECRET: "synthetic-client-secret", GHL_OAUTH_APP_ID: "synthetic-app", GHL_OAUTH_INSTALL_URL: "https://marketplace.gohighlevel.com/oauth/chooselocation" })
    const calls: Array<{ action: string; input: Record<string, unknown> }> = []
    const jar = new Map<string, string>(), cookieOptions: Record<string, unknown>[] = []
    let activeUser = id(2), exchanges = 0, phase = "authorizing"
    const attempt: Record<string, unknown> = { workspace_id: id(1), workspace_slug: "fixture", relationship_id: id(3), user_id: id(2), choices: [{ id: "location123456789", name: "Fixture" }], limited: false, credential_encrypted: null }
    const token = { accessToken: "synthetic-access-token", refreshToken: "synthetic-refresh-token", expiresAt: new Date(Date.now() + 86400000).toISOString(), userType: "Location", locationId: "location123456789", companyId: "company123456789", scope: "fixture" }
    let exchange: () => Promise<typeof token> = async () => token
    const mocks: Record<string, unknown> = {
        "server-only": {},
        "next/headers": { cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name: string, value: string, options: Record<string, unknown>) => { jar.set(name, value); cookieOptions.push(options) } }) },
        "@/lib/workspace-access": { requireWorkspacePanel: async () => ({ workspace: { id: id(1), slug: "fixture" }, user: { id: activeUser } }) },
        "@/lib/workspace-integrations": { encryptIntegrationCredential: JSON.stringify, decryptWorkspaceIntegration: JSON.parse },
        "@/lib/client-portal/ghl-calendar-list-provider": { fetchGhlCalendars: async () => [{ id: "calendar123456789", name: "Calendar" }] },
        "@/lib/client-portal/ghl-calendar-provider": { fetchGhlCalendar: async () => ({}) },
        "@/lib/client-portal/ghl-provider": { fetchGhlMetrics: async () => ({ companyId: token.companyId, locationName: "Fixture", metrics: {} }) },
        "./provider": {
            GHL_OAUTH_CALLBACK: "https://app.betelgeze.com/api/integrations/calendar/callback",
            ghlAuthorizationUrl: (_config: unknown, state: string) => `https://marketplace.gohighlevel.com/oauth/chooselocation?state=${state}`,
            exchangeGhlCode: async () => { exchanges++; return exchange() },
            listGhlInstalledLocations: async () => ({ locations: attempt.choices, limited: false }),
            ghlLocationToken: async () => token,
        },
        "@/lib/supabase/admin": { supabaseAdmin: { rpc: async (name: string, params: { p_action: string; p_input: Record<string, unknown> }) => {
            const { p_action: action, p_input: input } = params; calls.push({ action: `${name}:${action}`, input })
            if (name === "ghl_appointment_setup") return { data: { failure: "portal" } }
            if (action === "prepare") return { data: { accepted: true } }
            if (action === "read") return { data: { ...attempt, phase } }
            if (action === "transition") {
                if (phase !== input.from) return { data: { failure: "phase" } }
                phase = String(input.to)
                if (input.credential) attempt.credential_encrypted = input.credential
                if (input.locationId) attempt.selected_location = input.locationId
                return { data: { accepted: true } }
            }
            if (action === "connect") { phase = "done"; return { data: { connected: true, revision: id(4) } } }
            throw Error("Unexpected fixture RPC")
        } } },
    }
    const compiled = { exports: {} }
    const code = ts.transpileModule(readFileSync("lib/ghl-oauth/server.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("require", "module", "exports", code)((path: string) => path in mocks ? mocks[path] : require(path), compiled, compiled.exports)
    const api = compiled.exports as typeof import("../lib/ghl-oauth/server")
    return { api, calls, jar, cookieOptions, exchanges: () => exchanges, phase: () => phase, user: (value: string) => { activeUser = value }, exchange: (value: typeof exchange) => { exchange = value }, token }
}
async function start(f: ReturnType<typeof fixture>) {
    const result = await f.api.startGhlConnection("fixture", { relationshipId: id(3), expectedRevision: null })
    return new URL(result.authorizationUrl).searchParams.get("state")!
}
test("the OAuth browser binding is private, secure, bounded and cannot be reused from another browser", async () => {
    const f = fixture(), state = await start(f)
    assert.equal(state.length, 43)
    assert.deepEqual(f.cookieOptions[0], { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 1200 })
    await assert.rejects(f.api.completeGhlAuthorization("x".repeat(43), "code", false))
    f.jar.clear()
    await assert.rejects(f.api.completeGhlAuthorization(state, "code", false))
    assert.equal(f.exchanges(), 0)
})
test("a different BE user cannot redeem the original user's installed app grant", async () => {
    const f = fixture(), state = await start(f)
    f.user(id(99))
    await assert.rejects(f.api.completeGhlAuthorization(state, "code", false))
    assert.equal(f.exchanges(), 0)
})
test("a concurrent duplicate callback cannot redeem the code again or fail the callback that owns it", async () => {
    const f = fixture(), state = await start(f)
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    f.exchange(async () => { await pending; return f.token })
    const first = f.api.completeGhlAuthorization(state, "code", false)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.phase(), "exchanging")
    await assert.rejects(f.api.completeGhlAuthorization(state, "code", false))
    assert.equal(f.phase(), "exchanging")
    release()
    assert.equal((await first).searchParams.get("ghl"), "ready")
    assert.equal((await f.api.completeGhlAuthorization(state, "code", false)).searchParams.get("ghl"), "ready")
    assert.equal(f.exchanges(), 1)
    const status = await f.api.readGhlConnection("fixture")
    assert.equal(JSON.stringify(status).includes("synthetic-access-token"), false)
    assert.equal(JSON.stringify(status).includes("refreshToken"), false)
})
test("a committed connection remains distinguishable from incomplete notification setup, including retries", async () => {
    const f = fixture(), state = await start(f)
    await f.api.completeGhlAuthorization(state, "code", false)
    await assert.rejects(f.api.selectGhlLocation("fixture", "differentlocation123"))
    await f.api.selectGhlLocation("fixture", "location123456789")
    for (let attempt = 0; attempt < 2; attempt++) {
        const result = await f.api.finishGhlConnection("fixture", "calendar123456789")
        assert.equal(result.connected, true)
        assert.equal(result.notifications.ready, false)
        assert.equal(result.notifications.sendingEnabled, false)
    }
    assert.equal(f.exchanges(), 1)
})
