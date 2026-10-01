import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"

const origin = "https://app.betelgeze.com"
const source = "/fixture/onboarding/client-1"
const destination = `${source}?session=session-1`
const tabId = "context-tab"

function load(file, dependencies, globals = {}) {
    const compiledModule = { exports: {} }
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText
    runInNewContext(code, {
        module: compiledModule, exports: compiledModule.exports,
        require(name) {
            if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency ${name}`)
            return dependencies[name]
        },
        URL, URLSearchParams, console, ...globals,
    }, { filename: file })
    return compiledModule.exports
}

function eventTarget() {
    const listeners = new Map()
    return {
        addEventListener(name, callback) {
            if (!listeners.has(name)) listeners.set(name, new Set())
            listeners.get(name).add(callback)
        },
        removeEventListener(name, callback) {
            listeners.get(name)?.delete(callback)
            if (!listeners.get(name)?.size) listeners.delete(name)
        },
        async dispatchEvent(event) {
            await Promise.all([...listeners.get(event.type) ?? []].map(callback => callback(event)))
        },
        listenerCount: () => [...listeners.values()].reduce((total, entries) => total + entries.size, 0),
    }
}

function bridgeFixture() {
    const tabs = load("lib/workspace-tabs.ts", {})
    const redirected = tabs.workspaceTabRedirectUrl(destination, `${source}?__betelgeze_tab=${tabId}`, origin)
    const messages = [], routerCalls = [], historyWrites = [], hooks = [], pendingEffects = []
    let hookIndex = 0, connectedObservers = 0
    const window = {
        ...eventTarget(), location: new URL(redirected, origin),
        parent: { postMessage: (message, targetOrigin) => {
            assert.equal(targetOrigin, origin)
            messages.push(message)
        } },
    }
    window.history = {
        state: { __NA: true, fixture: "retained-history" },
        replaceState(state, title, url) {
            assert.equal(state, window.history.state)
            historyWrites.push(url)
            window.location = new URL(url, origin)
        },
    }
    const document = {
        ...eventTarget(), documentElement: { setAttribute() {} },
        body: { dataset: {} }, querySelector: () => null,
    }
    const router = { refresh: () => routerCalls.push("refresh") }
    const startTransition = callback => callback()
    const react = {
        useRef(initial) { const index = hookIndex++; return hooks[index] ??= { current: initial } },
        useState(initial) {
            const index = hookIndex++
            if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial
            return [hooks[index], value => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value }]
        },
        useCallback(callback) { hookIndex++; return callback },
        useTransition() { hookIndex++; return [false, startTransition] },
        useEffect(effect, dependencies) {
            const index = hookIndex++
            if (!hooks[index] || dependencies.some((value, n) => value !== hooks[index].dependencies[n])) {
                pendingEffects.push(() => {
                    hooks[index]?.cleanup?.()
                    hooks[index] = { dependencies, cleanup: effect() }
                })
            }
        },
    }
    const dependencies = {
        react,
        "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
        "next/navigation": { usePathname: () => window.location.pathname, useSearchParams: () => new URLSearchParams(window.location.search), useRouter: () => router },
        "@/lib/workspace-tabs": tabs,
        "@/components/workspace/useWorkspaceTabActive": { WORKSPACE_TAB_VISIBILITY_EVENT: "tab-visibility" },
        "@/lib/onboarding-builder-window": {},
        "@/lib/workspace-frame-navigation": { WORKSPACE_FRAME_NAVIGATION_EVENT: "frame-navigation" },
        "@/lib/workspace-tab-departure": { WORKSPACE_FRAME_PAGE_ATTRIBUTE: "data-frame-page" },
        "@/lib/workspace-composer-viewport": { focusedChatComposer: () => null },
        "@/components/workspace/PullToRefresh": { PullToRefresh: "pull-to-refresh" },
        "@/lib/workspace-detail-preview": {},
        "@/lib/workspace-mutations": { flushWorkspaceAutosaves: async () => {}, WORKSPACE_MUTATION_START: "mutation-start", WORKSPACE_MUTATION_END: "mutation-end" },
    }
    class MutationObserver {
        connected = false
        observe() { if (!this.connected) connectedObservers++; this.connected = true }
        disconnect() { if (this.connected) connectedObservers--; this.connected = false }
    }
    const { WorkspaceTabBridge } = load("components/workspace/WorkspaceTabBridge.tsx", dependencies, {
        window, document, MutationObserver, Event,
    })
    function render() {
        hookIndex = 0
        WorkspaceTabBridge({ tabId, workspaceSlug: "fixture" })
        pendingEffects.splice(0).forEach(effect => effect())
    }
    async function send(type, fields = {}, senderOrigin = origin) {
        await window.dispatchEvent({ type: "message", origin: senderOrigin, source: window.parent, data: { source: tabs.WORKSPACE_TAB_MESSAGE_SOURCE, target: "frame", tabId, type, ...fields } })
    }
    render()
    return {
        window, messages, routerCalls, historyWrites, render, send,
        reports: () => messages.filter(message => ["location", "location-replace"].includes(message.type)),
        cleanup() {
            hooks.forEach(hook => hook?.cleanup?.())
            assert.equal(window.listenerCount(), 0)
            assert.equal(document.listenerCount(), 0)
            assert.equal(connectedObservers, 0)
        },
    }
}

test("committed redirect removes URL metadata locally and a lost first acknowledgement is replayed on probe", async () => {
    const fixture = bridgeFixture()
    try {
        assert.equal(fixture.window.location.searchParams.has("__betelgeze_redirect"), false)
        assert.equal(fixture.window.location.searchParams.get("__betelgeze_tab"), tabId)
        assert.equal(fixture.historyWrites.length, 1)
        const first = fixture.reports()[0]
        assert.equal(first.type, "location-replace")
        assert.equal(first.url, destination)
        assert.equal(first.replacedUrl, source)
        // Discard the first message as though the host receiver missed it.
        fixture.messages.length = 0
        await fixture.send("probe")
        assert.deepEqual(fixture.reports()[0], first)
        await fixture.send("probe")
        assert.deepEqual(fixture.reports()[1], first)
        assert.equal(fixture.historyWrites.length, 1, "recovery is a message, not another history write")
        assert.deepEqual(fixture.routerCalls, [], "recovery must not start a read or refresh")
    } finally { fixture.cleanup() }
})

test("only activation acknowledging this exact destination retires the retained redirect proof", async () => {
    const fixture = bridgeFixture()
    try {
        await fixture.send("activate", { active: true })
        await fixture.send("probe")
        assert.equal(fixture.reports().at(-1).type, "location-replace")
        await fixture.send("activate", { active: true, url: "/fixture/work/client-1" })
        await fixture.send("probe")
        assert.equal(fixture.reports().at(-1).type, "location-replace")
        await fixture.send("activate", { active: true, url: destination })
        await fixture.send("probe")
        assert.equal(fixture.reports().at(-1).type, "location")
        assert.equal(fixture.reports().at(-1).url, destination)
        assert.equal(fixture.reports().at(-1).replacedUrl, undefined)
        assert.deepEqual(fixture.routerCalls, [])
    } finally { fixture.cleanup() }
})

test("a different committed URL cannot replay proof belonging to the previous redirect", async () => {
    const fixture = bridgeFixture()
    try {
        fixture.window.location = new URL(`/fixture/work/client-1?__betelgeze_tab=${tabId}`, origin)
        await fixture.send("probe")
        assert.equal(fixture.reports().at(-1).type, "location")
        assert.equal(fixture.reports().at(-1).url, "/fixture/work/client-1")
        assert.equal(fixture.reports().at(-1).replacedUrl, undefined)
        fixture.render()
        await fixture.send("probe")
        assert.equal(fixture.reports().at(-1).type, "location")
        assert.deepEqual(fixture.routerCalls, [])
    } finally { fixture.cleanup() }
})

test("foreign origins and another tab cannot request or acknowledge redirect recovery", async () => {
    const fixture = bridgeFixture()
    try {
        const before = fixture.reports().length
        await fixture.send("probe", {}, "https://foreign.invalid")
        await fixture.send("probe", { tabId: "another-tab" })
        assert.equal(fixture.reports().length, before)
        await fixture.send("activate", { active: true, url: destination }, "https://foreign.invalid")
        await fixture.send("activate", { active: true, url: destination, tabId: "another-tab" })
        await fixture.send("probe")
        assert.equal(fixture.reports().at(-1).type, "location-replace")
    } finally { fixture.cleanup() }
})
