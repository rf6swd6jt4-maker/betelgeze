import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
import * as departures from "../lib/workspace-tab-departure.ts"
import * as mutations from "../lib/workspace-mutations.ts"
import * as navigation from "../lib/workspace-frame-navigation.ts"
import * as tabs from "../lib/workspace-tabs.ts"

function events() {
    const listeners = new Map<string, Set<(event: unknown) => void>>()
    return {
        addEventListener(type: string, fn: (event: unknown) => void) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn) },
        removeEventListener(type: string, fn: (event: unknown) => void) { listeners.get(type)?.delete(fn) },
        dispatchEvent(event: { type: string }) { for (const listener of [...listeners.get(event.type) ?? []]) listener(event); return true },
        count() { return [...listeners.values()].reduce((sum, values) => sum + values.size, 0) },
    }
}

function fixture() {
    const attributes = new Map<string, string>()
    const document = { URL: "https://fixture.test/work?__betelgeze_tab=tab", documentElement: {
        setAttribute: (key: string, value: string) => attributes.set(key, value), removeAttribute: (key: string) => attributes.delete(key),
        getAttribute: (key: string) => attributes.get(key) ?? null, hasAttribute: (key: string) => attributes.has(key),
    } }
    const acknowledgements: unknown[] = []
    const host = { ...events(), location: { origin: "https://fixture.test" }, crypto, setTimeout, clearTimeout }
    const parent = { postMessage: (message: unknown) => { acknowledgements.push(message) } }
    const window = {
        ...events(), self: {}, top: {}, parent, name: "", location: { origin: host.location.origin, pathname: "/work", search: "?__betelgeze_tab=tab", hash: "" }, setTimeout, clearTimeout,
        postMessage: (data: unknown) => window.dispatchEvent({ type: "message", origin: host.location.origin, source: parent, data } as { type: string }),
    }
    const frame = { contentDocument: document, contentWindow: window }
    const source = ts.createSourceFile("guard.tsx", readFileSync("components/workspace/WorkspaceTabFrameGuard.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let setup: ts.CallExpression | undefined
    function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("let departureCheck")) setup = node
        ts.forEachChild(node, visit)
    }
    visit(source); assert.ok(setup)
    const context = { ...departures, ...mutations, ...navigation, ...tabs, window, document, crypto, navigatorRef: { current: null }, router: { push() {}, replace() {} }, startNavigationTransition: (fn: () => void) => fn() }
    const javascript = ts.transpileModule(`const setup = ${setup.arguments[0].getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const cleanup = new Function(...Object.keys(context), `${javascript}; return setup();`)(...Object.values(context))
    return {
        window, frame, attributes, acknowledgements,
        prepare: () => departures.prepareWorkspaceFrameDeparture(frame as unknown as HTMLIFrameElement, "tab", host as unknown as Window),
        deliver() { for (const data of acknowledgements.splice(0)) host.dispatchEvent({ type: "message", origin: host.location.origin, source: window, data } as { type: string }) },
        confirm: () => departures.confirmWorkspaceFrameDeparture(frame as unknown as HTMLIFrameElement), cleanup,
    }
}

test("actual root receiver rejects legacy edits arriving after the acknowledgement, without saving or looping", async () => {
    for (const event of [null, "input", "change", "click", mutations.WORKSPACE_MUTATION_INTENT_START]) {
        const f = fixture(), previous = globalThis.window
        globalThis.window = f.window as unknown as Window & typeof globalThis
        let saves = 0
        const unregister = mutations.registerWorkspaceAutosaveFlusher(async () => { saves++; f.window.dispatchEvent({ type: mutations.WORKSPACE_MUTATION_INTENT_START }); return true })
        try {
            const pending = f.prepare()
            await new Promise<void>((resolve) => setImmediate(resolve))
            assert.equal(f.acknowledgements.length, 1)
            if (event) f.window.dispatchEvent({ type: event })
            f.deliver(); assert.equal(await pending, true)
            assert.equal(f.confirm(), event === null)
            assert.equal(saves, 1, "the final check never retries the network flush")
            assert.equal(f.confirm(), false, "the permit is consumed even when refused")
        } finally { unregister(); f.cleanup(); globalThis.window = previous }
        assert.equal(f.window.count(), 0)
    }
})

test("actual root receiver checkpoints the latest edit at commit and rejects changed owner/document identities", async () => {
    for (const mode of ["latest-durable", "latest-failed", "registry", "document"]) {
        const f = fixture(), previous = globalThis.window
        globalThis.window = f.window as unknown as Window & typeof globalThis
        let durable = true, checkpoints = 0, saves = 0
        const unregister = mutations.registerWorkspaceAutosaveFlusher(async () => { saves++; return true }, { checkpoint: () => { checkpoints++; return durable } })
        let newOwner: (() => boolean) | undefined
        try {
            const pending = f.prepare()
            await new Promise<void>((resolve) => setImmediate(resolve))
            f.deliver(); assert.equal(await pending, true)
            f.window.dispatchEvent({ type: "input" })
            if (mode === "latest-failed") durable = false
            if (mode === "registry") { unregister(); newOwner = mutations.registerWorkspaceAutosaveFlusher(async () => true, { checkpoint: () => true }) }
            if (mode === "document") f.frame.contentDocument = { ...f.frame.contentDocument }
            assert.equal(f.confirm(), mode === "latest-durable")
            assert.equal(saves, 1)
            if (mode.startsWith("latest")) assert.equal(checkpoints, 2, "the final task checkpoints the current draft again")
        } finally { newOwner?.(); unregister(); f.cleanup(); globalThis.window = previous }
        assert.equal(f.window.count(), 0)
    }
})
