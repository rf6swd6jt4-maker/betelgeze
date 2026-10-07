import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { setImmediate } from "node:timers/promises"
import test from "node:test"
import ts from "typescript"
import { mergeChatReadCursor, mergeChatReadCursors, normalizeChatReadUpdate, publishChatRead, publishChatReads, subscribeChatReadBatches, type ChatReadUpdate } from "../lib/communications/read-state.ts"
import { applyReadsToSummary, createConfirmedReadLedger, createUnreadSummaryResource, type UnreadSummary } from "../lib/communications/unread-summary.ts"
import { invalidateUnreadSummary, subscribeUnreadSummaryInvalidations, unreadMessageEventKey } from "../lib/communications/unread-broadcast.ts"

const scope = { workspaceId: "w", userId: "me", kind: "native" as const }
const read: ChatReadUpdate = { ...scope, conversationId: "chat", lastReadAt: "2026-10-07T10:00:00.123456Z", lastReadMessageId: "b" }
const summary: UnreadSummary = { kind: "native", conversationId: "chat", count: 3, latestMessageAt: read.lastReadAt, latestMessageId: "b" }

test("batch cursor merging matches ordered single updates and retains unchanged array identity", () => {
    const other = { ...read, conversationId: "other" }
    const peer = { ...read, userId: "peer" }
    const initial = [read, other, peer]
    const newer = { ...read, lastReadMessageId: "c" }
    const updates = [newer, { ...other, lastReadMessageId: "a" }, { ...read, conversationId: "new" }, { ...newer, lastReadMessageId: "d" }]
    const conversation = (cursor: ChatReadUpdate) => cursor.conversationId
    assert.deepEqual(mergeChatReadCursors(initial, updates, conversation), updates.reduce((current, cursor) => mergeChatReadCursor(current, cursor, conversation), initial))
    assert.equal(mergeChatReadCursors(initial, [read, other, peer], conversation), initial)
    assert.equal(mergeChatReadCursors(initial, [], conversation), initial)
    assert.equal(mergeChatReadCursors(initial, [{ ...read, lastReadMessageId: null }], conversation), initial)
    const many = Array.from({ length: 1000 }, (_, index) => ({ ...read, conversationId: `chat-${index}` }))
    let keys = 0
    assert.equal(mergeChatReadCursors(many, many, cursor => { keys++; return cursor.conversationId }), many)
    assert.equal(keys, 2000, "each current and incoming position is indexed once")
})

test("trusted cursor normalization preserves exact positions and rejects a different account, workspace or conflicting identity", () => {
    assert.deepEqual(normalizeChatReadUpdate(scope, { workspace_id: "w", user_id: "me", conversation_id: "chat", last_read_at: read.lastReadAt, last_read_message_id: "b" }), read)
    assert.deepEqual(normalizeChatReadUpdate(scope, read), read)
    assert.equal(normalizeChatReadUpdate(scope, { ...read, userId: "other" }), null)
    assert.equal(normalizeChatReadUpdate(scope, { ...read, workspace_id: "other" }), null)
    assert.equal(normalizeChatReadUpdate(scope, { ...read, conversation_id: "different" }), null)
    assert.equal(normalizeChatReadUpdate(scope, { ...read, user_id: "other" }), null)
    assert.equal(normalizeChatReadUpdate(scope, { ...read, kind: "client" }), null)
    assert.equal(normalizeChatReadUpdate(scope, { ...read, lastReadAt: "invalid" }), null)
    assert.equal(normalizeChatReadUpdate(scope, { ...read, lastReadMessageId: undefined }), null)
    assert.equal(normalizeChatReadUpdate(scope, null), null)
    assert.deepEqual(normalizeChatReadUpdate({ ...scope, kind: "client" }, { relationshipId: "client", userId: "me", lastReadAt: read.lastReadAt, lastReadMessageId: null }), { ...read, kind: "client", conversationId: "client", lastReadMessageId: null })
})

