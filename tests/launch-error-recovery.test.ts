import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import ts from "typescript"
import * as tabContract from "../lib/workspace-tabs.ts"
import { WORKSPACE_FRAME_ERROR_ATTRIBUTE } from "../lib/workspace-tab-departure.ts"

const require = createRequire(import.meta.url)
// Exercise the shipped components with isolated browser hooks and the actual
// installed Next error boundary. No production request or account is involved.
function component(path: string, context: Record<string, unknown>) {
    const source = ts.createSourceFile(path, readFileSync(`${process.env.LAUNCH_RECOVERY_BASELINE ?? "."}/${path}`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const code = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source)).join("\n")
    const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
    const exports: Record<string, (props?: unknown) => unknown> = {}
    new Function("exports", "require", ...Object.keys(context), js)(exports, require, ...Object.values(context))
    return exports
}

type Element = { type?: string; props?: { children?: unknown; onClick?: () => void } }
function button(value: unknown): Element | undefined {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) return value.map(button).find(Boolean)
    const element = value as Element
    return element.type === "button" ? element : button(element.props?.children)
}
for (const path of ["app/error.tsx", "app/global-error.tsx"]) test(`${path} retries the server read instead of reusing its rejected payload`, () => {
    const { ErrorBoundaryHandler } = require("next/dist/client/components/error-boundary.js")
    const boundary = new ErrorBoundaryHandler({ pathname: "/fixture/queue" })
    let reads = 0
    boundary.context = { refresh() { reads++ } }
    boundary.setState = (state: unknown) => { boundary.state = state }
    const render = component(path, { ErrorBoundaryReporter: () => null }).default
    const view = render({ error: new Error("transient read failure"), reset: boundary.reset, unstable_retry: boundary.unstable_retry })
    const retry = button(view)
    assert.ok(retry?.props?.onClick, "a touch-accessible recovery action must exist")
    assert.equal(reads, 0, "errors do not start automatic request loops")
    retry.props.onClick()
    assert.equal(reads, 1, "Retry must refresh the failed server payload")
    assert.equal(boundary.state.error, null)
})

function events() {
    const listeners = new Map<string, Set<(event?: unknown) => void>>()
    return {
        addEventListener(type: string, callback: (event?: unknown) => void) {
            if (!listeners.has(type)) listeners.set(type, new Set())
            listeners.get(type)!.add(callback)
        },
        removeEventListener(type: string, callback: (event?: unknown) => void) { listeners.get(type)?.delete(callback) },
        emit(type: string, event?: unknown) { listeners.get(type)?.forEach(callback => callback(event)) },
        count(type: string) { return listeners.get(type)?.size ?? 0 },
    }
}
function workerFixture(options: { frame?: boolean; rejected?: boolean; pending?: boolean; hidden?: boolean; host?: string } = {}) {
    let registrations = 0, updates = 0, reconciliations = 0, now = 1_000_000
    const window = { ...events(), top: null as unknown, location: { hostname: options.host ?? "app.betelgeze.com" } }
    window.top = options.frame ? {} : window
    const document = { ...events(), readyState: "loading", visibilityState: options.hidden ? "hidden" : "visible" }
    const registration = { update: async () => { updates++ } }
    let resolve!: (value: typeof registration) => void
    const pending = new Promise<typeof registration>(accept => { resolve = accept })
    const cleanup: Array<() => void> = []
    const evaluated = component("components/pwa/ServiceWorkerRegistrar.tsx", {
        window, document, process: { env: { NODE_ENV: "production" } }, Date: { now: () => now },
        navigator: { serviceWorker: { register: () => { registrations++; return options.rejected ? Promise.reject(new Error("unavailable")) : options.pending ? pending : Promise.resolve(registration) } } },
        useEffect: (callback: () => (() => void) | undefined) => { const result = callback(); if (result) cleanup.push(result) },
        clearOfflineData: async () => undefined,
        browserPushManager: (registration: unknown) => registration,
        reconcilePushSubscription: async () => { reconciliations++ },
    })
    evaluated.ServiceWorkerRegistrar()
    return {
        window, document, counts: () => ({ registrations, updates, reconciliations }),
        advance(ms: number) { now += ms }, resolve: () => resolve(registration),
        cleanup() { cleanup.forEach(callback => callback()) },
    }
}
const settle = async () => { await Promise.resolve(); await Promise.resolve() }

