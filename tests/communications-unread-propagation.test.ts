import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { applyReadToSummary, createUnreadSummaryResource, type UnreadSummary } from "../lib/communications/unread-summary.ts"
import { normalizeChatReadUpdate, publishChatRead, subscribeChatReadBatches, type ChatReadUpdate } from "../lib/communications/read-state.ts"
import { publishDeviceChatRead, subscribeDeviceChatReads } from "../lib/communications/device-read-state.ts"
import { invalidateUnreadSummary, subscribeUnreadSummaryInvalidations, unreadMessageEventKey } from "../lib/communications/unread-broadcast.ts"

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

function registerWorkspaceRealtime(kind: "client" | "native", invalidated?: () => void, acknowledged: (read: ChatReadUpdate) => void = () => undefined) {
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
        normalizeChatReadUpdate, publishChatRead: acknowledged, unreadMessageEventKey,
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
    test(`${kind} messages invalidate while own remote account reads publish receipts only`, () => {
        let invalidations = 0
        const confirmed: ChatReadUpdate[] = []
        const handlers = registerWorkspaceRealtime(kind, () => invalidations++, read => confirmed.push(read))
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
        assert.equal(invalidations, 2, "an account receipt must not invalidate device unread counts")
        assert.equal(confirmed.length, 1)
        assert.equal(confirmed[0].userId, "me")
        assert.equal(confirmed[0].conversationId, "c")
    })

    test(`${kind} hosted remote cursor updates receipts without entering the device badge channel`, () => {
        const previous = { window: globalThis.window, BroadcastChannel: globalThis.BroadcastChannel }
        Object.assign(globalThis, { window: { top: new EventTarget() }, BroadcastChannel: undefined })
        const original: UnreadSummary = { kind, conversationId: "c", count: 3, latestMessageId: "m3", latestMessageAt: "2026-10-07T10:00:00.000003Z" }
        let rows = [original]
        const receipts: ChatReadUpdate[] = []
        const unsubscribeReceipts = subscribeChatReadBatches("w", "me", reads => receipts.push(...reads))
        const unsubscribeDevice = subscribeDeviceChatReads("w", "me", read => {
            if (read.deviceId === "installation-a") rows = applyReadToSummary(rows, read)
        })
        try {
            const handlers = registerWorkspaceRealtime(kind, () => assert.fail("Account receipt cannot refresh device unread"), publishChatRead)
            const reads = handlers.get(kind === "client" ? "communication_read_cursors" : "workspace_native_read_cursors")!
            const row = { workspace_id: "w", relationship_id: "c", conversation_id: "c", user_id: "me", last_read_at: original.latestMessageAt, last_read_message_id: "m3" }
            reads({ eventType: "UPDATE", new: { ...row, user_id: "other" } })
            assert.deepEqual(rows, [original])
            assert.equal(receipts.length, 0)
            reads({ eventType: "UPDATE", new: row })
            assert.equal(receipts.length, 1, "account read receipt still reaches its existing consumer")
            assert.deepEqual(rows, [original], "even a covering account receipt leaves the installation unread")
            publishDeviceChatRead({ ...receipts[0], deviceId: "installation-b" })
            assert.deepEqual(rows, [original], "another installation is also isolated")
            publishDeviceChatRead({ ...receipts[0], deviceId: "installation-a" })
            assert.deepEqual(rows, [], "only this installation's acknowledged position enters its badge path")
        } finally { unsubscribeReceipts(); unsubscribeDevice(); Object.assign(globalThis, previous) }
    })

    test(`${kind} an older device read retains a newer arrival even after a covering account receipt`, () => {
        const previous = { window: globalThis.window, BroadcastChannel: globalThis.BroadcastChannel }
        Object.assign(globalThis, { window: { top: new EventTarget() }, BroadcastChannel: undefined })
        const original: UnreadSummary = { kind, conversationId: "c", count: 1, latestMessageId: "m4", latestMessageAt: "2026-10-07T10:00:00.000004Z" }
        let rows = [original]
        const unsubscribe = subscribeDeviceChatReads("w", "me", read => { if (read.deviceId === "installation-a") rows = applyReadToSummary(rows, read) })
        try {
            const handlers = registerWorkspaceRealtime(kind, undefined, publishChatRead)
            handlers.get(kind === "client" ? "communication_read_cursors" : "workspace_native_read_cursors")!({ eventType: "UPDATE", new: { workspace_id: "w", relationship_id: "c", conversation_id: "c", user_id: "me", last_read_at: original.latestMessageAt, last_read_message_id: "m4" } })
            publishDeviceChatRead({ workspaceId: "w", userId: "me", kind, deviceId: "installation-a", conversationId: "c", lastReadAt: "2026-10-07T10:00:00.000003Z", lastReadMessageId: "m3" })
            assert.deepEqual(rows, [original])
        } finally { unsubscribe(); Object.assign(globalThis, previous) }
    })
}
