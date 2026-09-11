import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import ts from "typescript"
import { loadCommunicationMediaRepresentation } from "../lib/communications/media-http.ts"

const require = createRequire(import.meta.url)
const { cloneResponse } = require("next/dist/server/lib/clone-response.js") as {
    cloneResponse: (response: Response) => [Response, Response]
}

test("missing preview with Next.js's cloned error body reaches preparation without waiting for the retained branch", async () => {
    const [response, retained] = cloneResponse(new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 }))
    let prepared = false
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        const pending = loadCommunicationMediaRepresentation({
            originalPath: "original", previewPath: "preview", preview: true, method: "GET",
            load: async () => response,
            prepare: async () => { prepared = true; return new Response("thumbnail") },
        })
        const result = await Promise.race([
            pending,
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Blocked on cloned 404 body")), 200) }),
        ])
        assert.equal(prepared, true)
        assert.equal(await result.response.text(), "thumbnail")
    } finally {
        clearTimeout(timer)
        await retained.text()
    }
})

test("a stalled preview fetch or preparation aborts and falls back once with an independent original lifetime", async () => {
    for (const stalled of ["lookup", "prepare"]) {
        let previewSignal: AbortSignal | undefined
        const paths: string[] = []
        let finish!: (value: Response) => void
        const late = new Promise<Response>((resolve) => { finish = resolve })
        const result = await loadCommunicationMediaRepresentation({
            originalPath: "original", previewPath: "preview", preview: true, method: "GET", previewTimeoutMs: 20,
            load: async (path, signal) => {
                paths.push(path)
                if (path === "original") { assert.equal(signal, undefined); return new Response("original") }
                previewSignal = signal
                return stalled === "lookup" ? late : new Response("missing", { status: 404 })
            },
            prepare: async (signal) => { assert.equal(signal, previewSignal); return late },
        })
        assert.equal(previewSignal?.aborted, true)
        assert.equal(await result.response.text(), "original")
        assert.deepEqual(paths, ["preview", "original"])
        let discarded = false
        finish(new Response(new ReadableStream({ cancel() { discarded = true } })))
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(discarded, true)
        assert.deepEqual(paths, ["preview", "original"])
    }
})

test("a successful preview clears its deadline without aborting the returned body", async () => {
    let previewSignal: AbortSignal | undefined
    const result = await loadCommunicationMediaRepresentation({
        originalPath: "original", previewPath: "preview", preview: true, method: "GET", previewTimeoutMs: 10,
        load: async (_, signal) => { previewSignal = signal; return new Response("thumbnail") },
        prepare: async () => { throw new Error("Must not prepare") },
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(previewSignal?.aborted, false)
    assert.equal(await result.response.text(), "thumbnail")
})

test("expired preview generation destroys the original stream, releases deduplication and passes the signal to R2", async () => {
    const source = await readFile("lib/onboarding/uploads.ts", "utf8")
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    let destroyCount = 0
    let getCount = 0
    let putCount = 0
    let rejectBody!: (error: Error) => void
    const controller = new AbortController()
    const pendingBytes = new Promise<Uint8Array>((_, reject) => { rejectBody = reject })
    class GetObjectCommand {}
    class PutObjectCommand {}
    const mocks: Record<string, unknown> = {
        crypto: require("node:crypto"),
        "@/lib/env": { getRequiredEnv: () => "fixture" },
        "@/lib/communications/attachments": { COMMUNICATION_PREVIEW_SUFFIX: ".preview.webp" },
        "@/lib/communications/image-preview": { prepareStoredCommunicationImage: async () => ({ preview: new Uint8Array([1, 2, 3]) }) },
        "@aws-sdk/client-s3": {
            GetObjectCommand, PutObjectCommand,
            S3Client: class {
                async send(command: unknown, options: { abortSignal?: AbortSignal }) {
                    if (command instanceof PutObjectCommand) { putCount++; assert.equal(options.abortSignal?.aborted, false); return {} }
                    getCount++
                    const first = getCount === 1
                    if (first) assert.equal(options.abortSignal, controller.signal)
                    return { ContentType: "image/jpeg", ContentLength: 3, Body: {
                        transformToByteArray: () => first ? pendingBytes : Promise.resolve(new Uint8Array([1, 2, 3])),
                        destroy: () => { if (first) { destroyCount++; rejectBody(new Error("Stream destroyed")) } },
                    } }
                }
            },
        },
    }
    const exports: { ensureCommunicationImagePreview?: (path: string, key: string | null, signal: AbortSignal) => Promise<Uint8Array | null> } = {}
    new Function("require", "exports", compiled)((name: string) => mocks[name] ?? {}, exports)
    const run = exports.ensureCommunicationImagePreview!
    const first = run("private/path", null, controller.signal)
    const rejection = assert.rejects(first, /Stream destroyed/)
    await new Promise((resolve) => setImmediate(resolve))
    controller.abort()
    await rejection
    assert.ok(destroyCount > 0)
    assert.equal(putCount, 0)
    assert.deepEqual(await run("private/path", null, new AbortController().signal), new Uint8Array([1, 2, 3]))
    assert.equal(getCount, 2)
    assert.equal(putCount, 1)
})
