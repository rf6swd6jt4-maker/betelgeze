import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js"
import * as zipWriter from "@zip.js/zip.js/lib/zip-core-writer.js"
import * as download from "../lib/assets/download.ts"
import type { DownloadableAsset } from "../lib/assets/download.ts"

type Values = Record<string, unknown>
const workspace = "10000000-0000-4000-8000-000000000001"
const asset: DownloadableAsset = { id: "10000000-0000-4000-8000-000000000002", workspace_id: workspace, title: "Asset", content_type: "image/png", file_size: 3, source_kind: "upload", native_kind: "manual_upload", storage_path: `${workspace}/assets/user/file/original` }
const second = { ...asset, id: "10000000-0000-4000-8000-000000000003", title: "asset" }
function load(path: string, mocks: Values, fixtureFetch?: typeof fetch): Values {
    const exports = {}
    const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("require", "exports", "fetch", code)((name: string) => { assert.ok(name in mocks, `Unexpected dependency ${name}`); return mocks[name] }, exports, fixtureFetch)
    return exports
}
function responseHarness(options: { fetch?: typeof fetch; message?: (request: Request) => Promise<Response>; image?: () => Promise<Response> } = {}) {
    const signed: string[] = []
    const functions = load("lib/assets/download-response.ts", {
        "server-only": {}, "./download": download, "@zip.js/zip.js/lib/zip-core-writer.js": zipWriter,
        "@/lib/onboarding/uploads": { createPrivateResourceDownloadUrl: async (path: string, name: string) => { signed.push(`${path}:${name}`); return `https://storage.test/${encodeURIComponent(path)}` } },
        "@/app/api/client-messages/media/[...path]/route": { GET: options.message },
        "@/app/api/workspaces/[workspaceSlug]/sop-images/[assetId]/route": { GET: options.image },
    }, options.fetch)
    return { signed, single: functions.assetDownloadResponse as (slug: string, value: DownloadableAsset, request: Request) => Promise<Response>, archive: functions.assetArchiveResponse as (slug: string, values: DownloadableAsset[], request: Request) => Promise<Response> }
}
const request = () => new Request("https://app.test/api/workspaces/alpha/assets/download")

test("download eligibility and filenames reject foreign/traversal paths and preserve useful extensions", () => {
    assert.equal(download.assetDownloadHref("alpha", asset), `/api/workspaces/alpha/assets/${asset.id}/download`)
    for (const path of [null, "foreign/file", `${workspace}/../file`, `${workspace}//file`, `${workspace}/a\\b`]) assert.equal(download.downloadableAsset({ ...asset, storage_path: path }), false)
    assert.equal(download.assetDownloadFilename(asset), "Asset.png")
    const unicode = download.assetDownloadFilename({ ...asset, title: "a".repeat(199) + "😀" })
    assert.ok(unicode.endsWith("😀.png"))
    assert.doesNotThrow(() => download.assetAttachmentDisposition(unicode))
    assert.doesNotThrow(() => download.assetAttachmentDisposition(download.assetDownloadFilename({ ...asset, title: "Broken\ud800" })))
    assert.deepEqual(download.uniqueAssetDownloadNames([asset, second, { ...asset, title: "Asset (2).png" }]), ["Asset.png", "asset (2).png", "Asset (2) (2).png"])
    const name = download.assetDownloadFilename({ ...asset, title: '../資料\r\n"photo"' })
    const header = download.assetAttachmentDisposition(name)
    assert.ok(!/[\r\n]/.test(header)); assert.match(header, /filename\*=UTF-8''/); assert.ok(!name.includes("/"))
    assert.equal(download.parseAssetDownloadIds(`${asset.id},${second.id}`)?.length, 2)
    for (const raw of [null, "", asset.id + "," + asset.id, "fake", Array.from({ length: 25 }, () => asset.id).join(",")]) assert.equal(download.parseAssetDownloadIds(raw), null)
})

