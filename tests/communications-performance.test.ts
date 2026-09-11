import assert from "node:assert/strict"
import test from "node:test"
import sharp from "sharp"
import { createCommunicationsModeResource } from "../lib/communications/mode-resource.ts"
import { loadMessageMetadata } from "../lib/communications/message-batches.ts"
import { loadCommunicationMediaRepresentation } from "../lib/communications/media-http.ts"
import { prepareStoredCommunicationImage } from "../lib/communications/image-preview.ts"
import { communicationHistoryCursor, communicationHistoryPage, communicationHistoryRpcMissing, legacyCommunicationHistoryPage } from "../lib/communications/history-page.ts"

const bootstrap = { workspaceId: "workspace", currentUser: { id: "user" }, conversations: [] }

test("missing history RPCs retain the legacy authorized window without treating access failures as compatibility", () => {
    for (const code of ["42883", "PGRST202"]) assert.equal(communicationHistoryRpcMissing({ code }), true)
    for (const code of ["42501", "PGRST301", "PGRST116", "XX000"]) assert.equal(communicationHistoryRpcMissing({ code }), false)
    const messages = Array.from({ length: 80 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, createdAt: "2026-09-10T10:00:00.123456Z" }))
    const first = legacyCommunicationHistoryPage(messages, { id: "ffffffff-ffff-ffff-ffff-ffffffffffff", createdAt: "2026-09-10T10:00:00.123456+00:00" })
    assert.deepEqual(first.messages, messages.slice(20))
    assert.equal(first.hasMore, true)
    const last = legacyCommunicationHistoryPage(messages, first.nextBefore!)
    assert.deepEqual(last.messages, messages.slice(0, 20))
    assert.equal(last.hasMore, false)
    assert.equal(legacyCommunicationHistoryPage(messages, last.nextBefore!).messages.length, 0)
})

test("deferred mode reads coalesce, validate the session, and retry rejected reads", async () => {
    let attempts = 0
    const resource = createCommunicationsModeResource({ workspaceId: "workspace", userId: "user", load: async () => {
        attempts++
        if (attempts === 1) throw new Error("Offline")
        return bootstrap
    } })
    const first = resource.load("team")
    assert.equal(first, resource.load("team"))
    await assert.rejects(first, /Offline/)
    assert.deepEqual(await resource.load("team"), bootstrap)
    assert.equal(attempts, 2)
    assert.deepEqual(await resource.load("team"), bootstrap)
    assert.equal(attempts, 2)
    resource.dispose()
    await assert.rejects(resource.load("team"), /closed/)
    for (const value of [{ ...bootstrap, workspaceId: "other" }, { ...bootstrap, currentUser: { id: "other" } }]) {
        const foreign = createCommunicationsModeResource({ workspaceId: "workspace", userId: "user", load: async () => value })
        await assert.rejects(foreign.load("clients"), /session changed/)
    }
})

test("unmounted mode reads abort and cannot return a late response", async () => {
    let complete!: () => void
    let requestSignal: AbortSignal | undefined
    const resource = createCommunicationsModeResource({ workspaceId: "workspace", userId: "user", load: async (_, signal) => {
        requestSignal = signal
        await new Promise<void>((resolve) => { complete = resolve })
        return bootstrap
    } })
    const result = resource.load("clients")
    await Promise.resolve()
    resource.dispose()
    assert.equal(requestSignal?.aborted, true)
    complete()
    await assert.rejects(result, /closed/)
})

test("metadata joins bound URL size and simultaneous requests without dropping IDs", async () => {
    const ids = Array.from({ length: 1_301 }, (_, index) => String(index))
    let current = 0, maximum = 0
    const result = await loadMessageMetadata([...ids, "1"], async (batch) => {
        assert.ok(batch.length <= 150)
        current++
        maximum = Math.max(maximum, current)
        await new Promise((resolve) => setTimeout(resolve, 1))
        current--
        return batch
    })
    assert.equal(maximum, 4)
    assert.deepEqual(result, ids)
    let emptyCalls = 0
    assert.deepEqual(await loadMessageMetadata([], async () => { emptyCalls++; return [] }), [])
    assert.equal(emptyCalls, 0)
    await assert.rejects(loadMessageMetadata(["a"], async () => { throw new Error("Failed") }), /Failed/)
})

