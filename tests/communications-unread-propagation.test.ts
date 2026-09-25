import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { createUnreadSummaryResource } from "../lib/communications/unread-summary.ts"
import { invalidateUnreadSummary, subscribeUnreadSummaryInvalidations } from "../lib/communications/unread-broadcast.ts"

test("unread invalidation during response settlement still receives its coalesced refresh", async () => {
    let loads = 0
    const received: number[] = []
    const resource = createUnreadSummaryResource(async () => { loads++; return [] }, () => {
        received.push(loads)
        if (loads === 1) queueMicrotask(() => { resource.invalidate(); void resource.refresh() })
    }, () => assert.fail("unexpected failure"))
    await resource.refresh()
    assert.equal(loads, 2)
    assert.deepEqual(received, [1, 2])
    resource.dispose()
})

test("a settled failed refresh retries only for newer intent, never in a failure loop", async () => {
    let loads = 0, failures = 0
    const resource = createUnreadSummaryResource(async () => { loads++; throw new Error("offline") }, () => assert.fail("unexpected summary"), () => {
        failures++
        if (failures === 1) queueMicrotask(() => { resource.invalidate(); void resource.refresh() })
    })
    await resource.refresh()
    assert.equal(loads, 2)
    assert.equal(failures, 2)
    resource.dispose()
})

test("disposing the summary owner cancels a settlement-time refresh", async () => {
    let loads = 0
    const resource = createUnreadSummaryResource(async () => { loads++; return [] }, () => {
        queueMicrotask(() => { resource.invalidate(); resource.dispose(); void resource.refresh() })
    }, () => assert.fail("unexpected failure"))
    await resource.refresh()
    assert.equal(loads, 1)
})

test("summary reconciliation requests reach the existing host owner within account/workspace scope", () => {
    const previous = globalThis.window
    Object.assign(globalThis, { window: { top: new EventTarget() } })
    let calls = 0
    const unsubscribe = subscribeUnreadSummaryInvalidations("w", "me", () => calls++)
    try {
        invalidateUnreadSummary("other", "me")
        invalidateUnreadSummary("w", "other")
        assert.equal(calls, 0)
        invalidateUnreadSummary("w", "me")
        assert.equal(calls, 1)
        unsubscribe()
        invalidateUnreadSummary("w", "me")
        assert.equal(calls, 1)
    } finally { unsubscribe(); Object.assign(globalThis, { window: previous }) }
})

test("clearing a chat invalidates unread once on acknowledgement even when the later panel refresh fails", async () => {
    const file = "components/communications/TeamCommunicationsWorkspace.tsx"
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let callback: ts.FunctionDeclaration | undefined
    function visit(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name?.getText(source) === "clearPrivateChat") callback = node
        ts.forEachChild(node, visit)
    }
    visit(source)
    assert.ok(callback)
    let acknowledge!: (value: { cleared: boolean }) => void
    let requests = 0, invalidations = 0
    const dependencies = {
        actionErrorReporter: () => (error: unknown) => assert.fail(String(error)),
        selected: { id: "c", kind: "direct", messages: [{ id: "1" }, { id: "2" }, { id: "3" }] },
        bootstrap: { workspaceId: "w", workspaceSlug: "fixture", currentUser: { id: "me" } },
        composerRef: { current: null }, editingSessionRef: { current: null },
        window: { confirm: () => true }, closeWorkspaceComposer() {},
        setReplyingTo() {}, setEditingMessage() {}, setActionMessageId() {}, setDraft() {}, setEditState() {},
        updates: { mutateMessage: (_id: string, _value: unknown, save: () => Promise<unknown>) => save() },
        chatMutationRequest: () => { requests++; return new Promise<{ cleared: boolean }>(resolve => { acknowledge = resolve }) },
        ChatMutationError: Error,
        invalidateUnreadSummary: (workspaceId: string, userId: string) => { assert.equal(workspaceId, "w"); assert.equal(userId, "me"); invalidations++ },
        refresh: async () => { throw new Error("refresh temporarily unavailable") },
    }
    const code = ts.transpileModule(callback.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const clear = new Function(...Object.keys(dependencies), `${code}; return clearPrivateChat`)(...Object.values(dependencies))
    const pending = clear()
    assert.equal(requests, 1)
    assert.equal(invalidations, 0, "local clearing cannot imply a committed server change")
    acknowledge({ cleared: true })
    await pending
    assert.equal(invalidations, 1)
})

