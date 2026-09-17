import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { publishWorkspaceTabActivity, workspaceDocumentIsActive } from "../lib/workspace-tab-activity.ts"
import { compareReadPositions, mergeChatReadCursor, publishChatRead, subscribeChatReads } from "../lib/communications/read-state.ts"
import { applyReadToSummary, createUnreadSummaryResource } from "../lib/communications/unread-summary.ts"
import { clientConversationUnreadCount, nativeConversationUnreadCount } from "../lib/communications/unread.ts"

test("all activation paths revoke the old chat before queued iframe messages", () => {
    const previous = { window: globalThis.window, document: globalThis.document }
    const host = { document: { body: { dataset: {} as Record<string,string> } } }
    const frames = new Map<string, HTMLIFrameElement>()
    const events: string[] = []
    for (const id of ["chat", "other"]) {
        const target = { parent: host, frameElement: { hidden: id !== "chat" }, name: `betelgeze-tab:${id}`, location: { search: `?__betelgeze_tab=${id}` }, document: { body: { dataset: { workspaceTabActive: id === "chat" ? "true" : "false" } } }, dispatchEvent() { events.push(id); return true } }
        frames.set(id, { contentWindow: target } as unknown as HTMLIFrameElement)
    }
    try {
        Object.assign(globalThis, { document: frames.get("chat")!.contentWindow!.document, window: frames.get("chat")!.contentWindow })
        assert.equal(workspaceDocumentIsActive(), true)
        Object.assign(globalThis, { document: host.document })
        const file = process.env.COMMS_SHELL_BASELINE ?? "components/workspace/WorkspaceTopBarClient.tsx"
        const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        let callback: ts.ArrowFunction | undefined
        function visit(node: ts.Node) {
            if (ts.isVariableDeclaration(node) && node.name.getText(source) === "activateWorkspaceTab" && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0] as ts.ArrowFunction
            ts.forEachChild(node, visit)
        }
        visit(source)
        assert.ok(callback)
        const code = ts.transpileModule(`const activate = ${callback.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
        const deps = { publishWorkspaceTabActivity, iframeRefs: { current: frames }, activeTabIdRef: { current: "chat" }, navigationTimeoutRef: { current: new Map() }, nativeNavigationPerformance: { activate() {} }, setMobileContextKey() {}, setResidentTabIds() {}, setActiveTabId() {} }
        const activate = new Function(...Object.keys(deps), `${code};return activate`)(...Object.values(deps))
        activate("other") // run the actual shell callback used by addTab, close and history
        Object.assign(globalThis, { document: frames.get("chat")!.contentWindow!.document })
        assert.equal(workspaceDocumentIsActive(), false, "a stale true activation can never mark another chat read")
        assert.deepEqual(events, ["chat", "other"])
        Object.assign(globalThis, { document: host.document })
        publishWorkspaceTabActivity(frames, "chat")
        Object.assign(globalThis, { document: frames.get("chat")!.contentWindow!.document })
        assert.equal(workspaceDocumentIsActive(), true)
    } finally { Object.assign(globalThis, previous) }
})

test("cursors keep microseconds, normalize realtime timestamps and never move backwards", () => {
    const later = { conversationId: "chat", userId: "me", lastReadMessageId: "b", lastReadAt: "2026-09-17T10:00:00.123456Z" }
    const earlier = { ...later, lastReadMessageId: "a", lastReadAt: "2026-09-17T10:00:00.123455+00:00" }
    assert.equal(mergeChatReadCursor([later], earlier, x => x.conversationId)[0], later)
    assert.equal(compareReadPositions(later, { ...later, lastReadAt: "2026-09-17T10:00:00.123456+00:00" }), 0)
    assert.equal(mergeChatReadCursor([earlier], later, x => x.conversationId)[0], later)
    assert.equal(mergeChatReadCursor([later], { ...later, conversationId: "other" }, x => x.conversationId).length, 2)
})

test("reading clears counts even when the cursor message is outside the loaded history", () => {
    const cursor = { lastReadMessageId: "unloaded", lastReadAt: "2026-09-17T10:00:00.123456+00:00" }
    const rows = [
        { id: "read", createdAt: "2026-09-17T10:00:00.123455Z", senderUserId: "other", direction: "inbound" as const },
        { id: "new", createdAt: "2026-09-17T10:00:00.123457Z", senderUserId: "other", direction: "inbound" as const },
    ]
    assert.equal(clientConversationUnreadCount({ messages: rows }, cursor, false), 1)
    assert.equal(nativeConversationUnreadCount({ messages: rows, unreadMessages: rows }, cursor, "me", false), 1)
})

test("a confirmed read clears the matching shell badge but preserves newer arrivals and other chats", () => {
    const read = { kind: "native" as const, workspaceId: "w", userId: "me", conversationId: "c", lastReadMessageId: "m2", lastReadAt: "2026-09-17T10:00:00Z" }
    const rows = [
        { kind: "native" as const, conversationId: "c", count: 5, latestMessageId: "m2", latestMessageAt: "2026-09-17T10:00:00+00:00" },
        { kind: "client" as const, conversationId: "other", count: 3, latestMessageId: "x", latestMessageAt: "2026-09-17T09:00:00Z" },
    ]
    assert.deepEqual(applyReadToSummary(rows, read), [rows[1]])
    assert.equal(applyReadToSummary([{ ...rows[0], latestMessageAt: "2026-09-17T10:00:01Z" }], read).length, 1)
})

test("stale unread requests cannot restore a badge after a read, and requests are deduplicated", async () => {
    const pending: Array<(value: []) => void> = []
    let renders = 0
    const resource = createUnreadSummaryResource(() => new Promise(resolve => pending.push(resolve)), () => renders++, () => assert.fail("unexpected failure"))
    const first = resource.refresh()
    assert.equal(resource.refresh(), first)
    resource.invalidate()
    pending.shift()!([])
    await Promise.resolve(); await Promise.resolve()
    assert.equal(renders, 0)
    assert.equal(pending.length, 1)
    pending.shift()!([])
    await first
    assert.equal(renders, 1)
    resource.dispose()
})

test("read acknowledgements reach sibling frames immediately and remain account/workspace scoped", () => {
    const original = { window: globalThis.window, BroadcastChannel: globalThis.BroadcastChannel }
    Object.assign(globalThis, { window: { top: new EventTarget() }, BroadcastChannel: undefined })
    const received: unknown[] = []
    const unsubscribe = subscribeChatReads("w", "me", value => received.push(value))
    try {
        const value = { workspaceId: "w", userId: "me", kind: "client" as const, conversationId: "c", lastReadAt: "2026-09-17T10:00:00Z", lastReadMessageId: "m" }
        publishChatRead({ ...value, workspaceId: "other" })
        publishChatRead({ ...value, userId: "other" })
        publishChatRead(value)
        assert.deepEqual(received, [value])
        unsubscribe(); publishChatRead(value)
        assert.equal(received.length, 1)
    } finally { unsubscribe(); Object.assign(globalThis, original) }
})
