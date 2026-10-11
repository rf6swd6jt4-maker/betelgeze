import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { setImmediate } from "node:timers/promises"
import test from "node:test"
import ts from "typescript"
import { createChatReadQueue } from "../lib/communications/read-queue.ts"
import { compareReadPositions, normalizeChatReadUpdate, type ChatReadUpdate } from "../lib/communications/read-state.ts"
import { normalizeDeviceChatRead } from "../lib/communications/device-read-state.ts"

const position = { lastReadAt: "2026-10-11T12:00:00.000001Z", lastReadMessageId: "b" }
const read: ChatReadUpdate = { ...position, workspaceId: "w", userId: "u", kind: "native", conversationId: "chat" }
function mount(input: { cursorKnown?: boolean; deviceId?: string | null; visible?: boolean; readProtocol?: "account-v1" | "device-v1" } = {}) {
    const previous = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, sessionStorage: globalThis.sessionStorage, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame }
    const eventTarget = new EventTarget()
    Object.assign(globalThis, { window: Object.assign(eventTarget, { top: eventTarget, location: { search: "" }, name: "test" }), document: Object.assign(new EventTarget(), { visibilityState: "visible" }) })
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } })
    const storage = new Map<string, string>()
    globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value) }, removeItem: key => { storage.delete(key) } } as Storage
    const frames = new Map<number, FrameRequestCallback>()
    let id = 0
    globalThis.requestAnimationFrame = callback => { frames.set(++id, callback); return id }
    globalThis.cancelAnimationFrame = frame => { frames.delete(frame) }
    const effects: Array<() => void | (() => void)> = [], layouts: typeof effects = [], cleanups: Array<() => void> = []
    const shared: ChatReadUpdate[] = [], privateReads: ChatReadUpdate[] = [], dismissals: unknown[][] = [], requests: Array<{ url: string; body: Record<string, unknown>; respond: (value: unknown, status?: number) => void }> = []
    let recheck = () => {}
    const dependencies = {
        useRef: (value: unknown) => ({ current: value }), useCallback: (callback: unknown) => callback,
        useState: (value: unknown) => [value, () => {}], useEffect: (effect: () => void | (() => void)) => effects.push(effect), useLayoutEffect: (effect: () => void | (() => void)) => layouts.push(effect),
        useWorkspaceNavigation: () => null, useWorkspaceTabActive: () => true, useChatDocumentAttention: () => ({ attentive: true }),
        workspaceDocumentIsActive: () => true, chatDocumentHasAttention: () => true, latestMessageIsVisible: () => input.visible !== false,
        CHAT_READING_VISIBILITY_EVENT: "fixture:visibility", WORKSPACE_TAB_FRAME_PARAM: "__frame",
        observeChatReadingVisibility: (_window: unknown, _pane: unknown, _message: unknown, callback: () => void) => { recheck = callback; callback(); return () => {} },
        beginWorkspaceInteraction: () => ({ mark() {}, finish() {} }), createChatReadQueue, compareReadPositions, normalizeChatReadUpdate, normalizeDeviceChatRead,
        publishChatRead: (value: ChatReadUpdate) => shared.push(value), publishDeviceChatRead: (value: ChatReadUpdate) => privateReads.push(value),
        dismissReadChatNotification: (...args: unknown[]) => { dismissals.push(args); return Promise.resolve() }, invalidateUnreadSummary() {},
        fetch: (url: string, options: { body: string }) => new Promise(resolve => requests.push({ url, body: JSON.parse(options.body), respond: (value, status = 200) => resolve({ ok: status < 400, status, json: async () => value }) })),
    }
    const file = "components/communications/useConversationRead.ts"
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.getText(source) === "useConversationRead")!
    const code = ts.transpileModule(declaration.getText(source).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const hook = new Function(...Object.keys(dependencies), `${code}; return useConversationRead`)(...Object.values(dependencies))
    const result = hook({ ...read, workspaceSlug: "acme", conversationId: "chat", latest: { id: "b", createdAt: position.lastReadAt }, cursor: null, cursorKnown: input.cursorKnown ?? true, deviceId: input.deviceId === undefined ? "device-a" : input.deviceId, readProtocol: input.readProtocol ?? "device-v1", active: true, atLatest: true, pane: { current: {} } })
    for (const effect of [...effects, ...layouts]) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) }
    const paint = () => { for (let count = 0; count < 4 && frames.size; count++) { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback(0)) } }
    return { requests, shared, privateReads, dismissals, storage, paint, recheck: () => { recheck(); paint() }, flush: result.flush,
        dispose() { cleanups.forEach(cleanup => cleanup()); Object.assign(globalThis, { window: previous.window, document: previous.document, sessionStorage: previous.sessionStorage, requestAnimationFrame: previous.requestAnimationFrame, cancelAnimationFrame: previous.cancelAnimationFrame }); Object.defineProperty(globalThis, "navigator", { configurable: true, value: previous.navigator }) },
    }
}

