import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import test from "node:test"
import ts from "typescript"
import { appointmentSummary, appointmentSummaryHost, appointmentSummaryToken, notificationVersion } from "../lib/client-portal/appointment-summary.ts"

function load(file: string, dependencies: Record<string, unknown>) {
    const path = resolve(file), localRequire = createRequire(path)
    const compiled = new Module(path) as Module & { _compile: (source: string, filename: string) => void }
    compiled.require = ((name: string) => name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiled.require
    compiled._compile(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, path)
    return compiled.exports
}
const capability = "a".repeat(64), portalToken = "b".repeat(64)
const snapshot = { id: "appointment-123456789", calendarId: "calendar-123456789", calendarName: "Consultations", title: "Synthetic appointment", contactName: "Synthetic contact", timezone: "UTC", startTime: "2026-10-26T12:00:00Z", status: "confirmed" }
const data = { snapshot, version: 3, workspaceName: "Synthetic agency", portalSessionToken: portalToken, privateToken: "must-not-reach-shell", sessionToken: "must-not-reach-summary" }
const requestHeaders = { host: "portal.example.test", "x-betelgeze-custom-client-portal-domain": "portal.example.test", "x-betelgeze-workspace-slug": "agency" }
function reader(value: unknown = data) {
    const calls: unknown[] = []
    const subject = load("lib/client-portal/appointment-summary-server.ts", {
        "server-only": {}, "next/headers": { headers: async () => new Headers(requestHeaders) },
        "./appointment-summary": { appointmentSummary, appointmentSummaryHost, appointmentSummaryToken },
        "@/lib/supabase/admin": { supabaseAdmin: { rpc: async (...args: unknown[]) => { calls.push(args); return { data: value, error: null } } } },
    })
    return { read: subject.loadAppointmentSummary, calls }
}
const Entry = () => null, Unavailable = () => null
function notificationPage(result: unknown) {
    const calls: unknown[] = []
    const subject = load("app/client-portal/appointment/[token]/page.tsx", {
        "@/components/client-portal/ClientPortalEntry": { ClientPortalEntry: Entry },
        "@/components/client-portal/ClientPortalAppointmentSummary": { ClientPortalAppointmentUnavailable: Unavailable },
        "@/lib/client-portal/appointment-summary-server": { loadAppointmentSummary: async (token: string) => { calls.push(token); return result } },
        "@/lib/client-portal/appointment-summary": { notificationVersion },
        "next/navigation": { redirect: () => { throw Error("Portal entry must not redirect") } },
    })
    return { ...subject, calls }
}

test("one capability read yields the validated existing session and exact identity with sanitized seed", async () => {
    const subject = reader({ ...data, portalSessionToken: portalToken.toUpperCase() })
    const result = await subject.read(capability.toUpperCase())
    assert.equal(result.status, "ready")
    assert.deepEqual(subject.calls, [["read_ghl_appointment_summary", { p_token: capability, p_workspace_slug: "agency", p_hostname: "portal.example.test" }]])
    assert.equal(result.portalSessionToken, portalToken)
    assert.equal(result.initialAppointment.id, snapshot.id)
    assert.equal(result.initialAppointment.calendarId, snapshot.calendarId)
    assert.equal(result.initialAppointment.summary, result.summary)
    assert.equal(result.summary.reference, snapshot.id.slice(-8))
    assert.equal(result.summary.portalSessionToken, undefined)
    assert.equal(result.summary.privateToken, undefined)
    assert.equal(result.summary.sessionToken, undefined)
})

test("notification entry fails closed for old RPCs, malformed session tokens, and unsafe identities", async () => {
    const variants = [
        { ...data, portalSessionToken: undefined }, { ...data, portalSessionToken: "" },
        { ...data, portalSessionToken: `${portalToken}/` }, { ...data, portalSessionToken: { token: portalToken } },
        { ...data, snapshot: { ...snapshot, calendarId: undefined } },
        { ...data, snapshot: { ...snapshot, id: "../../another-appointment" } },
        { ...data, snapshot: { ...snapshot, calendarId: "calendar?token=other" } },
        { ...data, snapshot: { ...snapshot, calendarId: "x".repeat(161) } },
    ]
    for (const value of variants) {
        const subject = reader(value), result = await subject.read(capability)
        const route = notificationPage(result)
        const rendered = await route.default({ params: Promise.resolve({ token: capability }), searchParams: Promise.resolve({}) })
        assert.equal(rendered.type, Unavailable)
        assert.equal(rendered.props.retryable, false)
        assert.equal(subject.calls.length, 1)
        assert.deepEqual(route.calls, [capability])
    }
})

test("notification route opens the shared entry with its retained seed and no redirect or detail request", async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("No extra HTTP request is allowed") })
    const ready = await reader().read(capability), subject = notificationPage(ready)
    const result = await subject.default({ params: Promise.resolve({ token: capability }), searchParams: Promise.resolve({ v: "2" }) })
    assert.equal(result.type, Entry)
    assert.equal(result.props.token, portalToken)
    assert.deepEqual(result.props.initialAppointment, { id: snapshot.id, calendarId: snapshot.calendarId, summary: ready.summary, notifiedVersion: 2 })
    assert.deepEqual(subject.calls, [capability])
    assert.equal(fetch.mock.callCount(), 0)
    assert.equal(subject.dynamic, "force-dynamic")
    assert.equal(subject.revalidate, 0)
    assert.equal(subject.metadata.referrer, "no-referrer")
    assert.deepEqual(subject.metadata.robots, { index: false, follow: false, noarchive: true })
    assert.doesNotMatch(JSON.stringify(subject.metadata), new RegExp(`${portalToken}|${capability}|Synthetic contact`))
})

