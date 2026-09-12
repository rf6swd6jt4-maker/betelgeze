import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import test from "node:test"
import ts from "typescript"

// Exercise the server boundary: only a real relationship TEST boolean can
// enable the preview, irrespective of URL parameters supplied by a visitor.
test("portal navigation preview fails closed for non-test relationships", async () => {
    const path = resolve("app/client-portal/session/[token]/page.tsx")
    const localRequire = createRequire(path)
    let isTest: unknown
    const Shell = () => null
    const dependencies: Record<string, unknown> = {
        "@/components/client-portal/ClientPortalShell": { ClientPortalShell: Shell },
        "@/components/onboarding/OnboardingThemeProvider": { OnboardingThemeProvider: () => null },
        "@/lib/client-portal/session": { loadClientPortalSessionByToken: async () => ({ workspace: { id: "w", name: "Agency" }, relationship: { primary_person_name: "Client", is_test: isTest }, theme: {} }) },
        "@/lib/client-branding/favicon": {},
        "@/lib/client-branding/public-branding": { loadWorkspacePublicBranding: async () => ({ displayName: "Agency" }) },
        "@/lib/client-branding/assets": { loadWorkspaceClientBrandAssets: async () => ({}), clientBrandLogoUrl: () => null },
    }
    const compiled = new Module(path) as Module & { _compile: (source: string, filename: string) => void }
    compiled.require = ((name: string) => name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiled.require
    compiled._compile(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, path)
    for (const value of [undefined, null, false, "true", "false", 1, {}, true]) {
        isTest = value
        const result = await compiled.exports.default({ params: Promise.resolve({ token: "a".repeat(64) }), searchParams: Promise.resolve({ testNavigation: "true" }) })
        assert.equal(result.props.children.type, Shell)
        assert.equal(result.props.children.props.testNavigation, value === true)
    }
})
