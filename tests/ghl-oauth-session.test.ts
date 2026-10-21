import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import ts from "typescript"

const require = createRequire(import.meta.url)
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
class ProviderError extends Error {
    code: string
    uncertain: boolean
    status?: number
    constructor(code: string, uncertain = false, status?: number) {
        super("synthetic-private-provider-body")
        this.code = code; this.uncertain = uncertain; this.status = status
    }
}
function fixture() {
    Object.assign(process.env, { GHL_OAUTH_ENABLED: "true", GHL_OAUTH_CLIENT_ID: "synthetic-client", GHL_OAUTH_CLIENT_SECRET: "synthetic-client-secret", GHL_OAUTH_APP_ID: "synthetic-app", GHL_OAUTH_INSTALL_URL: "https://marketplace.gohighlevel.com/oauth/chooselocation" })
    const calls: Array<{ action: string; input: Record<string, unknown> }> = []
    const jar = new Map<string, string>(), cookieOptions: Record<string, unknown>[] = []
    let activeUser = id(2), exchanges = 0, phase = "authorizing", readFailure: string | null = null
    const attempt: Record<string, unknown> = { workspace_id: id(1), workspace_slug: "fixture", relationship_id: id(3), user_id: id(2), choices: [{ id: "location123456789", name: "Fixture" }], limited: false, credential_encrypted: null }
    const token = { accessToken: "synthetic-access-token", refreshToken: "synthetic-refresh-token", expiresAt: new Date(Date.now() + 86400000).toISOString(), userType: "Location", locationId: "location123456789", companyId: "company123456789", scope: "fixture" }
    let exchange: () => Promise<typeof token> = async () => token
    let list: () => Promise<{ locations: unknown; limited: boolean }> = async () => ({ locations: attempt.choices, limited: false })
    let locationGrant: () => Promise<typeof token> = async () => token
    let locationExchanges = 0, providerReads = 0
    let selectionReply: Record<string, unknown> = { locationId: token.locationId, privateToken: token.accessToken, revision: id(4), calendars: [{id:"calendar123456789",name:"Calendar"}] }
    const calendarReads: string[] = []
    const calendars = [{id:"calendar123456789",name:"Calendar"},{id:"secondcalendar123",name:"Draft estimates",isActive:false}]
    const diagnostics: unknown[][] = []
    const mocks: Record<string, unknown> = {
        "server-only": {},
        "next/headers": { cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name: string, value: string, options: Record<string, unknown>) => { jar.set(name, value); cookieOptions.push(options) } }) },
        "@/lib/workspace-access": { requireWorkspacePanel: async () => ({ workspace: { id: id(1), slug: "fixture" }, user: { id: activeUser } }) },
        "@/lib/workspace-integrations": { encryptIntegrationCredential: JSON.stringify, decryptWorkspaceIntegration: JSON.parse },
        "@/lib/client-portal/ghl-calendar-list-provider": { fetchGhlCalendars: async () => {providerReads++;return calendars} },
        "@/lib/client-portal/ghl-calendar-provider": { fetchGhlCalendar: async (_c:unknown,_m:unknown,b:{calendarId:string}) => {calendarReads.push(b.calendarId);return {}} },
        "@/lib/client-portal/ghl-provider": { fetchGhlMetrics: async () => ({ companyId: token.companyId, locationName: "Fixture", metrics: {} }) },
        "./provider": {
            GhlOAuthError: ProviderError,
            GHL_OAUTH_CALLBACK: "https://app.betelgeze.com/api/integrations/calendar/callback",
            ghlAuthorizationUrl: (_config: unknown, state: string) => `https://marketplace.gohighlevel.com/oauth/chooselocation?state=${state}`,
            exchangeGhlCode: async () => { exchanges++; return exchange() },
            listGhlInstalledLocations: async () => list(),
            ghlLocationToken: async () => { locationExchanges++; return locationGrant() },
        },
        "@/lib/supabase/admin": { supabaseAdmin: { rpc: async (name: string, params: { p_action: string; p_input: Record<string, unknown> }) => {
            const { p_action: action, p_input: input } = params; calls.push({ action: `${name}:${action}`, input })
            if (name === "ghl_calendar_selection") return {data:action === "read" ? selectionReply : {connected:true,revision:id(5),calendars:input.calendars}}
            if (name === "ghl_appointment_setup") return { data: { failure: "portal" } }
            if (action === "prepare") return { data: { accepted: true } }
            if (action === "read") return { data: readFailure ? { failure: readFailure } : { ...attempt, phase } }
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
    new Function("require", "module", "exports", "console", code)((path: string) => path in mocks ? mocks[path] : require(path), compiled, compiled.exports, { error: (...values: unknown[]) => diagnostics.push(values) })
    const api = compiled.exports as typeof import("../lib/ghl-oauth/server")
    return { api, calls, jar, calendarReads, providerReads:()=>providerReads, selectionReply:(value:Record<string,unknown>)=>{selectionReply=value}, cookieOptions, diagnostics, readFailure: (value: string) => { readFailure = value }, exchanges: () => exchanges, phase: () => phase, user: (value: string) => { activeUser = value }, exchange: (value: typeof exchange) => { exchange = value }, list: (value: typeof list) => { list = value }, locationGrant: (value: typeof locationGrant) => { locationGrant = value }, locationExchanges: () => locationExchanges, token }
}
async function start(f: ReturnType<typeof fixture>) {
    const result = await f.api.startGhlConnection("fixture", { relationshipId: id(3), expectedRevision: null })
    assert.ok(result.authorizationUrl)
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
test("an installed-account read failure identifies its stage without consuming the grant or exposing provider data", async () => {
    const f = fixture(), state = await start(f)
    await f.api.completeGhlAuthorization(state, "code", false)
    f.list(async () => { throw new ProviderError("provider", false, 403) })
    await assert.rejects(f.api.selectGhlLocation("fixture", "location123456789"), (error: unknown) => {
        assert.ok(error instanceof f.api.GhlConnectionError)
        assert.match(error.message, /installed_accounts\/provider\/403/)
        assert.equal(error.message.includes("synthetic-private"), false)
        return true
    })
    assert.equal(f.phase(), "ready")
    assert.equal(f.locationExchanges(), 0)
    assert.deepEqual(f.diagnostics, [["ghl_connection_step_failed", { step: "installed_accounts", code: "provider", status: 403 }]])
})
test("a location-grant failure requires new authorization and logs no provider body", async () => {
    const f = fixture(), state = await start(f)
    await f.api.completeGhlAuthorization(state, "code", false)
    f.locationGrant(async () => { throw new ProviderError("response", true) })
    await assert.rejects(f.api.selectGhlLocation("fixture", "location123456789"), /location_token\/response/)
    assert.equal(f.phase(), "failed")
    assert.equal(f.locationExchanges(), 1)
    assert.deepEqual(f.diagnostics, [["ghl_connection_step_failed", { step: "location_token", code: "response" }]])
})

test("reopening unfinished setup resumes the same browser-bound grant without new authorization", async () => {
    const f = fixture(), state = await start(f)
    await f.api.completeGhlAuthorization(state, "code", false)
    const originalCookie = [...f.jar.values()]
    for (const phase of ["ready", "selected"]) {
        if (phase === "selected") await f.api.selectGhlLocation("fixture", "location123456789")
        const before = f.calls.filter(call => call.action.endsWith(":prepare")).length
        assert.deepEqual(await f.api.startGhlConnection("fixture", { relationshipId: id(3), expectedRevision: null }), { resume: true })
        assert.equal(f.calls.filter(call => call.action.endsWith(":prepare")).length, before)
        assert.deepEqual([...f.jar.values()], originalCookie)
    }
    assert.equal(f.exchanges(), 1)
})
test("resume never returns a grant belonging to another client or signed-in user", async () => {
    for (const change of ["client", "user"]) {
        const f = fixture(), state = await start(f)
        await f.api.completeGhlAuthorization(state, "code", false)
        if (change === "user") f.user(id(99))
        const result = await f.api.startGhlConnection("fixture", { relationshipId: change === "client" ? id(99) : id(3), expectedRevision: null })
        assert.ok(result.authorizationUrl)
        assert.equal(result.resume, undefined)
        assert.equal(f.exchanges(), 1)
    }
})

test("a read outage preserves the unfinished grant while an expired attempt may start afresh", async () => {
    for (const failure of ["unavailable", "expired"]) {
        const f = fixture(), state = await start(f)
        await f.api.completeGhlAuthorization(state, "code", false)
        f.readFailure(failure)
        const pending = f.api.startGhlConnection("fixture", { relationshipId: id(3), expectedRevision: null })
        if (failure === "expired") assert.ok((await pending).authorizationUrl)
        else await assert.rejects(pending)
        assert.equal(f.calls.filter(call => call.action.endsWith(":prepare")).length, failure === "expired" ? 2 : 1)
    }
})

test('OAuth saves all selected calendars after independently verifying their read access',async()=>{
 const f=fixture(), state=await start(f)
 await f.api.completeGhlAuthorization(state,'code',false);await f.api.selectGhlLocation('fixture','location123456789')
 await f.api.finishGhlConnection('fixture',['calendar123456789','secondcalendar123'])
 assert.deepEqual(f.calendarReads,['calendar123456789','secondcalendar123'])
 const saved=f.calls.find(c=>c.action==='ghl_oauth_connection:connect')!.input
 assert.equal((saved.calendars as unknown[]).length,2);assert.equal(saved.calendarId,'calendar123456789')
})
test('saved connections edit calendars without OAuth, and a lost save reply recovers without provider work',async()=>{
 const f=fixture(),input={action:'save_calendars',relationshipId:id(3),expectedRevision:id(4),requestId:id(9),calendarIds:['calendar123456789','secondcalendar123']}
 const result=await f.api.manageGhlCalendars('fixture',input)
 assert.equal(result.connected,true);assert.equal(result.revision,id(5));assert.equal(f.exchanges(),0);assert.deepEqual(f.calendarReads,input.calendarIds)
 assert.equal(f.calls.some(c=>c.action.startsWith('ghl_oauth_connection:')),false)
 f.selectionReply({connected:true,revision:id(5),calendars:result.calendars})
 const reads=f.providerReads(),verified=f.calendarReads.length,saves=f.calls.filter(c=>c.action==='ghl_calendar_selection:save').length
 const recovered=await f.api.manageGhlCalendars('fixture',input)
 assert.equal(recovered.revision,id(5));assert.equal(f.providerReads(),reads);assert.equal(f.calendarReads.length,verified);assert.equal(f.calls.filter(c=>c.action==='ghl_calendar_selection:save').length,saves)
})
test('selection rejects duplicate, empty, excessive, unavailable and malformed IDs without saving',async()=>{
 for(const calendarIds of [[],['calendar123456789','calendar123456789'],Array.from({length:11},(_,i)=>'calendar12345678'+i),['invalid calendar'],['missingcalendar123']]){
  const f=fixture();await assert.rejects(f.api.manageGhlCalendars('fixture',{action:'save_calendars',relationshipId:id(3),expectedRevision:id(4),requestId:id(9),calendarIds}))
  assert.equal(f.calls.some(c=>c.action==='ghl_calendar_selection:save'),false);assert.equal(f.calendarReads.length,0)
 }
})
