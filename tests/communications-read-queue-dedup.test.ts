import assert from "node:assert/strict"
import test from "node:test"
import { createChatReadQueue } from "../lib/communications/read-queue.ts"
import type { ChatReadUpdate } from "../lib/communications/read-state.ts"

const position = (changes: Partial<ChatReadUpdate> = {}): ChatReadUpdate => ({
    workspaceId: "workspace", userId: "reader", kind: "native", conversationId: "chat",
    lastReadAt: "2026-10-10T10:00:00.123456Z", lastReadMessageId: "message-b", ...changes,
})

function fixture(save: (read: ChatReadUpdate) => Promise<ChatReadUpdate> = async read => read) {
    const attempts: ChatReadUpdate[] = [], acknowledgements: ChatReadUpdate[] = []
    let stored: ChatReadUpdate[] = [], stores = 0
    const queue = createChatReadQueue({
        load: () => [], store: rows => { stored = rows; stores++ }, error() {},
        save: read => { attempts.push(read); return save(read) },
        acknowledge: read => acknowledgements.push(read),
    })
    return { queue, attempts, acknowledgements, stored: () => stored, stores: () => stores }
}

test("a repeated visible observation after acknowledgement does not save or persist the same position again", async () => {
    const owner = fixture()
    owner.queue.observe(position())
    await owner.queue.flush()
    const storedAtAcknowledgement = owner.stores()
    for (let event = 0; event < 5; event++) {
        owner.queue.observe(position())
        await owner.queue.flush()
    }
    assert.equal(owner.attempts.length, 1, "stale rendered cursor must not cause another read POST")
    assert.equal(owner.acknowledgements.length, 1)
    assert.equal(owner.stores(), storedAtAcknowledgement, "covered observations perform no session storage writes")
    assert.deepEqual(owner.stored(), [])
    owner.queue.dispose()
})

test("an acknowledged duplicate arriving during promise settlement cannot recreate durable pending intent", async () => {
    const attempts: ChatReadUpdate[] = []
    let stored: ChatReadUpdate[] = []
    const queue = createChatReadQueue({
        load: () => [], store: rows => { stored = rows }, error() {},
        save: async read => { attempts.push(read); return read },
        acknowledge: read => queueMicrotask(() => queue.observe(read)),
    })
    queue.observe(position())
    await queue.flush()
    assert.deepEqual(stored, [], "already-acknowledged observations are never persisted as retryable intent")
    await queue.flush()
    assert.equal(attempts.length, 1, "a later focus/reconnect cannot repeat the acknowledged save")
    queue.dispose()
})

test("only server-confirmed coverage suppresses repeats; newer microseconds and ID ties still save", async () => {
    const owner = fixture()
    owner.queue.observe(position())
    await owner.queue.flush()
    owner.queue.observe(position({ lastReadMessageId: "message-a" }))
    await owner.queue.flush()
    owner.queue.observe(position({ lastReadMessageId: "message-c" }))
    await owner.queue.flush()
    owner.queue.observe(position({ lastReadAt: "2026-10-10T10:00:00.123457Z", lastReadMessageId: "message-a" }))
    await owner.queue.flush()
    assert.deepEqual(owner.attempts.map(read => [read.lastReadAt, read.lastReadMessageId]), [
        ["2026-10-10T10:00:00.123456Z", "message-b"],
        ["2026-10-10T10:00:00.123456Z", "message-c"],
        ["2026-10-10T10:00:00.123457Z", "message-a"],
    ])
    owner.queue.dispose()
})

test("a server cursor ahead of the request covers subsequent observations only within that acknowledged boundary", async () => {
    const owner = fixture(async read => ({ ...read, lastReadMessageId: "message-d" }))
    owner.queue.observe(position())
    await owner.queue.flush()
    owner.queue.observe(position({ lastReadMessageId: "message-c" }))
    await owner.queue.flush()
    assert.equal(owner.attempts.length, 1)
    assert.equal(owner.acknowledgements[0].lastReadMessageId, "message-d")
    owner.queue.dispose()
})

