import assert from "node:assert/strict"
import test from "node:test"
import { saveAssetArchive, type ArchiveFileHandle } from "../lib/assets/save-archive.ts"

const href = "/api/workspaces/fixture/assets/download?ids=first,second"
const zipHeaders = { "content-type": "application/zip" }
const signal = () => new AbortController().signal
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve))

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
}

function destination(sink: UnderlyingSink<Uint8Array> = {}): ArchiveFileHandle {
    return { createWritable: async () => new WritableStream<Uint8Array>(sink) }
}

test("archive save streams exact binary bytes through one credentialed request without buffering", async t => {
    const chunks = [new Uint8Array([0, 255, 80, 75]), new Uint8Array([3]), new Uint8Array([4, 128, 0, 254])]
    let index = 0
    const response = new Response(new ReadableStream<Uint8Array>({
        pull(output) {
            if (index === chunks.length) output.close()
            else output.enqueue(chunks[index++])
        },
    }), { headers: { "content-type": "application/zip; charset=binary" } })
    for (const method of ["arrayBuffer", "blob", "text", "json", "clone"] as const) {
        t.mock.method(response, method, () => { throw new Error("The archive must remain streamed") })
    }
    let fetched = 0, saving = 0, closed = 0
    const received: number[] = []
    const fetchMock = t.mock.method(globalThis, "fetch", async (input: string | URL | Request, options?: RequestInit) => {
        fetched++
        assert.equal(input, href)
        assert.equal(options?.credentials, "same-origin")
        assert.equal(options?.cache, "no-store")
        assert.equal(options?.redirect, "error", "sign-in or storage redirects must not become saved files")
        assert.ok(options?.signal instanceof AbortSignal)
        return response
    })
    await saveAssetArchive({ href, signal: signal(), onSaving: () => { saving++ }, file: destination({
        write(chunk) { assert.equal(saving, 1); received.push(...chunk) },
        close() { closed++ },
    }) })
    assert.deepEqual(received, chunks.flatMap(chunk => [...chunk]))
    assert.equal(fetched, 1)
    assert.equal(fetchMock.mock.callCount(), 1)
    assert.equal(saving, 1)
    assert.equal(closed, 1)
})

test("archive save reports completion only after the destination closes", { timeout: 2000 }, async t => {
    const closing = deferred(), releaseClose = deferred()
    let completed = false
    t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([80, 75]), { headers: zipHeaders }))
    const pending = saveAssetArchive({ href, signal: signal(), onSaving() {}, file: destination({
        close() { closing.resolve(); return releaseClose.promise },
    }) }).then(() => { completed = true })
    try {
        await closing.promise
        await nextTurn()
        assert.equal(completed, false, "received bytes alone do not establish a committed local save")
    } finally {
        releaseClose.resolve()
        await pending
    }
    assert.equal(completed, true)
})

test("denied destination permission and an already aborted request never fetch bytes", async t => {
    const fetched = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected transfer") })
    const denied = new DOMException("Destination permission denied", "NotAllowedError")
    let saving = 0, opened = 0
    await assert.rejects(saveAssetArchive({ href, signal: signal(), onSaving: () => { saving++ }, file: {
        async createWritable() { opened++; throw denied },
    } }), error => error === denied)
    const abort = new AbortController()
    const reason = new DOMException("Library closed", "AbortError")
    abort.abort(reason)
    await assert.rejects(saveAssetArchive({ href, signal: abort.signal, onSaving: () => { saving++ }, file: {
        async createWritable() { opened++; return new WritableStream<Uint8Array>() },
    } }), error => error === reason)
    assert.equal(opened, 1)
    assert.equal(fetched.mock.callCount(), 0)
    assert.equal(saving, 0)
})