test("confirmed positions deduplicate shell/frame/snapshot copies, preserve microseconds and fence stale metadata", () => {
    const ledger = createConfirmedReadLedger("w", "me")
    assert.deepEqual(ledger.accept([read, { ...read, lastReadMessageId: "a" }, read]), [read])
    assert.deepEqual(ledger.accept([{ ...read, lastReadAt: "2026-10-07T10:00:00.123456+00:00" }]), [])
    assert.deepEqual(ledger.accept([{ ...read, workspaceId: "other" }, { ...read, userId: "other" }]), [])
    assert.deepEqual(ledger.apply([summary]), [])
    const newer = { ...summary, latestMessageAt: "2026-10-07T10:00:00.123457Z" }
    assert.deepEqual(ledger.apply([newer]), [newer])
    const other = { ...summary, kind: "client" as const }
    assert.deepEqual(ledger.apply([other]), [other])
    assert.deepEqual(ledger.accept([{ ...read, lastReadAt: newer.latestMessageAt }]), [{ ...read, lastReadAt: newer.latestMessageAt }])
    assert.deepEqual(ledger.apply([newer]), [])
    ledger.clear()
    assert.deepEqual(ledger.apply([summary]), [summary])
})

test("legacy null boundaries cover timestamp ties without suppressing a later microsecond", () => {
    const ledger = createConfirmedReadLedger("w", "me")
    const legacy = { ...read, lastReadMessageId: null }
    ledger.accept([legacy])
    assert.deepEqual(ledger.apply([summary]), [])
    assert.deepEqual(ledger.accept([read]), [], "a null legacy timestamp boundary is already inclusive")
    const newer = { ...summary, latestMessageAt: "2026-10-07T10:00:00.123457Z" }
    assert.deepEqual(ledger.apply([newer]), [newer])
})

test("mounted read metadata is bounded and eviction only forgets evidence", () => {
    const ledger = createConfirmedReadLedger("w", "me", 2)
    ledger.accept([read, { ...read, conversationId: "second" }, { ...read, conversationId: "third" }])
    assert.deepEqual(ledger.apply([summary]), [summary], "evicted evidence cannot clear a count")
    assert.deepEqual(ledger.accept([{ ...read, conversationId: "third" }]), [])
    assert.deepEqual(ledger.accept([read]), [read], "an evicted acknowledgement can be safely accepted again")
})

function browserFixture() {
    const previous = { window: globalThis.window, document: globalThis.document, BroadcastChannel: globalThis.BroadcastChannel }
    const host = new EventTarget()
    const posts: unknown[] = []
    class Channel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        postMessage(value: unknown) { posts.push(value) }
        close() {}
    }
    Object.assign(globalThis, { window: Object.assign(new EventTarget(), { top: host }), document: Object.assign(new EventTarget(), { visibilityState: "visible" }), BroadcastChannel: Channel })
    return { host, posts, restore: () => Object.assign(globalThis, previous) }
}

test("batch transport preserves legacy singles, isolates scope and lets sibling tabs reconcile snapshot receipts", () => {
    const fixture = browserFixture()
    const batches: Array<{ reads: ChatReadUpdate[]; reconcile: boolean }> = []
    const unsubscribe = subscribeChatReadBatches("w", "me", (reads, options) => batches.push({ reads, ...options }))
    try {
        publishChatRead(read)
        assert.deepEqual(batches, [{ reads: [read], reconcile: true }])
        assert.equal((fixture.posts[0] as ChatReadUpdate).conversationId, read.conversationId, "an old single-message listener still receives the acknowledgement")
        assert.equal((fixture.posts[0] as ChatReadUpdate).workspaceId, "w")
        publishChatReads([read, { ...read, conversationId: "second" }], { reconcile: false })
        assert.equal(batches[1].reads.length, 2)
        assert.equal(batches[1].reconcile, false)
        assert.equal((fixture.posts[1] as { reconcile: boolean }).reconcile, true, "another browser tab does not receive this host's later invalidation")
        publishChatRead({ ...read, userId: "other" })
        assert.equal(batches.length, 2)
        fixture.host.dispatchEvent(new CustomEvent("betelgeze:chat-read", { detail: read }))
        assert.equal(batches.length, 3, "accept older clients' single-update wire format")
    } finally { unsubscribe(); fixture.restore() }
})