test("failed and mismatched responses do not seed acknowledgement deduplication or lose pending recovery", async () => {
    for (const first of ["failure", "mismatched"] as const) {
        let success = false
        const owner = fixture(async read => {
            if (success) return read
            if (first === "failure") throw new Error("offline")
            return { ...read, userId: "someone-else" }
        })
        owner.queue.observe(position())
        await owner.queue.flush()
        assert.equal(owner.attempts.length, 1)
        assert.equal(owner.acknowledgements.length, 0)
        assert.deepEqual(owner.stored(), [position()])
        owner.queue.observe(position())
        assert.equal(owner.attempts.length, 1, "duplicate failed observation waits for explicit recovery")
        success = true
        await owner.queue.flush()
        assert.equal(owner.attempts.length, 2)
        assert.equal(owner.acknowledgements.length, 1)
        assert.deepEqual(owner.stored(), [])
        owner.queue.dispose()
    }
})

test("confirmed positions cannot suppress another account, workspace, chat kind or conversation", async () => {
    const owner = fixture()
    for (const read of [position(), position({ userId: "other" }), position({ workspaceId: "other" }), position({ kind: "client" }), position({ conversationId: "other" })]) {
        owner.queue.observe(read)
        await owner.queue.flush()
    }
    assert.equal(owner.attempts.length, 5)
    owner.queue.dispose()
})

test("acknowledged metadata stays bounded; eviction only allows a safe redundant save", async () => {
    const owner = fixture()
    for (let chat = 0; chat < 257; chat++) {
        owner.queue.observe(position({ conversationId: `chat-${chat}` }))
        await owner.queue.flush()
    }
    owner.queue.observe(position({ conversationId: "chat-256" }))
    await owner.queue.flush()
    assert.equal(owner.attempts.length, 257, "recent acknowledged chat is retained")
    owner.queue.observe(position({ conversationId: "chat-0" }))
    await owner.queue.flush()
    assert.equal(owner.attempts.length, 258, "old evidence is forgotten rather than retained without bound")
    owner.queue.dispose()
})

test("a disposed queue never publishes a late response or suppresses a fresh owner's save", async () => {
    let finish!: (read: ChatReadUpdate) => void
    const previous = fixture(() => new Promise(resolve => { finish = resolve }))
    previous.queue.observe(position())
    const pending = previous.queue.flush()
    previous.queue.dispose()
    finish(position())
    await pending
    assert.equal(previous.acknowledgements.length, 0)
    assert.deepEqual(previous.stored(), [position()])
    const next = fixture()
    next.queue.observe(position())
    await next.queue.flush()
    assert.equal(next.attempts.length, 1)
    assert.equal(next.acknowledgements.length, 1)
    next.queue.dispose()
})

test("failed storage cleanup keeps identical visibility eligible to retry after storage recovers", async () => {
    let stored: ChatReadUpdate[] = []
    let failCleanup = true
    let attempts = 0
    const acknowledgements: ChatReadUpdate[] = []
    const errors: (string | null)[] = []
    const queue = createChatReadQueue({
        load: () => [],
        store: rows => {
            if (!rows.length && failCleanup) throw new Error("session storage unavailable")
            stored = rows
        },
        save: async read => { attempts++; return read },
        acknowledge: read => acknowledgements.push(read),
        error: message => errors.push(message),
    })
    queue.observe(position())
    await queue.flush()
    assert.equal(attempts, 1)
    assert.deepEqual(acknowledgements, [position()], "valid server ACK remains confirmed despite local cleanup failure")
    assert.deepEqual(stored, [position()], "failed removal leaves the recoverable intent on disk")
    assert.equal(errors.at(-1), "Read position is pending; this device could not store it for recovery.")

    failCleanup = false
    queue.observe(position())
    await queue.flush()
    assert.equal(attempts, 2, "the degraded-storage path retains the existing visibility retry")
    assert.deepEqual(stored, [])
    assert.equal(errors.at(-1), null, "successful retry clears the recovery warning")

    queue.observe(position())
    await queue.flush()
    assert.equal(attempts, 2, "healthy deduplication resumes after durable cleanup succeeds")
    queue.dispose()
})
