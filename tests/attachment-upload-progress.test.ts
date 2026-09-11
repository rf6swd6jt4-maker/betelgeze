import assert from "node:assert/strict"
import test from "node:test"
import { uploadWithProgress } from "../lib/communications/upload-progress.ts"

class FakeXHR {
    static latest: FakeXHR
    upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null }
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    ontimeout: (() => void) | null = null
    onabort: (() => void) | null = null
    status = 200
    timeout = 0
    headers: Record<string, string> = {}
    aborted = false
    constructor() { FakeXHR.latest = this }
    open() {}
    setRequestHeader(key: string, value: string) { this.headers[key] = value }
    send() {}
    abort() { this.aborted = true; this.onabort?.() }
}

Object.defineProperty(globalThis, "XMLHttpRequest", { value: FakeXHR, configurable: true })

test("upload progress is real, monotonic for reported bytes and never claims completion before acknowledgement", async () => {
    const values: number[] = []
    const upload = uploadWithProgress("/put", new Blob(["test"]), { "Content-Type": "image/png", "x-amz-key": "key" }, new AbortController().signal, (value) => values.push(value))
    const xhr = FakeXHR.latest
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 })
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 })
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 4 })
    assert.deepEqual(values, [25, 99])
    assert.equal(xhr.headers["x-amz-key"], "key")
    xhr.onload?.(); await upload
    assert.equal(xhr.upload.onprogress, null)
})

test("failed and cancelled uploads reject instead of showing ready", async () => {
    const controller = new AbortController()
    const upload = uploadWithProgress("/put", new Blob(), {}, controller.signal, () => {})
    controller.abort()
    await assert.rejects(upload, { name: "AbortError" })
    assert.equal(FakeXHR.latest.aborted, true)
    const failed = uploadWithProgress("/put", new Blob(), {}, new AbortController().signal, () => {})
    FakeXHR.latest.status = 503; FakeXHR.latest.onload?.()
    await assert.rejects(failed, /Retry this file/)
})