function mountUnreadOwner() {
    const fixture = browserFixture()
    const cleanups: Array<() => void> = []
    const effects: Array<() => void | (() => void)> = []
    const states: unknown[] = []
    const requests: Array<{ resolve: (rows: UnreadSummary[]) => void; reject: (error: Error) => void }> = []
    let stateIndex = 0
    const dependencies = {
        useCallback: (callback: unknown) => callback,
        useRef: (value: unknown) => ({ current: value }),
        useState: (value: unknown) => {
            const index = stateIndex++
            states[index] = value
            return [value, (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next }]
        },
        useEffect: (effect: () => void | (() => void)) => effects.push(effect),
        beginWorkspaceInteraction: () => ({ mark() {}, finish() {} }),
        subscribeChatReadBatches, subscribeUnreadSummaryInvalidations, publishUnreadSummary() {},
        applyReadsToSummary, createConfirmedReadLedger, createUnreadSummaryResource,
        fetch: () => new Promise((resolve, reject) => requests.push({ resolve: rows => resolve({ ok: true, json: async () => ({ conversations: rows }) }), reject })),
    }
    const file = "components/communications/useCommunicationsUnread.ts"
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.getText(source) === "useCommunicationsUnread")!
    const code = ts.transpileModule(declaration.getText(source).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const mount = new Function(...Object.keys(dependencies), `${code}; return useCommunicationsUnread`)(...Object.values(dependencies))
    mount("w", "fixture", "me", true)
    for (const effect of effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) }
    return {
        requests,
        rows: () => (states[0] as { rows: UnreadSummary[] }).rows,
        stale: () => states[1],
        unmount: () => cleanups.forEach(cleanup => cleanup()),
        dispose: () => { cleanups.forEach(cleanup => cleanup()); fixture.restore() },
    }
}

test("the real summary hook immediately applies remote receipts, deduplicates copies and survives a failed reconciliation", async () => {
    const owner = mountUnreadOwner()
    try {
        owner.requests[0].resolve([summary])
        await setImmediate()
        assert.deepEqual(owner.rows(), [summary])
        publishChatRead(read)
        assert.deepEqual(owner.rows(), [], "clear from confirmed metadata before any second HTTP response")
        assert.equal(owner.requests.length, 2)
        publishChatRead(read)
        publishChatReads([read])
        assert.equal(owner.requests.length, 2, "shell/frame/browser copies do not invalidate the pending request")
        owner.requests[1].reject(new Error("temporary failure"))
        await setImmediate()
        assert.deepEqual(owner.rows(), [])
        assert.equal(owner.stale(), true)
        assert.equal(owner.requests.length, 2, "failure does not create a polling/retry loop")
        invalidateUnreadSummary("w", "me")
        owner.requests[2].resolve([summary])
        await setImmediate()
        assert.deepEqual(owner.rows(), [], "a stale metadata response cannot undo a known confirmed cursor")
    } finally { owner.dispose() }
})

test("a recovery batch plus its existing invalidation starts one refresh and preserves newer arrivals", async () => {
    const owner = mountUnreadOwner()
    try {
        const newer = { ...summary, latestMessageId: "c" }
        const second = { ...summary, conversationId: "second" }
        owner.requests[0].resolve([newer, second])
        await setImmediate()
        publishChatReads([read, { ...read, conversationId: "second" }], { reconcile: false })
        assert.deepEqual(owner.rows(), [newer])
        assert.equal(owner.requests.length, 1)
        invalidateUnreadSummary("w", "me")
        assert.equal(owner.requests.length, 2)
        publishChatReads([read, { ...read, conversationId: "second" }], { reconcile: false })
        owner.requests[1].resolve([newer])
        await setImmediate()
        assert.equal(owner.requests.length, 2)
        assert.deepEqual(owner.rows(), [newer])
    } finally { owner.dispose() }
})

test("a receipt during initial loading fences the earlier result", async () => {
    const owner = mountUnreadOwner()
    try {
        publishChatRead(read)
        owner.requests[0].resolve([summary])
        await setImmediate()
        assert.equal(owner.requests.length, 2)
        assert.deepEqual(owner.rows(), [])
        owner.requests[1].resolve([summary])
        await setImmediate()
        assert.deepEqual(owner.rows(), [])
    } finally { owner.dispose() }
})


