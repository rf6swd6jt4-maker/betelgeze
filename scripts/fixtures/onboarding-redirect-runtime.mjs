import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import ts from "typescript"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const require = createRequire(resolve(root, "package.json"))
const { NextRequest } = require("next/server")
const navigation = require("next/navigation")
const { getURLFromRedirectError } = require("next/dist/client/components/redirect")
const { isRedirectError } = require("next/dist/client/components/redirect-error")
const workspaceId = "10000000-0000-4000-8000-000000000010"
const userId = "10000000-0000-4000-8000-000000000011"
export const ONBOARDING_FIXTURE_SESSION_ID = "10000000-0000-4000-8000-000000000030"
const environment = {
    NODE_ENV: "test",
    NEXT_PUBLIC_SITE_URL: "https://app.betelgeze.com",
    NEXT_PUBLIC_AUTH_URL: "https://auth.betelgeze.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-only",
}

// A loopback browser fixture exercises the real app-host routing policy. Only
// its origin is mapped; the request pathname and query are never reconstructed.
function appRequestUrl(value) {
    const url = new URL(value, "https://app.betelgeze.com")
    url.protocol = "https:"
    url.host = "app.betelgeze.com"
    return url
}

function sourceRuntime(overrides = {}) {
    const modules = new Map()
    function load(file) {
        const path = resolve(root, file)
        if (modules.has(path)) return modules.get(path).exports
        const compiledModule = { exports: {} }
        modules.set(path, compiledModule)
        const code = ts.transpileModule(readFileSync(path, "utf8"), {
            fileName: path,
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
        }).outputText
        runInNewContext(code, {
            module: compiledModule, exports: compiledModule.exports,
            require(name) {
                if (Object.hasOwn(overrides, name)) return overrides[name]
                if (name.startsWith("@/")) return load(`${name.slice(2)}.ts`)
                return require(name)
            },
            URL, Headers, Request, Response, performance, console,
            process: { env: environment },
        }, { filename: path })
        return compiledModule.exports
    }
    return load
}

/** Execute proxy.ts with actual Next request/response and local routing helpers. */
export async function resolveProxy(requestUrl, { authenticated = true } = {}) {
    const url = appRequestUrl(requestUrl)
    const load = sourceRuntime({
        "@supabase/ssr": { createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: authenticated ? { sub: userId, aal: "aal2" } : null } }) } }) },
    })
    const request = new NextRequest(url, { headers: { host: url.host } })
    const response = await load("proxy.ts").proxy(request)
    const rewrite = response.headers.get("x-middleware-rewrite")
    const location = response.headers.get("location")
    const destination = new URL(rewrite ?? location ?? url.href)
    const requestHeaders = new Headers()
    for (const [name, value] of response.headers) {
        if (name.startsWith("x-middleware-request-")) requestHeaders.set(name.slice("x-middleware-request-".length), value)
    }
    return { pathname: destination.pathname, search: destination.search, rewrite, location, status: response.status, requestHeaders }
}

// The complete page module executes, but React leaves are not rendered by this
// routing fixture. Any unexpected access to deferred detail dependencies fails
// instead of silently broadening this fixture into a fake detail implementation.
function deferredModule(name) {
    return new Proxy({ __esModule: true }, { get(target, property) {
        if (property === "__esModule") return true
        throw new Error(`Unexpected deferred dependency ${name}.${String(property)}`)
    } })
}

/** Execute OnboardingDetailPage and capture Next's actual redirect exception. */
export async function resolveOnboardingRedirect(requestUrl, { sessionCount = 1, hasMore = false, relationshipAllowed = true, relationshipExists = true, sessionError = false } = {}) {
    const url = appRequestUrl(requestUrl)
    const [, workspaceSlug, section, relationshipId] = url.pathname.split("/")
    if (section !== "onboarding" || !relationshipId) throw new Error("Expected a relationship onboarding route")
    const incoming = await resolveProxy(url)
    const reads = []
    const relationship = { id: relationshipId, primary_person_name: "Fixture relationship", business_name: "Fixture business", source_metadata: {}, updated_at: "2026-10-01T00:00:00.000Z" }
    const db = {
        async rpc(name, args) {
            reads.push({ name, args })
            if (name !== "read_onboarding_panel_sessions") throw new Error(`Unexpected RPC ${name}`)
            const sessions = Array.from({ length: sessionCount }, (_, index) => ({ id: index ? `10000000-0000-4000-8000-${String(30 + index).padStart(12, "0")}` : ONBOARDING_FIXTURE_SESSION_ID, relationship_id: relationshipId, status: "active" }))
            return { data: { sessions, access: { moduleIds: [], fullSessionIds: [], sessionIds: sessions.map(session => session.id), serviceNamesBySession: {} }, hasMore }, error: sessionError ? { message: "Fixture database unavailable" } : null }
        },
        from() { throw new Error("Redirect/chooser must not begin detail reads") },
    }
    const overrides = {
        "next/navigation": navigation,
        "next/headers": { headers: async () => incoming.requestHeaders },
        "@/lib/supabase/admin": { supabaseAdmin: db },
        "@/lib/workspace-access": {
            requireWorkspacePanel: async (slug, panel) => {
                if (slug !== workspaceSlug || panel !== "onboarding") throw new Error("Unexpected panel authorization")
                return { workspace: { id: workspaceId, slug }, user: { id: userId }, role: "staff", access: { allowedServiceIds: [] } }
            },
            accessibleRelationshipIds: async () => new Set(relationshipAllowed ? [relationshipId] : []),
            fullyAccessibleRelationshipIds: async () => new Set(),
        },
        "@/lib/relationships": { getRelationship: async (id, requestedId) => {
            if (id !== workspaceId || requestedId !== relationshipId) throw new Error("Unexpected relationship query")
            return relationshipExists ? relationship : null
        } },
        "@/components/onboarding/OnboardingSessionChooser": { OnboardingSessionChooser: "onboarding-session-chooser" },
        "@/components/workspace/WorkspaceTopBar": { WorkspaceTopBar: "workspace-topbar" },
    }
    const pageFile = "app/[workspaceSlug]/onboarding/[relationshipId]/page.tsx"
    const ast = ts.createSourceFile(pageFile, readFileSync(resolve(root, pageFile), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const actualModules = new Set(["@/lib/workspace-tabs", "@/lib/onboarding/session-access"])
    for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement)) continue
        const name = statement.moduleSpecifier.text
        if (!Object.hasOwn(overrides, name) && !actualModules.has(name) && (name.startsWith("@/") || name.startsWith("."))) overrides[name] = deferredModule(name)
    }
    const page = sourceRuntime(overrides)(pageFile).default
    try {
        const rendered = await page({ params: Promise.resolve({ workspaceSlug, relationshipId }), searchParams: Promise.resolve(Object.fromEntries(url.searchParams)) })
        return { location: undefined, rendered, reads }
    } catch (error) {
        if (isRedirectError(error)) return { location: getURLFromRedirectError(error), reads }
        throw error
    }
}