test("a writable returned after cancellation is discarded without starting a transfer", { timeout: 2000 }, async t => {
    const opened = deferred(), writable = deferred<WritableStream<Uint8Array>>()
    const abort = new AbortController()
    const reason = new DOMException("Library closed", "AbortError")
    let cancelled = 0, saving = 0
    const fetched = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected transfer") })
    const pending = saveAssetArchive({ href, signal: abort.signal, onSaving: () => { saving++ }, file: {
        createWritable() { opened.resolve(); return writable.promise },
    } })
    const rejected = assert.rejects(pending, error => error === reason)
    await opened.promise
    abort.abort(reason)
    writable.resolve(new WritableStream<Uint8Array>({ abort() { cancelled++; return new Promise<void>(() => {}) } }))
    await rejected
    assert.equal(fetched.mock.callCount(), 0)
    assert.equal(cancelled, 1)
    assert.equal(saving, 0)
})

test("HTTP failures keep actionable errors and release bodies and destinations without waiting on cancellation", { timeout: 3000 }, async t => {
    for (const [status, expected] of [
        [403, /no longer available/], [404, /no longer available/], [413, /500 MB/], [503, /Try again, or use Download/],
    ] as const) {
        await t.test(String(status), async subtest => {
            let bodyCancelled = 0, destinationAborted = 0, saving = 0, writes = 0
            const response = new Response(new ReadableStream<Uint8Array>({
                start(output) { output.enqueue(new TextEncoder().encode("private provider diagnostics")) },
                cancel() { bodyCancelled++; return new Promise<void>(() => {}) },
            }), { status, headers: zipHeaders })
            const fetched = subtest.mock.method(globalThis, "fetch", async () => response)
            await assert.rejects(saveAssetArchive({ href, signal: signal(), onSaving: () => { saving++ }, file: destination({
                write() { writes++ },
                abort() { destinationAborted++; return new Promise<void>(() => {}) },
            }) }), expected)
            assert.equal(fetched.mock.callCount(), 1)
            assert.equal(bodyCancelled, 1)
            assert.equal(destinationAborted, 1)
            assert.equal(saving, 0)
            assert.equal(writes, 0)
        })
    }
})

test("successful HTML, missing ZIP content type, and bodyless responses are never saved", async t => {
    for (const [name, response] of [
        ["sign-in HTML", new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } })],
        ["missing content type", new Response(new Uint8Array([80, 75]))],
        ["no body", new Response(null, { headers: zipHeaders })],
    ] as const) {
        await t.test(name, async subtest => {
            let aborted = 0, writes = 0, saving = 0
            subtest.mock.method(globalThis, "fetch", async () => response)
            await assert.rejects(saveAssetArchive({ href, signal: signal(), onSaving: () => { saving++ }, file: destination({
                write() { writes++ }, abort() { aborted++ },
            }) }), /Try again, or use Download/)
            assert.equal(aborted, 1)
            assert.equal(writes, 0)
            assert.equal(saving, 0)
        })
    }
})

test("redirect or network rejection aborts the destination without an automatic second request", async t => {
    const failure = new TypeError("Redirect is not allowed")
    let aborted = 0, saving = 0
    const fetched = t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, options?: RequestInit) => {
        assert.equal(options?.redirect, "error")
        throw failure
    })
    await assert.rejects(saveAssetArchive({ href, signal: signal(), onSaving: () => { saving++ }, file: destination({
        abort() { aborted++ },
    }) }), error => error === failure)
    assert.equal(fetched.mock.callCount(), 1)
    assert.equal(aborted, 1)
    assert.equal(saving, 0)
})

test("an interrupted archive aborts its file rather than completing a partial save", async t => {
    const failure = new Error("The ZIP stream was interrupted")
    let pulls = 0, closed = 0
    let aborted: unknown
    t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream<Uint8Array>({
        pull(output) {
            if (++pulls === 1) output.enqueue(new Uint8Array([80, 75]))
            else output.error(failure)
        },
    }), { headers: zipHeaders }))
    await assert.rejects(saveAssetArchive({ href, signal: signal(), onSaving() {}, file: destination({
        close() { closed++ }, abort(reason) { aborted = reason },
    }) }), error => error === failure)
    assert.equal(aborted, failure)
    assert.equal(closed, 0)
})