test("all stored asset families download; messages and SOP images retain canonical media authorization", async () => {
    let images = 0
    const fixture = responseHarness({ image: async () => { images++; return new Response("image", { headers: { "content-length": "5" } }) } })
    for (const native_kind of ["manual_upload", "onboarding_upload", "client_portal_resource", "sop_upload", "relationship_context", null]) {
        const result = await fixture.single("alpha", { ...asset, native_kind }, request())
        assert.equal(result.status, 303)
        assert.match(result.headers.get("location")!, /^https:\/\/storage.test\//)
    }
    const message = await fixture.single("alpha", { ...asset, source_kind: "message" }, request())
    assert.equal(message.status, 303)
    assert.equal(message.headers.get("location"), `/api/client-messages/media/${asset.storage_path}?download=Asset.png`)
    const image = await fixture.single("alpha", { ...asset, native_kind: "sop_extracted_image" }, request())
    assert.equal(await image.text(), "image"); assert.equal(images, 1)
    assert.match(image.headers.get("content-disposition")!, /^attachment;/)
    assert.equal(fixture.signed.length, 6, "special media receives no newly signed storage credentials")
    assert.equal((await fixture.single("alpha", { ...asset, storage_path: "foreign/file" }, request())).status, 404)
})

test("ZIP downloads preserve bytes and Unicode names, load sequentially, and use unique entry names", async () => {
    let active = 0, maximum = 0, calls = 0
    const fixture = responseHarness({ fetch: (async () => {
        calls++; active++; maximum = Math.max(maximum, active)
        let emitted = false
        return new Response(new ReadableStream({ pull(controller) { if (!emitted) { emitted = true; controller.enqueue(new Uint8Array([0, 255, calls])) } else { active--; controller.close() } } }), { headers: { "content-length": "3" } })
    }) as typeof fetch })
    const response = await fixture.archive("alpha", [asset, second, { ...asset, title: "資料.png" }], request())
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store")
    const reader = new ZipReader(new BlobReader(await response.blob()), { useWebWorkers: false })
    const entries = await reader.getEntries()
    assert.deepEqual(entries.map(entry => entry.filename), ["Asset.png", "asset (2).png", "資料.png"])
    for (let i = 0; i < entries.length; i++) assert.deepEqual(await entries[i].getData!(new Uint8ArrayWriter(), { checkSignature: true }), new Uint8Array([0, 255, i + 1]))
    assert.equal(maximum, 1); assert.equal(calls, 3)
    await reader.close()
})

test("ZIP source failure and inconsistent lengths abort the archive rather than returning a successful subset", async () => {
    const failed = responseHarness({ fetch: (async () => new Response("missing", { status: 404 })) as typeof fetch })
    assert.equal((await failed.archive("alpha", [asset, second], request())).status, 404)
    let calls = 0
    const partial = responseHarness({ fetch: (async () => ++calls === 1 ? new Response("one", { headers: { "content-length": "3" } }) : new Response("missing", { status: 404 })) as typeof fetch })
    await assert.rejects((await partial.archive("alpha", [asset, second], request())).arrayBuffer())
    const truncated = responseHarness({ fetch: (async () => new Response("bad", { headers: { "content-length": "30" } })) as typeof fetch })
    await assert.rejects((await truncated.archive("alpha", [asset, second], request())).arrayBuffer(), /incomplete/)
    const oversized = responseHarness({ fetch: (async () => new Response("data", { headers: { "content-length": String(download.MAX_ASSET_ARCHIVE_BYTES + 1) } })) as typeof fetch })
    await assert.rejects((await oversized.archive("alpha", [asset, second], request())).arrayBuffer(), /500MB/)
})

test("cancelling a ZIP stops the active source and never fetches the next file", async () => {
    let calls = 0, cancelled = false
    const fixture = responseHarness({ fetch: (async () => {
        calls++
        return new Response(new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(64 * 1024)) }, cancel() { cancelled = true } }))
    }) as typeof fetch })
    const response = await fixture.archive("alpha", [asset, second], request())
    const reader = response.body!.getReader()
    await reader.read(); await reader.cancel()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(cancelled, true); assert.equal(calls, 1)
})