test("device observations require known cursor and identity in addition to unchanged visibility eligibility", () => {
    for (const scenario of [{ cursorKnown: false }, { deviceId: null }, { visible: false }]) {
        const hook = mount(scenario)
        try { hook.paint(); assert.equal(hook.requests.length, 0); assert.equal(hook.shared.length, 0); assert.equal(hook.privateReads.length, 0) }
        finally { hook.dispose() }
    }
})

test("a device read only publishes after both server cursors confirm and uses account position for notification dismissal", async () => {
    const hook = mount()
    try {
        hook.paint()
        await setImmediate()
        assert.equal(hook.requests.length, 1)
        assert.match(hook.requests[0].url, /readProtocol=device-v1/)
        assert.equal(hook.requests[0].body.deviceId, "device-a")
        assert.equal(hook.shared.length, 0)
        assert.equal(hook.privateReads.length, 0)
        assert.equal(hook.dismissals.length, 0)
        assert.match([...hook.storage.keys()][0], /chat-reads:v2:w:u:device-a:/)
        const account = { ...read, lastReadAt: "2026-10-11T12:00:00.000002Z", lastReadMessageId: "c" }
        hook.requests[0].respond({ readProtocol: "device-v1", deviceId: "device-a", deviceCursor: { ...read, deviceId: "device-a" }, cursor: account })
        await setImmediate()
        assert.deepEqual(hook.shared, [account])
        assert.equal(hook.privateReads.length, 1)
        assert.equal(hook.privateReads[0].lastReadAt, position.lastReadAt)
        assert.deepEqual(hook.dismissals, [["chat", account.lastReadAt, "c"]])
        hook.recheck()
        assert.equal(hook.requests.length, 1, "post-ACK render lag cannot duplicate the save")
        assert.equal(hook.storage.size, 0)
    } finally { hook.dispose() }
})

test("an account-only or wrong-installation response cannot acknowledge private intent and remains recoverable", async () => {
    for (const result of [{ readProtocol: "account-v1", cursor: read }, { readProtocol: "device-v1", deviceId: "device-b", cursor: read, deviceCursor: { ...read, deviceId: "device-b" } }, { readProtocol: "device-v1", deviceId: "device-a", cursor: { ...read, lastReadMessageId: "a" }, deviceCursor: read }]) {
        const hook = mount()
        try {
            hook.paint(); await setImmediate(); hook.requests[0].respond(result); await setImmediate()
            assert.equal(hook.privateReads.length, 0); assert.equal(hook.shared.length, 0); assert.equal(hook.dismissals.length, 0)
            assert.equal(hook.storage.size, 1)
            const retry = hook.flush()
            assert.equal(hook.requests.length, 2)
            hook.requests[1].respond({ readProtocol: "device-v1", deviceId: "device-a", cursor: read, deviceCursor: read })
            await retry
            assert.equal(hook.privateReads.length, 1)
            assert.equal(hook.shared.length, 1)
        } finally { hook.dispose() }
    }
})

test("old account protocol still saves and broadcasts its canonical cursor without a device identity", async () => {
    const hook = mount({ readProtocol: "account-v1", deviceId: null, cursorKnown: false })
    try {
        hook.paint(); await setImmediate(); assert.equal(hook.requests.length, 1)
        assert.equal(hook.requests[0].body.deviceId, undefined)
        hook.requests[0].respond({ cursor: read }); await setImmediate()
        assert.deepEqual(hook.shared, [read]); assert.deepEqual(hook.privateReads, [])
    } finally { hook.dispose() }
})
