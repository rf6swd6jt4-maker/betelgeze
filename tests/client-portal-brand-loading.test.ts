import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import test from "node:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

const rootLayout = readFileSync("app/layout.tsx", "utf8")
const globalStyles = readFileSync("app/globals.css", "utf8")
const loading = readFileSync("app/client-portal/session/[token]/loading.tsx", "utf8")
const startup = readFileSync("components/client-portal/ClientPortalStartupScreen.tsx", "utf8")
const appearanceRoute = readFileSync("app/api/client-portal/session/[token]/appearance/route.ts", "utf8")
const portalSession = readFileSync("lib/client-portal/session.ts", "utf8")
const configuration = readFileSync("lib/onboarding/configuration.ts", "utf8")

test("client portal opening replaces the BE startup canvas with agency branding", () => {
    assert.match(rootLayout, /dataset\.clientPortalStartup = "true"/u)
    assert.match(globalStyles, /data-client-portal-startup/u)
    assert.match(loading, /<ClientPortalStartupScreen/u)
    assert.match(startup, /data-client-portal-startup-screen/u)
    assert.match(startup, /backgroundColor: appearance\.backgroundColor/u)
    assert.match(startup, /api\/client-branding\/logo\/client-portal/u)
    assert.match(startup, /src=\{appearance\.logoSrc \?\? immediateLogoSrc/u)
    assert.doesNotMatch(startup, /Betelgeze|diamond|data-loading-overlay/u)
})

test("the first portal fallback starts the agency logo request before hydration", () => {
    const path = resolve("components/client-portal/ClientPortalStartupScreen.tsx")
    const localRequire = createRequire(path)
    const dependencies: Record<string, unknown> = {
        "next/navigation": { usePathname: () => `/client-portal/session/${"a".repeat(64)}` },
    }
    const compiled = new Module(path) as Module & { _compile: (source: string, filename: string) => void }
    compiled.require = ((name: string) => name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiled.require
    compiled._compile(ts.transpileModule(startup, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, path)
    const html = renderToStaticMarkup(React.createElement(compiled.exports.ClientPortalStartupScreen))
    assert.match(html, /background-color:#F8F7F3/u)
    assert.match(html, new RegExp(`/api/client-branding/logo/client-portal/${"a".repeat(64)}`, "u"))
    assert.match(html, /max-h-14/u)
    assert.doesNotMatch(html, /data-loading-overlay|svg/u)
})

test("portal startup appearance is token scoped and does not expand the page bootstrap", () => {
    assert.match(appearanceRoute, /loadClientPortalStartupAppearance\(token\)/u)
    assert.match(appearanceRoute, /private, no-store/u)
    assert.match(portalSession, /session\.status !== "active"/u)
    assert.match(portalSession, /session\.token_revoked_at/u)
    assert.match(portalSession, /assets\.workspaceStatus !== "active"/u)
    assert.match(portalSession, /resolveOnboardingTheme\(theme\)\.pageBackground/u)
    assert.match(portalSession, /clientBrandLogoUrl\("client-portal", token/u)
    assert.match(portalSession, /loadPublishedOnboardingTheme/u)
    assert.doesNotMatch(portalSession, /loadPublishedOnboardingConfiguration/u)
    assert.match(configuration, /export async function loadPublishedOnboardingTheme/u)
})