test("bulk route authorizes one bounded RLS selection before storage and rejects partial/revoked/cross-workspace selections", async () => {
    let rows = [asset, second], error: unknown = null, permitted = true, reads = 0, archives = 0
    const constraints: Array<[string, unknown]> = []
    const query = { select() { return this }, eq(key: string, value: unknown) { constraints.push([key, value]); return this }, in(key: string, value: unknown) { constraints.push([key, value]); return this }, async limit(value: number) { constraints.push(["limit", value]); reads++; return { data: rows, error } } }
    const route = load("app/api/workspaces/[workspaceSlug]/assets/download/route.ts", {
        "@/lib/workspace-access": { requireWorkspaceAccess: async () => ({ workspace: { id: workspace }, access: {} }), workspaceAccessHasCapability: () => permitted },
        "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ from: (table: string) => { assert.equal(table, "assets"); return query } }) },
        "@/lib/assets/download": download,
        "@/lib/assets/download-response": { assetDownloadHeaders: { "Cache-Control": "private, no-store" }, assetArchiveResponse: async (_slug: string, selection: DownloadableAsset[]) => { archives++; assert.deepEqual(selection.map(value => value.id), [asset.id, second.id]); return new Response("zip") } },
    }).GET as (request: Request, context: unknown) => Promise<Response>
    const get = (ids = `${asset.id},${second.id}`) => route(new Request(`https://app.test/download?ids=${ids}`), { params: Promise.resolve({ workspaceSlug: "alpha" }) })
    assert.equal((await get()).status, 200); assert.equal(reads, 1); assert.equal(archives, 1)
    assert.deepEqual(constraints, [["workspace_id", workspace], ["id", [asset.id, second.id]], ["limit", 2]])
    rows = [asset]; assert.equal((await get()).status, 404)
    rows = [asset, { ...second, workspace_id: "foreign" }]; assert.equal((await get()).status, 404)
    rows = [asset, { ...second, storage_path: "foreign/file" }]; assert.equal((await get()).status, 404)
    rows = [asset, { ...second, file_size: download.MAX_ASSET_ARCHIVE_BYTES }]; assert.equal((await get()).status, 413)
    error = new Error("private"); assert.equal((await get()).status, 503)
    assert.equal(archives, 1)
    permitted = false; const before = reads; assert.equal((await get()).status, 404); assert.equal(reads, before)
    permitted = true; assert.equal((await get("bad")).status, 400); assert.equal(reads, before)
})

test("aborting delayed canonical media headers settles promptly and cancels a late body without awaiting a tee", { timeout: 2000 }, async () => {
    let resolveMedia!: (response: Response) => void
    let started!: () => void
    const called = new Promise<void>(resolve => { started = resolve })
    const controller = new AbortController()
    let cancelled = false
    const fixture = responseHarness({ message: async () => { started(); return new Promise<Response>(resolve => { resolveMedia = resolve }) } })
    const pending = fixture.archive("alpha", [{ ...asset, source_kind: "message" }, second], new Request(request(), { signal: controller.signal }))
    await called
    controller.abort(new Error("Download cancelled"))
    assert.equal((await pending).status, 503)
    resolveMedia(new Response(new ReadableStream({ cancel() { cancelled = true; return new Promise<void>(() => {}) } })))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(cancelled, true)
})

test("nonempty failed storage responses with pending cancellation never block the error response", { timeout: 2000 }, async () => {
    let cancelled = false
    const fixture = responseHarness({ fetch: (async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("storage error")) }, cancel() { cancelled = true; return new Promise<void>(() => {}) } }), { status: 404 })) as typeof fetch })
    const response = await fixture.archive("alpha", [asset, second], request())
    assert.equal(response.status, 404); assert.equal(cancelled, true)
})
