import assert from "node:assert/strict"
import test from "node:test"
import { uploadBuilderVideo } from "../lib/onboarding/builder-video-upload.ts"

class FakeXHR {
    static latest: FakeXHR
    upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null }
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    status = 200
    headers: Record<string, string> = {}
    method = ""
    url = ""
    body: File | null = null
    constructor() { FakeXHR.latest = this }
    open(method: string, url: string) { this.method = method; this.url = url }
    setRequestHeader(key: string, value: string) { this.headers[key] = value }
    send(body: File) { this.body = body }
}

Object.defineProperty(globalThis, "XMLHttpRequest", { value: FakeXHR, configurable: true })

test("Builder video upload reports bytes and waits for storage acknowledgement before 100 percent", async () => {
    const values: number[] = []
    const file = new File(["video"], "welcome.mp4", { type: "video/mp4" })
    const upload = uploadBuilderVideo({ uploadUrl: "/signed-put", file, onProgress: (value) => values.push(value) })
    const xhr = FakeXHR.latest
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 })
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 4 })
    assert.deepEqual(values, [0, 25, 99])
    assert.equal(xhr.method, "PUT")
    assert.equal(xhr.url, "/signed-put")
    assert.equal(xhr.headers["Content-Type"], "video/mp4")
    assert.equal(xhr.body, file)
    xhr.onload?.()
    await upload
    assert.deepEqual(values, [0, 25, 99, 100])
})

test("Builder video upload rejects a storage failure", async () => {
    const file = new File(["video"], "welcome.mp4", { type: "video/mp4" })
    const upload = uploadBuilderVideo({ uploadUrl: "/signed-put", file, onProgress: () => undefined })
    FakeXHR.latest.status = 503
    FakeXHR.latest.onload?.()
    await assert.rejects(upload, /HTTP 503/u)
})