test("destination write failure cancels the upstream stream and never reports success", async t => {
    const failure = new Error("Disk is full")
    let cancelled: unknown
    let closed = 0
    t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream<Uint8Array>({
        pull(output) { output.enqueue(new Uint8Array([80, 75])) },
        cancel(reason) { cancelled = reason },
    }), { headers: zipHeaders }))
    await assert.rejects(saveAssetArchive({ href, signal: signal(), onSaving() {}, file: destination({
        write() { throw failure }, close() { closed++ },
    }) }), error => error === failure)
    assert.equal(cancelled, failure)
    assert.equal(closed, 0)
})

test("destination close failure is a failed save even after all archive bytes arrive", async t => {
    const failure = new Error("Could not commit the local file")
    let written = 0
    t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([80, 75, 3, 4]), { headers: zipHeaders }))
    await assert.rejects(saveAssetArchive({ href, signal: signal(), onSaving() {}, file: destination({
        write(chunk) { written += chunk.byteLength }, close() { throw failure },
    }) }), error => error === failure)
    assert.equal(written, 4)
})

test("cancellation stops an active archive source and aborts the local destination", { timeout: 2000 }, async t => {
    const abort = new AbortController()
    const reason = new DOMException("Save cancelled", "AbortError")
    const wrote = deferred()
    let pulls = 0, writes = 0, closed = 0
    let cancelled: unknown, destinationAborted: unknown, requestSignal: AbortSignal | null | undefined
    const fetched = t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, options?: RequestInit) => {
        requestSignal = options?.signal
        return new Response(new ReadableStream<Uint8Array>({
            pull(output) {
                if (++pulls === 1) output.enqueue(new Uint8Array(64 * 1024))
                else return new Promise<void>(() => {})
            },
            cancel(value) { cancelled = value },
        }), { headers: zipHeaders })
    })
    const pending = saveAssetArchive({ href, signal: abort.signal, onSaving() {}, file: destination({
        write() { writes++; wrote.resolve() }, abort(value) { destinationAborted = value }, close() { closed++ },
    }) })
    const rejected = assert.rejects(pending, error => error === reason)
    await wrote.promise
    abort.abort(reason)
    await rejected
    assert.equal(cancelled, reason)
    assert.equal(destinationAborted, reason)
    assert.equal(requestSignal?.aborted, true)
    assert.equal(fetched.mock.callCount(), 1)
    assert.equal(writes, 1)
    assert.equal(closed, 0)
    const finalPulls = pulls
    await nextTurn()
    assert.equal(pulls, finalPulls)
})

test("a slow destination applies backpressure instead of consuming the whole archive", { timeout: 2000 }, async t => {
    const firstWrite = deferred(), releaseWrite = deferred()
    const chunkBytes = 64 * 1024, chunkCount = 64
    let chunksRead = 0, writes = 0, bytesWritten = 0
    t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream<Uint8Array>({
        pull(output) {
            if (chunksRead === chunkCount) output.close()
            else { chunksRead++; output.enqueue(new Uint8Array(chunkBytes)) }
        },
    }), { headers: zipHeaders }))
    const pending = saveAssetArchive({ href, signal: signal(), onSaving() {}, file: destination({
        write(chunk) {
            writes++; bytesWritten += chunk.byteLength
            if (writes === 1) { firstWrite.resolve(); return releaseWrite.promise }
        },
    }) })
    try {
        await firstWrite.promise
        await nextTurn()
        assert.equal(writes, 1)
        assert.ok(chunksRead <= 2, `A blocked writer pulled ${chunksRead} chunks`)
    } finally {
        releaseWrite.resolve()
        await pending
    }
    assert.equal(chunksRead, chunkCount)
    assert.equal(bytesWritten, chunkBytes * chunkCount)
})
