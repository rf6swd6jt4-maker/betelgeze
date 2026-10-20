import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import test from "node:test"
import ts from "typescript"
import { appointmentSummary, appointmentSummaryHost, appointmentSummaryToken, summaryDateTime, summaryStatus } from "../lib/client-portal/appointment-summary.ts"

function load(path: string, dependencies: Record<string, unknown> = {}) {
    const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const localRequire = createRequire(resolve(path))
    const compiled = new Module(resolve(path)) as Module & { _compile: (source: string, filename: string) => void }
    compiled.require = ((name: string) => name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiled.require
    compiled._compile(source, path)
    return compiled.exports
}

const token = "a".repeat(64)
const snapshot = {
    id: "ghl-appointment-12345678", calendarName: "Consultations", contactName: "Alex Morgan", title: "Window consultation",
    startTime: "2026-10-14T18:30:00Z", endTime: "2026-10-14T19:00:00Z", timezone: "America/New_York", status: "confirmed",
    contactDetails: "+1 202 555 0123; alex@example.com", meetingDetails: "Phone consultation", bookingDetails: "Six windows", observedAt: "2026-10-11T09:00:00Z", deleted: false,
    internalNotes: "must not escape", sessionToken: "must not escape",
}
const result = { snapshot, version: 2, observedAt: "2026-10-11T09:00:00Z", removedAt: null, workspaceName: "Agency", agencyDisplayName: "Example Agency", workspaceId: "workspace" }
const validHeaders = { "host": "portal.example.com", "x-betelgeze-custom-client-portal-domain": "portal.example.com", "x-betelgeze-workspace-slug": "agency" }

function reader(requestHeaders: Record<string, string> = validHeaders, response: unknown = { data: result, error: null }) {
    const calls: unknown[] = []
    const reader = load("lib/client-portal/appointment-summary-server.ts", {
        "server-only": {},
        "next/headers": { headers: async () => new Headers(requestHeaders) },
        "./appointment-summary": { appointmentSummary, appointmentSummaryHost, appointmentSummaryToken },
        "@/lib/supabase/admin": { supabaseAdmin: { rpc: async (...args: unknown[]) => { calls.push(args); if (response instanceof Error) throw response; return response } } },
    })
    return { read: reader.loadAppointmentSummary, calls }
}

test("summary capabilities require exact 256-bit hex and a DNS host", () => {
    assert.equal(appointmentSummaryToken(token.toUpperCase()), token)
    for (const invalid of ["", token.slice(1), `${token}a`, ` ${token}`, `${token}/`, null, "x".repeat(64)]) assert.equal(appointmentSummaryToken(invalid), null)
    assert.equal(appointmentSummaryHost("PORTAL.EXAMPLE.COM"), "portal.example.com")
    for (const invalid of ["https://portal.example.com", "portal.example.com:3000", "portal.example.com,evil.test", "portal.example.com/", "portal.example.com@evil.test", null]) assert.equal(appointmentSummaryHost(invalid), null)
})

test("malformed, unscoped, and cross-domain requests are denied before any read", async () => {
    const invalid = reader()
    assert.equal((await invalid.read("bad")).status, "unavailable")
    assert.deepEqual(invalid.calls, [])
    for (const headers of [{}, { ...validHeaders, host: "other.example.com" }, { ...validHeaders, "x-betelgeze-workspace-slug": "" }, { ...validHeaders, "x-betelgeze-custom-client-portal-domain": "" }]) {
        const subject = reader(headers)
        assert.equal((await subject.read(token)).status, "unavailable")
        assert.deepEqual(subject.calls, [])
    }
})

test("one capability read passes current tenant and host and exposes only safe summary fields", async () => {
    const subject = reader()
    const loaded = await subject.read(token.toUpperCase())
    assert.deepEqual(subject.calls, [["read_ghl_appointment_summary", { p_token: token, p_workspace_slug: "agency", p_hostname: "portal.example.com" }]])
    assert.equal(loaded.status, "ready")
    assert.equal(loaded.displayName, "Example Agency")
    assert.equal(loaded.summary.reference, "12345678")
    assert.equal(loaded.summary.internalNotes, undefined)
    assert.equal(loaded.summary.sessionToken, undefined)
    assert.equal(loaded.workspaceId, undefined)
    assert.match(summaryDateTime(loaded.summary.startTime, loaded.summary.timezone), /Oct 14, 2026, 2:30 PM EDT/)
})

test("revocation, token reissue, and tenant denial remain unavailable; infrastructure errors are retryable", async () => {
    assert.equal((await reader(validHeaders, { data: null, error: null }).read(token)).status, "unavailable")
    assert.equal((await reader(validHeaders, { data: null, error: { message: "private diagnostic" } }).read(token)).status, "error")
    assert.deepEqual(await reader(validHeaders, new Error("network unavailable")).read(token), { status: "error" })
})

test("cancelled and removed summaries retain their appointment details and distinguish the lifecycle", () => {
    const cancelled = appointmentSummary({ ...result, snapshot: { ...snapshot, status: "cancelled" } })!
    const removed = appointmentSummary({ ...result, snapshot: { ...snapshot, deleted: true }, removedAt: "2026-10-12T09:00:00Z" })!
    assert.equal(summaryStatus(cancelled).label, "Cancelled")
    assert.equal(summaryStatus(removed).label, "Removed from calendar")
    for (const summary of [cancelled, removed]) {
        assert.equal(summary.contactName, "Alex Morgan")
        assert.equal(summary.bookingDetails, "Six windows")
        assert.equal(summary.startTime, "2026-10-14T18:30:00.000Z")
        assert.match(summaryStatus(summary).explanation ?? "", /retained/)
    }
})

test("latest rescheduled snapshot replaces time and reports missing timezone honestly", () => {
    const updated = appointmentSummary({ ...result, snapshot: { ...snapshot, startTime: "2026-10-15T18:30:00Z", timezone: "invalid" } })!
    assert.equal(updated.startTime, "2026-10-15T18:30:00.000Z")
    assert.equal(updated.timezone, "UTC")
    assert.equal(updated.timezoneKnown, false)
    assert.equal(appointmentSummary({}), null)
    assert.equal(appointmentSummary({ snapshot: { title: "Missing identity" } }), null)
})

test("Proxy routes capabilities only on the verified client portal domain and replaces spoofed scope", async (t) => {
    const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, priorKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-key"
    t.after(() => {
        if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl
        if (priorKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = priorKey
    })
    let domain = { workspace_slug: "agency", domain_status: "verified", surface: "client_portal" }
    t.mock.method(globalThis, "fetch", async () => Response.json([domain]))
    const mod = load("proxy.ts", {
        "@supabase/ssr": { createServerClient: () => { throw Error("Custom portal must not refresh staff authentication") } },
        "@/lib/supabase/legacy-cookies": {},
        "@/lib/supabase/session-cookies": { carrySessionResponse: (_session: unknown, response: unknown) => response },
        "@/lib/auth/origin": { authHostname: () => "auth.betelgeze.com", authOrigin: () => "https://auth.betelgeze.com" },
        "@/lib/workspace-tabs": {}, "@/lib/workspace-shell": {}, "@/lib/workspace-launch": {},
    })
    function request(path: string) {
        const url = new URL(`https://portal.example.com${path}`)
        const nextUrl = Object.assign(url, { clone: () => new URL(url) })
        return { nextUrl, headers: new Headers({ host: "portal.example.com", "x-betelgeze-workspace-slug": "other-tenant", "x-betelgeze-custom-client-portal-domain": "other.example.com" }) }
    }
    const accepted = await mod.proxy(request(`/appointment/${token}`))
    assert.equal(accepted.headers.get("x-middleware-rewrite"), `https://portal.example.com/client-portal/appointment/${token}`)
    assert.equal(accepted.headers.get("x-middleware-request-x-betelgeze-workspace-slug"), "agency")
    assert.equal(accepted.headers.get("x-middleware-request-x-betelgeze-custom-client-portal-domain"), "portal.example.com")
    assert.equal(accepted.headers.get("cache-control"), "private, no-store")
    assert.equal(accepted.headers.get("referrer-policy"), "no-referrer")
    for (const invalid of [`/appointment/${token.slice(1)}`, `/client-portal/appointment/${token}`]) assert.equal((await mod.proxy(request(invalid))).status, 404)
    domain = { ...domain, domain_status: "pending" }
    assert.equal((await mod.proxy(request(`/appointment/${token}?__betelgeze_client_portal_domain_probe=1`))).status, 404)
    domain = { ...domain, domain_status: "verified", surface: "onboarding" }
    assert.equal((await mod.proxy(request(`/appointment/${token}`))).status, 404)
})
