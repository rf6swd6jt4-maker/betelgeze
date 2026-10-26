import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"
import { appointmentSummaryHost } from "../lib/client-portal/appointment-summary.ts"

function load(file: string, dependencies: Record<string, unknown>) {
    const path = resolve(file), localRequire = createRequire(path)
    const compiled = new Module(path) as Module & { _compile: (source: string, filename: string) => void }
    compiled.require = ((name: string) => name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiled.require
    compiled._compile(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, path)
    return compiled.exports
}
const token = "a".repeat(64)
const validHeaders = { host: "portal.example.test", "x-betelgeze-custom-client-portal-domain": "portal.example.test", "x-betelgeze-workspace-slug": "Agency" }

test("notification fallback uses the same loading screen with only a verified public branding target", async () => {
    const Screen = () => null
    for (const [requestHeaders, expected] of [[validHeaders, "Agency"], [{ ...validHeaders, host: "other.example.test" }, null], [{ ...validHeaders, "x-betelgeze-custom-client-portal-domain": "" }, null], [{}, null]] as const) {
        const subject = load("app/client-portal/appointment/[token]/loading.tsx", {
            "next/headers": { headers: async () => new Headers(requestHeaders) },
            "@/components/client-portal/ClientPortalStartupScreen": { ClientPortalStartupScreen: Screen },
            "@/lib/client-portal/appointment-summary": { appointmentSummaryHost },
        })
        const result = await subject.default()
        assert.equal(result.type, Screen)
        assert.deepEqual(result.props, { publicWorkspaceSlug: expected })
        assert.doesNotMatch(JSON.stringify(result.props), new RegExp(token))
    }
})

test("appointment startup never treats the capability as a session token or makes a session appearance request", (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("Appointment startup cannot call a session endpoint") })
    for (const path of [`/appointment/${token}`, `/client-portal/appointment/${token}`, "/appointment/malformed"]) {
        const subject = load("components/client-portal/ClientPortalStartupScreen.tsx", {
            "next/navigation": { usePathname: () => path },
            react: { useEffect: (effect: () => unknown) => effect(), useState: (value: unknown) => [value, () => undefined] },
        })
        const html = renderToStaticMarkup(subject.ClientPortalStartupScreen({ publicWorkspaceSlug: "Agency" }))
        assert.match(html, /data-client-portal-startup-screen/u)
        assert.match(html, /aria-label="Loading client portal"/u)
        assert.match(html, /background-color:#F8F7F3/u)
        assert.match(html, /\/api\/client-branding\/logo\/sms-opt-in\/agency/u)
        assert.doesNotMatch(html, new RegExp(`${token}|/session/|Loading appointment summary|Betelgeze`))
    }
    assert.equal(fetch.mock.callCount(), 0)
})

test("unverified or malformed public branding falls back without constructing an arbitrary logo URL", () => {
    const subject = load("components/client-portal/ClientPortalStartupScreen.tsx", {
        "next/navigation": { usePathname: () => `/appointment/${token}` },
        react: { useEffect: () => undefined, useState: (value: unknown) => [value, () => undefined] },
    })
    for (const publicWorkspaceSlug of [undefined, null, "", "../other", "agency?token=private", "https://other.test", "x".repeat(51)]) {
        const html = renderToStaticMarkup(subject.ClientPortalStartupScreen({ publicWorkspaceSlug }))
        assert.doesNotMatch(html, /<img|<link|\/api\//u)
        assert.match(html, /data-client-portal-startup-screen/u)
    }
})