test("disposing an unread owner ignores both a late response and later read broadcasts", async () => {
    const owner = mountUnreadOwner()
    try {
        owner.unmount()
        publishChatRead(read)
        owner.requests[0].resolve([summary])
        await setImmediate()
        assert.equal(owner.requests.length, 1)
        assert.deepEqual(owner.rows(), [])
        assert.equal(owner.stale(), false)
    } finally { owner.dispose() }
})


test("message invalidation identity distinguishes committed events and requires complete metadata", () => {
    const event = { eventType: "INSERT", new: { id: "message" }, commit_timestamp: "2026-10-07T10:00:00.123456Z" }
    const key = unreadMessageEventKey("native", event)
    assert.equal(key, unreadMessageEventKey("native", { ...event, commit_timestamp: "2026-10-07T10:00:00.123456+00:00" }))
    assert.notEqual(key, unreadMessageEventKey("client", event))
    assert.notEqual(key, unreadMessageEventKey("native", { ...event, commit_timestamp: "2026-10-07T10:00:00.123457Z" }))
    assert.notEqual(key, unreadMessageEventKey("native", { ...event, eventType: "DELETE", old: event.new }))
    assert.equal(unreadMessageEventKey("native", { ...event, commit_timestamp: undefined }), undefined)
    assert.equal(unreadMessageEventKey("native", { ...event, new: {} }), undefined)
    assert.equal(unreadMessageEventKey("native", { ...event, eventType: "unknown" }), undefined)
})

test("duplicate shell/frame message events start one immediate GET; distinct events still fence pending responses", async () => {
    const owner = mountUnreadOwner()
    try {
        owner.requests[0].resolve([])
        await setImmediate()
        const event = { eventType: "INSERT", new: { id: "message" }, commit_timestamp: "2026-10-07T10:00:00.123456Z" }
        const key = unreadMessageEventKey("native", event)!
        invalidateUnreadSummary("w", "me", key)
        assert.equal(owner.requests.length, 2, "first event starts without a debounce or timer")
        invalidateUnreadSummary("w", "me", key)
        owner.requests[1].resolve([summary])
        await setImmediate()
        assert.equal(owner.requests.length, 2, "the duplicate did not invalidate an already-correct request")
        assert.deepEqual(owner.rows(), [summary])
        invalidateUnreadSummary("w", "me", `${key}:second`)
        invalidateUnreadSummary("w", "me", `${key}:third`)
        owner.requests[2].resolve([])
        await setImmediate()
        assert.equal(owner.requests.length, 4, "a genuinely different in-flight event retains its coalesced refresh")
        assert.deepEqual(owner.rows(), [summary], "the superseded result was rejected")
        owner.requests[3].resolve([])
        await setImmediate()
        assert.deepEqual(owner.rows(), [])
        invalidateUnreadSummary("w", "me")
        invalidateUnreadSummary("w", "me")
        owner.requests[4].resolve([])
        await setImmediate()
        assert.equal(owner.requests.length, 6, "unidentified events remain conservative")
        owner.requests[5].resolve([])
        await setImmediate()
    } finally { owner.dispose() }
})

test("event deduplication forgets old identities after its bounded window", async () => {
    const owner = mountUnreadOwner()
    try {
        owner.requests[0].resolve([])
        await setImmediate()
        for (let index = 0; index < 257; index++) invalidateUnreadSummary("w", "me", `event-${index}`)
        owner.requests[1].resolve([])
        await setImmediate()
        owner.requests[2].resolve([])
        await setImmediate()
        assert.equal(owner.requests.length, 3)
        invalidateUnreadSummary("w", "me", "event-256")
        assert.equal(owner.requests.length, 3, "retained identities are deduplicated")
        invalidateUnreadSummary("w", "me", "event-0")
        assert.equal(owner.requests.length, 4, "old identities are evicted instead of growing without bound")
        owner.requests[3].resolve([])
        await setImmediate()
    } finally { owner.dispose() }
})