test("unavailable and failed capability reads never enter the full portal", async () => {
    for (const status of ["unavailable", "error"]) {
        const result = await notificationPage({ status }).default({ params: Promise.resolve({ token: capability }), searchParams: Promise.resolve({}) })
        assert.equal(result.type, Unavailable)
        assert.equal(result.props.retryable, status === "error")
    }
})

test("ordinary portal page delegates to the same entry and preserves its metadata calls", async () => {
    const calls: unknown[] = [], branding = { displayName: "Agency" }, icons = { icon: "/synthetic-icon" }
    const subject = load("app/client-portal/session/[token]/page.tsx", {
        "@/components/client-portal/ClientPortalEntry": { ClientPortalEntry: Entry },
        "@/lib/client-branding/favicon": { clientFaviconIcons: async (...args: unknown[]) => { calls.push(["icons", ...args]); return icons } },
        "@/lib/client-branding/public-branding": {
            loadClientPagePublicBranding: async (...args: unknown[]) => { calls.push(["branding", ...args]); return branding },
            currentPublicPageUrl: async () => { calls.push(["url"]); return "https://portal.example.test/synthetic" },
            agencyBrandedMetadata: (...args: unknown[]) => { calls.push(["metadata", ...args]); return { title: "Agency Client Portal" } },
        },
    })
    const params = Promise.resolve({ token: portalToken })
    const page = await subject.default({ params })
    assert.equal(page.type, Entry)
    assert.deepEqual(page.props, { token: portalToken })
    assert.deepEqual(calls, [])
    assert.deepEqual(await subject.generateMetadata({ params }), { title: "Agency Client Portal", robots: { index: false, follow: false }, referrer: "no-referrer", icons })
    assert.deepEqual(calls, [["branding", "client-portal", portalToken], ["icons", "client-portal", portalToken], ["url"], ["metadata", branding, "client-portal", "https://portal.example.test/synthetic"]])
})

function sharedEntry(resolved: unknown) {
    const calls: unknown[] = [], Shell = () => null, Theme = () => null
    const subject = load("components/client-portal/ClientPortalEntry.tsx", {
        "server-only": {},
        "@/components/client-portal/ClientPortalShell": { ClientPortalShell: Shell },
        "@/components/onboarding/OnboardingThemeProvider": { OnboardingThemeProvider: Theme },
        "@/lib/client-portal/session": { loadClientPortalSessionByToken: async (token: string) => { calls.push(["session", token]); return resolved } },
        "@/lib/client-branding/public-branding": { loadWorkspacePublicBranding: async (...args: unknown[]) => { calls.push(["branding", ...args]); return { displayName: "Agency", privacyPolicyUrl: "/privacy", termsOfServiceUrl: "/terms" } } },
        "@/lib/client-branding/assets": {
            loadWorkspaceClientBrandAssets: async (...args: unknown[]) => { calls.push(["assets", ...args]); return { logoPath: "synthetic-logo" } },
            clientBrandLogoUrl: (...args: unknown[]) => { calls.push(["logo", ...args]); return "/synthetic-logo" },
        },
    })
    return { render: subject.ClientPortalEntry, calls, Shell, Theme }
}

test("shared entry keeps one existing session bootstrap and the existing branding sequence", async () => {
    const resolved = { workspace: { id: "workspace", name: "Workspace" }, relationship: { primary_person_name: "Client" }, theme: { pageBackground: "#ffffff" }, overview: { leadMode: "ghl" }, metaAdsReporting: { accountId: "synthetic" }, hasGoogleAds: true }
    const initialAppointment = (await reader().read(capability)).initialAppointment
    const subject = sharedEntry(resolved), result = await subject.render({ token: portalToken, initialAppointment })
    assert.equal(result.type, subject.Theme)
    assert.equal(result.props.theme, resolved.theme)
    assert.equal(result.props.children.type, subject.Shell)
    assert.equal(result.props.children.props.initialAppointment, initialAppointment)
    assert.equal(result.props.children.props.token, portalToken)
    assert.equal(result.props.children.props.overview, resolved.overview)
    assert.equal(result.props.children.props.metaAdsReporting, resolved.metaAdsReporting)
    assert.equal(result.props.children.props.hasGoogleAds, true)
    assert.deepEqual(subject.calls, [["session", portalToken], ["branding", "workspace", "Workspace"], ["assets", "workspace"], ["logo", "client-portal", portalToken, "synthetic-logo"]])
})

test("session revocation between summary and bootstrap prevents the shell and further reads", async () => {
    const subject = sharedEntry(null)
    const result = await subject.render({ token: portalToken, initialAppointment: (await reader().read(capability)).initialAppointment })
    assert.equal(result.type, "main")
    assert.equal(result.props["data-betelgeze-client-portal-session"], "invalid")
    assert.deepEqual(subject.calls, [["session", portalToken]])
})