test("prepared private previews avoid HEAD checks and resize work; HEAD never prepares", async () => {
    const calls: string[] = []
    let prepared = 0
    const input = { originalPath: "private/original", previewPath: "private/original.preview", preview: true, method: "GET" as "GET" | "HEAD", load: async (path: string) => { calls.push(path); return new Response("image") }, prepare: async () => { prepared++; return true } }
    assert.equal((await loadCommunicationMediaRepresentation(input)).deliveryPath, input.previewPath)
    assert.deepEqual(calls, [input.previewPath])
    assert.equal(prepared, 0)
    calls.length = 0
    const head = await loadCommunicationMediaRepresentation({ ...input, method: "HEAD", load: async (path) => { calls.push(path); return new Response(null, { status: path === input.previewPath ? 404 : 200 }) } })
    assert.equal(head.deliveryPath, input.originalPath)
    assert.equal(prepared, 0)
    assert.deepEqual(calls, [input.previewPath, input.originalPath])
})

test("missing legacy previews repair once or fall back without concealing auth and storage errors", async () => {
    for (const succeeds of [true, false]) {
        let prepares = 0
        const paths: string[] = []
        const result = await loadCommunicationMediaRepresentation({ originalPath: "original", previewPath: "preview", preview: true, method: "GET", load: async (path) => { paths.push(path); return new Response(null, { status: paths.length === 1 ? 404 : 200 }) }, prepare: async () => { prepares++; if (!succeeds) throw new Error("Resize failed"); return true } })
        assert.equal(prepares, 1)
        assert.deepEqual(paths, ["preview", succeeds ? "preview" : "original"])
        assert.equal(result.response.status, 200)
    }
    for (const status of [304, 403, 500]) {
        let prepares = 0
        const result = await loadCommunicationMediaRepresentation({ originalPath: "original", previewPath: "preview", preview: true, method: "GET", load: async () => new Response(null, { status }), prepare: async () => { prepares++; return true } })
        assert.equal(result.response.status, status)
        assert.equal(prepares, 0)
    }
})

test("inbound previews rotate and bound images before publication without altering unsupported files", async () => {
    const bytes = await sharp({ create: { width: 1600, height: 800, channels: 3, background: "red" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const prepared = await prepareStoredCommunicationImage(bytes, "image/jpeg")
    assert.equal(prepared?.width, 800)
    assert.equal(prepared?.height, 1600)
    const preview = await sharp(prepared!.preview!).metadata()
    assert.equal(preview.format, "webp")
    assert.equal(preview.width, 480)
    assert.equal(preview.height, 960)
    assert.equal(await prepareStoredCommunicationImage(bytes, "application/pdf"), null)
    assert.equal(await prepareStoredCommunicationImage(Buffer.from("not an image"), "image/jpeg"), null)
})

test("history cursors retain microseconds and require a valid complete pair", () => {
    const cursor = { createdAt: "2026-09-10T12:00:00.123456+00:00", id: "12345678-1234-4234-9234-123456789abc" }
    assert.deepEqual(communicationHistoryCursor(cursor), cursor)
    assert.equal(communicationHistoryCursor({ ...cursor, id: "bad" }), null)
    assert.equal(communicationHistoryCursor({ ...cursor, createdAt: "bad" }), null)
    assert.deepEqual(communicationHistoryPage({ messages: [{ id: "new" }, { id: "old" }], nextBefore: cursor, hasMore: true }, (value) => value), { messages: [{ id: "old" }, { id: "new" }], nextBefore: cursor, hasMore: true })
    assert.throws(() => communicationHistoryPage({ messages: [], hasMore: true, nextBefore: null }, (value) => value), /cursor/)
})

test("new legacy preview bytes are delivered without downloading the stored derivative again", async () => {
    const paths: string[] = []
    const bytes = new Uint8Array([82, 73, 70, 70])
    const result = await loadCommunicationMediaRepresentation({
        originalPath: "original", previewPath: "preview", preview: true, method: "GET",
        load: async (path) => { paths.push(path); return new Response(null, { status: 404 }) },
        prepare: async () => new Response(bytes, { headers: { "Content-Type": "image/webp", "Content-Length": "4" } }),
    })
    assert.deepEqual(paths, ["preview"])
    assert.equal(result.deliveryPath, "preview")
    assert.equal(result.response.headers.get("content-type"), "image/webp")
    assert.deepEqual(new Uint8Array(await result.response.arrayBuffer()), bytes)
})
