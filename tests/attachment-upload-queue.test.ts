import assert from "node:assert/strict"
import test from "node:test"
import { createAttachmentUploadQueue } from "../lib/communications/attachment-upload-queue.ts"

const file = (name: string) => new File(["test"], name, { type: "image/png" })
const attachment = (name: string) => ({ kind: "image" as const, fileName: name, mimeType: "image/png", storagePath: name, url: `/media/${name}`, size: 4 })
const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture() {
    let id = 0
    const pending: Array<{ item: { id: string; conversationId: string; file: File }; signal: AbortSignal; progress: (value: number) => void; preview: (url: string) => void; resolve: (value: ReturnType<typeof attachment>) => void; reject: (error: Error) => void }> = []
    const removed: string[] = [], revoked: string[] = []
    const queue = createAttachmentUploadQueue({
        id: () => String(++id),
        remove: async (conversation, value) => { removed.push(`${conversation}:${value.storagePath}`) },
        revokePreview: (url) => { revoked.push(url) },
        upload: (item, signal, progress, preview) => new Promise((resolve, reject) => { pending.push({ item, signal, progress, preview, resolve, reject }) }),
    })
    return { queue, pending, removed, revoked }
}

test("multiple selections preserve order, bound uploads, and isolate progress from chat renders", async () => {
    const { queue, pending } = fixture()
    queue.add("a", [file("one"), file("two")])
    queue.add("a", [file("three")])
    assert.equal(pending.length, 1)
    const summary = queue.getSummary("a")
    let chatRenders = 0, trayRenders = 0
    queue.subscribeSummary(() => chatRenders++)
    queue.subscribe(() => trayRenders++)
    for (let i = 1; i <= 90; i++) pending[0].progress(i)
    assert.equal(queue.getSummary("a"), summary)
    assert.equal(chatRenders, 0)
    assert.equal(trayRenders, 90)
    pending[0].resolve(attachment("one")); await tick()
    assert.equal(pending.length, 2)
    pending[1].resolve(attachment("two")); await tick()
    pending[2].resolve(attachment("three")); await tick()
    assert.deepEqual(queue.getSummary("a").attachments.map((item) => item.fileName), ["one", "two", "three"])
    assert.equal(queue.getSummary("a").blocked, false)
})

test("switching chats, cancelling in flight, and late responses never attach to another draft", async () => {
    const { queue, pending, removed, revoked } = fixture()
    queue.add("a", [file("one")]); queue.add("b", [file("two")])
    pending[0].preview("blob:one")
    queue.remove(pending[0].item.id)
    assert.equal(pending[0].signal.aborted, true)
    pending[0].resolve(attachment("one")); await tick()
    assert.deepEqual(removed, ["a:one"])
    assert.deepEqual(revoked, ["blob:one"])
    assert.equal(queue.getSummary("a").count, 0)
    pending[1].resolve(attachment("two")); await tick()
    assert.equal(queue.getSummary("b").attachments[0].fileName, "two")
})

test("failed files block partial sends and retry without uploading completed siblings", async () => {
    const { queue, pending } = fixture()
    queue.add("a", [file("one"), file("two")])
    pending[0].resolve(attachment("one")); await tick()
    pending[1].reject(new Error("Connection lost")); await tick()
    assert.equal(queue.getSummary("a").blocked, true)
    assert.equal(queue.getSummary("a").attachments.length, 1)
    queue.retry(pending[1].item.id)
    assert.equal(pending[2].item.file.name, "two")
    pending[2].resolve(attachment("two")); await tick()
    assert.equal(queue.getSummary("a").blocked, false)
})

test("sending consumes only its snapshot; other chats and new files remain, without deleting sent files", async () => {
    const { queue, pending, removed } = fixture()
    queue.add("a", [file("one")]); pending[0].resolve(attachment("one")); await tick()
    const sent = queue.getSummary("a").attachments
    queue.add("a", [file("two")]); queue.add("b", [file("three")])
    queue.consume("a", sent)
    assert.deepEqual(removed, [])
    assert.equal(queue.getSummary("a").count, 1)
    assert.equal(queue.getSummary("b").count, 1)
    assert.match(queue.add("a", Array.from({ length: 10 }, () => file("extra"))) ?? "", /up to 10/)
})

test("disposal aborts work and cleans up late completions", async () => {
    const { queue, pending, removed, revoked } = fixture()
    queue.add("a", [file("one"), file("two")]); pending[0].preview("blob:one")
    queue.dispose()
    assert.equal(pending[0].signal.aborted, true)
    pending[0].resolve(attachment("one")); await tick()
    assert.equal(pending.length, 1)
    assert.deepEqual(revoked, ["blob:one"])
    assert.deepEqual(removed, ["a:one"])
})


test("a pending durable send holds files against removal until accepted or released", async () => {
    const { queue, pending, removed } = fixture()
    queue.add("a", [file("one")]); pending[0].resolve(attachment("one")); await tick()
    const release = queue.hold(queue.getSummary("a").attachments)
    queue.remove(pending[0].item.id)
    assert.equal(queue.getSummary("a").count, 1)
    assert.equal(removed.length, 0)
    release(); queue.remove(pending[0].item.id)
    assert.equal(queue.getSummary("a").count, 0)
    assert.deepEqual(removed, ["a:one"])
})