test("a hung child document cannot prevent installing the fixed service worker", async () => {
    const fixture = workerFixture()
    await settle()
    assert.deepEqual(fixture.counts(), { registrations: 1, updates: 1, reconciliations: 1 })
    assert.equal(fixture.window.count("load"), 0, "registration cannot depend on all frames/images finishing")
})
test("workspace frames and non-app hosts do not duplicate registration and updates", async () => {
    for (const options of [{ frame: true }, { host: "portal.example.com" }]) {
        const fixture = workerFixture(options)
        fixture.window.emit("load")
        await settle()
        assert.deepEqual(fixture.counts(), { registrations: 0, updates: 0, reconciliations: 0 })
    }
})
test("resuming a resident app checks for updates once per hour without reloading", async () => {
    const fixture = workerFixture()
    await settle()
    fixture.advance(60 * 60 * 1000)
    fixture.window.emit("focus")
    fixture.document.emit("visibilitychange")
    await settle()
    assert.equal(fixture.counts().updates, 2)
    assert.equal(fixture.counts().registrations, 1)
    fixture.document.visibilityState = "hidden"
    fixture.advance(60 * 60 * 1000)
    fixture.document.emit("visibilitychange")
    assert.equal(fixture.counts().updates, 2)
    fixture.document.visibilityState = "visible"
    fixture.document.emit("visibilitychange")
    assert.equal(fixture.counts().updates, 3)
    fixture.cleanup()
    assert.equal(fixture.window.count("focus"), 0)
    assert.equal(fixture.document.count("visibilitychange"), 0)
})
test("registration failure and late completion after unmount do not launch follow-up work", async () => {
    const failed = workerFixture({ rejected: true })
    await settle()
    assert.equal(failed.counts().updates, 0)
    const late = workerFixture({ pending: true })
    late.cleanup()
    late.resolve()
    await settle()
    assert.deepEqual(late.counts(), { registrations: 1, updates: 0, reconciliations: 0 })
})

function errorFixture(options: { frame?: boolean; search?: string; name?: string } = {}) {
    const messages: Array<{ message: Record<string, unknown>; origin: string }> = []
    const parent = { postMessage(message: Record<string, unknown>, origin: string) { messages.push({ message, origin }) } }
    const window = { ...events(), parent, self: {}, top: {}, name: options.name ?? "", location: { pathname: "/fixture/queue", search: options.search ?? "?__betelgeze_tab=one", hash: "#active", origin: "https://app.betelgeze.com" } }
    if (options.frame === false) window.top = window.self
    const cleanups: Array<() => void> = []
    const attributes = new Map<string, string>()
    const document = { documentElement: { setAttribute: (key: string, value: string) => attributes.set(key, value), removeAttribute: (key: string) => attributes.delete(key) } }
    let telemetry = 0
    component("components/errors/ErrorBoundaryReporter.tsx", {
        ...tabContract, window, document, WORKSPACE_FRAME_ERROR_ATTRIBUTE, URLSearchParams, console: { error() {}, warn() {} },
        useEffect: (callback: () => (() => void) | undefined) => { const result = callback(); if (result) cleanups.push(result) },
        fetch: async () => { telemetry++ },
    }).ErrorBoundaryReporter({ error: new Error("Load failed"), boundary: "app" })
    const probe = { origin: window.location.origin, source: parent, data: { source: tabContract.WORKSPACE_TAB_MESSAGE_SOURCE, target: "frame", tabId: "one", type: "probe" } }
    return { messages, window, probe, attributes, telemetry: () => telemetry, cleanup() { cleanups.forEach(callback => callback()) } }
}
test("a failed page settles its parent even after its normal bridge unmounts", () => {
    const fixture = errorFixture()
    assert.equal(fixture.messages.length, 1)
    assert.equal(fixture.messages[0].message.type, "navigation-failed")
    assert.equal(fixture.messages[0].message.url, "/fixture/queue?__betelgeze_tab=one#active")
    assert.equal(fixture.messages[0].message.tabId, "one")
    fixture.window.emit("message", fixture.probe)
    assert.equal(fixture.messages.length, 2, "a host mounted later receives the error via its bounded readiness probe")
    assert.equal(fixture.telemetry(), 1, "probes do not repeat network telemetry")
    assert.equal(fixture.attributes.get(WORKSPACE_FRAME_ERROR_ATTRIBUTE), "true")
    fixture.cleanup()
    assert.equal(fixture.attributes.has(WORKSPACE_FRAME_ERROR_ATTRIBUTE), false)
    assert.equal(fixture.window.count("message"), 0)
})
test("error probe messages must come from the same-origin parent and the correct tab", () => {
    const fixture = errorFixture()
    for (const event of [
        { ...fixture.probe, origin: "https://other.example" },
        { ...fixture.probe, source: {} },
        { ...fixture.probe, data: { ...fixture.probe.data, tabId: "other" } },
        { ...fixture.probe, data: { ...fixture.probe.data, type: "activate" } },
    ]) fixture.window.emit("message", event)
    assert.equal(fixture.messages.length, 1)
})
test("top-level and unrelated embedded pages never report workspace failure messages", () => {
    assert.equal(errorFixture({ frame: false }).messages.length, 0)
    assert.equal(errorFixture({ search: "", name: "unrelated" }).messages.length, 0)
    assert.equal(errorFixture({ search: "", name: `${tabContract.WORKSPACE_TAB_FRAME_NAME_PREFIX}one` }).messages.length, 1)
})
