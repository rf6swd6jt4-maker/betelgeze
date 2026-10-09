import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import ts from "typescript"

const require = createRequire(import.meta.url)
function compile(path: string, resolve: (name: string) => unknown): Record<string, unknown> {
    const compiled = { exports: {} }
    const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("require", "module", "exports", code)(resolve, compiled, compiled.exports)
    return compiled.exports
}
const loaded = new Map<string, Record<string, unknown>>()
function provider(name: string): Record<string, unknown> {
    if (!loaded.has(name)) loaded.set(name, compile(`lib/client-portal/${name}.ts`, path => path.startsWith("./ghl-") ? provider(path.slice(2)) : require(path)))
    return loaded.get(name)!
}
const metrics = provider("ghl-provider") as typeof import("../lib/client-portal/ghl-provider")
const calendars = provider("ghl-calendar-list-provider") as typeof import("../lib/client-portal/ghl-calendar-list-provider")
const events = provider("ghl-calendar-provider") as typeof import("../lib/client-portal/ghl-calendar-provider")
const input = { relationshipId: "relationship-fixture", accountType: "agency_subaccount" as const, locationId: "location-fixture", privateToken: "private-token-never-disclose", expectedRevision: null, calendarId: "calendar-fixture" }

function fixture(deniedPath?: string, status = 401) {
    const actions: Record<string, unknown>[] = [], requests: string[] = []
    const fetcher: typeof fetch = async (url, init) => {
        const path = new URL(String(url)).pathname
        requests.push(path)
        assert.equal(init?.cache, "no-store")
        assert.equal(init?.redirect, "error")
        if (path === deniedPath) return new Response(`${input.privateToken} private customer payload`, { status })
        if (path.startsWith("/locations/")) return Response.json({ location: { id: input.locationId, name: "Fixture", companyId: "company-fixture", timezone: "America/Chicago" } })
        if (path === "/contacts/search") return Response.json({ contacts: [], total: 0 })
        if (path === "/opportunities/search") return Response.json({ opportunities: [], total: 0 })
        if (path === "/calendars/") return Response.json({ calendars: [{ id: input.calendarId, name: "Sales", locationId: input.locationId }] })
        if (path === "/calendars/events" || path === "/calendars/blocked-slots") return Response.json({ events: [] })
        throw new Error(`Unexpected provider path: ${path}`)
    }
    const modules: Record<string, unknown> = {
        "server-only": {}, "node:crypto": { randomUUID },
        "@/lib/client-portal/ghl-provider": { ...metrics, fetchGhlMetrics: (credentials: typeof input) => metrics.fetchGhlMetrics(credentials, fetcher) },
        "@/lib/client-portal/ghl-calendar-list-provider": { fetchGhlCalendars: (credentials: typeof input) => calendars.fetchGhlCalendars(credentials, fetcher) },
        "@/lib/client-portal/ghl-calendar-provider": { fetchGhlCalendar: (credentials: typeof input, month: string, binding: import("../lib/client-portal/ghl-calendar-provider").SelectedCalendarBinding) => events.fetchGhlCalendar(credentials, month, binding, fetcher) },
        "@/lib/workspace-integrations": { getWorkspaceProviderConfig: async () => ({ company_id: "company-fixture" }) },
        "@/lib/supabase/admin": { supabaseAdmin: { rpc: async (name: string, params: Record<string, unknown>) => {
            assert.equal(name, "manage_client_ghl_connection_v2")
            actions.push(params)
            return { data: { accepted: true, locationId: input.locationId }, error: null }
        } } },
    }
    const manager = compile("lib/client-connections.ts", name => {
        assert.ok(name in modules, name)
        return modules[name]
    }) as typeof import("../lib/client-connections")
    return { manager, actions, requests }
}

for (const [path, label, scope] of [
    ["/locations/location-fixture", "location details", "locations.readonly"],
    ["/contacts/search", "contacts", "contacts.readonly"],
    ["/opportunities/search", "opportunities", "opportunities.readonly"],
    ["/calendars/events", "calendar events", "calendars/events.readonly"],
    ["/calendars/blocked-slots", "calendar blocked slots", "calendars/events.readonly"],
]) {
    for (const status of [401, 403]) test(`calendar discovery can succeed while ${label} rejects save with ${status}`, async () => {
        const f = fixture(path, status)
        assert.deepEqual(await f.manager.loadClientCalendars("workspace", "actor", input), [{ id: input.calendarId, name: "Sales" }])
        await assert.rejects(f.manager.saveClientConnection("workspace", "actor", input), (error: Error) => {
            assert.ok(error.message.includes(`${label} check (HTTP ${status})`))
            assert.ok(error.message.includes(scope))
            assert.ok(!error.message.includes(input.privateToken))
            assert.ok(!error.message.includes(input.locationId))
            assert.ok(!error.message.includes("private customer payload"))
            assert.ok(!error.message.includes("rejected these credentials"))
            return true
        })
        assert.deepEqual(f.actions.map(action => action.p_action), ["credentials", "credentials", "begin_connect", "fail"])
        const failure = f.actions.at(-1)!
        assert.ok(["credentials", "permissions"].includes(String(failure.p_error)))
        assert.equal(failure.p_private_token, undefined)
        assert.equal(failure.p_metrics, undefined)
    })
}

test("calendar discovery denial identifies its own scope without acquiring a save lease", async () => {
    const f = fixture("/calendars/", 403)
    await assert.rejects(f.manager.loadClientCalendars("workspace", "actor", input), /calendar list check \(HTTP 403\).*calendars.readonly/)
    assert.deepEqual(f.actions.map(action => action.p_action), ["credentials"])
})

test("successful verification preserves bounded requests and saves only after all checks", async () => {
    const f = fixture()
    await f.manager.saveClientConnection("workspace", "actor", input)
    assert.equal(f.requests.length, 10)
    assert.deepEqual(f.actions.map(action => action.p_action), ["credentials", "begin_connect", "finish"])
    assert.equal(f.actions.at(-1)?.p_calendar_id, input.calendarId)
    assert.equal(f.actions.at(-1)?.p_private_token, input.privateToken)
})