function registerWorkspaceRealtime(kind: "client" | "native", invalidated?: () => void) {
    const name = kind === "client" ? "CommunicationsWorkspace" : "TeamCommunicationsWorkspace"
    const file = `components/communications/${name}.tsx`
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let callback: ts.ArrowFunction | undefined
    function visit(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === "registerRealtime" && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0] as ts.ArrowFunction
        ts.forEachChild(node, visit)
    }
    visit(source)
    assert.ok(callback)
    const handlers = new Map<string, (payload: unknown) => void>()
    const channel = { on(_event: string, options: { table?: string }, handler: (payload: unknown) => void) { if (options.table) handlers.set(options.table, handler); return channel } }
    const dependencies = {
        bootstrap: { workspaceId: "w", workspaceSlug: "fixture", currentUser: { id: "me" } },
        onUnreadInvalidated: invalidated,
        updates: { removeMessage() {}, beginRead() {}, getSnapshot: () => ({ conversations: [] }) },
        record: (value: unknown) => value ?? {},
        text: (value: unknown) => typeof value === "string" ? value : null,
        stringValue: (value: unknown) => typeof value === "string" ? value : null,
        realtimeMessage: () => null,
        setReplyingTo() {}, setEditingMessage() {}, setActionMessageId() {}, setDraft() {}, setEditState() {}, setReadCursors() {},
        editingSessionRef: { current: null },
        refresh: async () => undefined, synchronize: async () => undefined,
        NATIVE_TYPING_EVENT: "typing",
    }
    const code = ts.transpileModule(`const register = ${callback.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    new Function(...Object.keys(dependencies), `${code}; return register`)(...Object.values(dependencies))(channel)
    return handlers
}

for (const kind of ["client", "native"] as const) {
    test(`${kind} standalone counts refresh on message changes and the current user's remote read`, () => {
        let invalidations = 0
        const handlers = registerWorkspaceRealtime(kind, () => invalidations++)
        const messages = handlers.get(kind === "client" ? "client_messages" : "workspace_native_messages")!
        const reads = handlers.get(kind === "client" ? "communication_read_cursors" : "workspace_native_read_cursors")!
        // An encrypted event may not carry a decodable body. Its metadata
        // still invalidates the authoritative summary without fetching history.
        messages({ eventType: "INSERT", new: {}, old: {} })
        messages({ eventType: "DELETE", new: {}, old: {} })
        assert.equal(invalidations, 2)
        messages({ eventType: "UPDATE", new: {}, old: {} })
        assert.equal(invalidations, 2, "delivery/edit metadata alone does not change counts")
        const row = { relationship_id: "c", conversation_id: "c", user_id: "other", last_read_at: "2026-09-25T10:00:00Z", last_read_message_id: "m" }
        reads({ eventType: "UPDATE", new: row })
        assert.equal(invalidations, 2, "another person's receipt cannot clear this person's unread count")
        reads({ eventType: "UPDATE", new: { ...row, user_id: "me" } })
        assert.equal(invalidations, 3)
    })

    test(`${kind} hosted chat does not create a second unread owner`, () => {
        const handlers = registerWorkspaceRealtime(kind)
        const messages = handlers.get(kind === "client" ? "client_messages" : "workspace_native_messages")!
        assert.doesNotThrow(() => messages({ eventType: "INSERT", new: {}, old: {} }))
    })
}
