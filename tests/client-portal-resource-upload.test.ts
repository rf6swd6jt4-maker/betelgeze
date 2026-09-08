import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import test from "node:test"
import ts from "typescript"
import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js"
import * as zipWriter from "@zip.js/zip.js/lib/zip-core-writer.js"
import { UploadPartCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

function load(path: string, dependencies: Record<string, unknown> = {}) {
    const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const require = createRequire(resolve(path))
    const module = new Module(resolve(path)) as Module & { _compile: (code: string, path: string) => void }
    module.require = ((name: string) => name in dependencies ? dependencies[name] : name.startsWith("@/lib/") ? {} : require(name)) as typeof module.require
    module._compile(code, path)
    return module.exports
}
const forms = load("lib/onboarding/forms.ts")
const resources = load("lib/client-portal/resources.ts", { "../onboarding/forms": forms })
const selection = load("lib/client-portal/resource-selection.ts", { "@zip.js/zip.js/lib/zip-core-writer.js": zipWriter })
const transfer = load("lib/client-portal/resource-transfer.ts", { "./resources": resources, "./resource-selection": selection })
const scope = { workspaceId: "workspace", relationshipId: "relationship", sessionId: "session" }
const requestId = "00000000-0000-4000-8000-000000000001"
const notFound = () => Object.assign(new Error("Not found"), { $metadata: { httpStatusCode: 404 } })

function multipart(send: (command: any) => Promise<any>) {
    return load("lib/client-portal/resource-multipart.ts", {
        "./resources": resources,
        "@/lib/env": { getRequiredEnv: () => "test-key" },
        "@/lib/onboarding/uploads": { getR2Client: () => ({ send }), getR2BucketName: () => "test-bucket" },
        "@aws-sdk/s3-request-presigner": { getSignedUrl: async (_client: unknown, command: any) => { await send(command); return "https://storage.example/part" } },
    })
}

test("folder archives preserve nested names, arbitrary bytes, empty files, and empty dropped directories", async () => {
    const entries = [
        { path: "Project/empty/" },
        { path: "Project/資料/design.weird", file: new File([new Uint8Array([0, 255, 128, 13, 10])], "design.weird") },
        { path: "Project/other/design.weird", file: new File(["different file"], "design.weird") },
        { path: "Project/empty-file", file: new File([], "empty-file") },
    ]
    const archive = await selection.folderArchive(entries, new AbortController().signal)
    const blob = await new Response(archive.readable).blob()
    await archive.completion
    const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false })
    const actual = await reader.getEntries()
    assert.deepEqual(actual.map((entry) => entry.filename), entries.map((entry) => entry.path))
    assert.equal(actual[0].directory, true)
    assert.deepEqual(await actual[1].getData!(new Uint8ArrayWriter(), { checkSignature: true }), new Uint8Array([0, 255, 128, 13, 10]))
    assert.equal((await actual[3].getData!(new Uint8ArrayWriter())).length, 0)
    await reader.close()
})

test("folder enumeration drains every page beyond 100 entries and continues after an unreadable root", async () => {
    let page = 0
    const directory = { name: "Photos", isDirectory: true, createReader: () => ({ readEntries(resolve: (entries: any[]) => void) {
        resolve(page++ < 2 ? Array.from({ length: 101 }, (_, i) => ({ name: `${page}-${i}.bin`, isFile: true, file: (done: (file: File) => void) => done(new File(["x"], `${i}.bin`)) })) : [])
    } }) }
    const unreadable = { name: "Unreadable", isDirectory: true, createReader: () => ({ readEntries(_resolve: unknown, reject: (e: Error) => void) { reject(new Error("Cannot read")) } }) }
    const items = [directory, unreadable].map((entry) => ({ kind: "file", webkitGetAsEntry: () => entry, getAsFile: () => null }))
    const loose = new File(["ok"], "Readme")
    items.push({ kind: "file", webkitGetAsEntry: () => null as any, getAsFile: () => loose as any })
    const result = await selection.droppedResources({ items, files: [] })
    assert.equal(page, 3)
    assert.equal(result.selections.length, 2)
    assert.equal(result.selections[0].entries.length, 203)
    assert.equal(result.selections[1].file, loose)
    assert.deepEqual(result.failures, ["Unreadable"])
})

test("folder names that need normalization do not overwrite one another", async () => {
    const file = new File(["x"], "x")
    const folder = selection.folderSelection("Project", [
        { path: "Project/a\\b/" }, { path: "Project/a\\b/file", file },
        { path: "Project/a_b/" }, { path: "Project/a_b/file", file },
        { path: "Project/a_b (2)/file", file },
    ])
    assert.deepEqual(folder.entries.map((entry: any) => entry.path), ["Project/a_b/", "Project/a_b/file", "Project/a_b (2)/", "Project/a_b (2)/file", "Project/a_b (2) (2)/file"])
})

test("empty folder trees are distinguished from folders containing zero-byte files", () => {
    assert.equal(selection.resourceSelectionHasFiles(selection.folderSelection("Empty", [])), false)
    assert.equal(selection.resourceSelectionHasFiles(selection.folderSelection("Nested empty", [{ path: "Root/" }, { path: "Root/Child/" }])), false)
    const emptyFile = new File([], "empty.txt")
    assert.equal(selection.resourceSelectionHasFiles(selection.folderSelection("Project", [{ path: "Project/empty.txt", file: emptyFile }])), true)
    assert.equal(selection.resourceSelectionHasFiles(selection.fileSelection(emptyFile)), true)
})

test("an unreadable file fails the ZIP stream instead of producing a successful partial folder", { timeout: 3000 }, async () => {
    const broken = { size: 5, lastModified: 0, stream() { throw new Error("File unavailable") } }
    const archive = await selection.folderArchive([{ path: "Folder/broken", file: broken }], new AbortController().signal)
    await assert.rejects(new Response(archive.readable).arrayBuffer(), /File unavailable/)
    await assert.rejects(archive.completion, /File unavailable/)
})

test("multipart tickets bind the file, path, part size, relationship, session, and lifetime", async () => {
    const module = multipart(async () => ({ UploadId: "upload-id" }))
    const ticket = await module.startResourceMultipart(scope, { name: "資料.zip", type: "application/zip", size: 20_000_000, folder: true, requestId })
    assert.ok(module.validResourceTicket(ticket, scope, "test-key"))
    for (const changed of [{ path: "workspace/client-portal/other/session/file" }, { uploadId: "other" }, { name: "changed" }, { expectedSize: 100 }, { partSize: 1 }, { receipt: "bad" }]) {
        assert.equal(module.validResourceTicket({ ...ticket, ...changed }, scope, "test-key"), false)
    }
    assert.equal(module.validResourceTicket(ticket, { ...scope, relationshipId: "other" }, "test-key"), false)
    assert.equal(module.validResourceTicket(ticket, { ...scope, sessionId: "other" }, "test-key"), false)
    assert.equal(module.validResourceTicket(ticket, scope, "test-key", ticket.issuedAt + 8 * 86400000), false)
})

test("multipart completion verifies actual stored parts and is safe after a lost completion response", async () => {
    let complete = false
    let completions = 0
    let corrupt = true
    const partSize = resources.PORTAL_UPLOAD_PART_SIZE
    const module = multipart(async (command) => {
        if (command.constructor.name === "CreateMultipartUploadCommand") return { UploadId: "upload-id" }
        if (command.constructor.name === "HeadObjectCommand") { if (!complete) throw notFound(); return { ContentLength: partSize + 12, ContentType: "application/octet-stream" } }
        if (command.constructor.name === "ListPartsCommand") return { Parts: [{ PartNumber: 1, Size: partSize, ETag: "one" }, { PartNumber: 2, Size: corrupt ? 11 : 12, ETag: "two" }] }
        if (command.constructor.name === "CompleteMultipartUploadCommand") { complete = true; completions++; return {} }
        throw new Error("Unexpected storage request")
    })
    const ticket = await module.startResourceMultipart(scope, { name: "large.unknown", type: "", size: partSize + 12, folder: false, requestId })
    await assert.rejects(module.completeResourceMultipart(ticket, partSize + 12, 2), /Incomplete/)
    assert.equal(completions, 0)
    corrupt = false
    const saved = await module.completeResourceMultipart(ticket, partSize + 12, 2)
    assert.equal(saved.size, partSize + 12)
    assert.deepEqual(await module.completeResourceMultipart(ticket, partSize + 12, 2), saved)
    assert.equal(completions, 1)
    await assert.rejects(module.completeResourceMultipart(ticket, partSize + 11, 2), /Invalid upload size/)
})

test("R2 signed browser parts do not carry a checksum of an empty request body", async () => {
    const uploads = load("lib/onboarding/uploads.ts", { "@/lib/env": { getRequiredEnv: (key: string) => key === "R2_ACCOUNT_ID" ? "example" : "fake" } })
    const url = new URL(await getSignedUrl(uploads.getR2Client(), new UploadPartCommand({ Bucket: "bucket", Key: "key", UploadId: "id", PartNumber: 1, ContentLength: 8 }), { expiresIn: 60 }))
    assert.equal(url.searchParams.has("x-amz-checksum-crc32"), false)
    assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-length;host")
})

test("retrying a failed second part reuses the first part and sends the exact remaining bytes", async () => {
    const oldFetch = globalThis.fetch
    const oldXHR = (globalThis as any).XMLHttpRequest
    const parts = new Map<number, Uint8Array>()
    const calls: string[] = []
    let failSecond = true
    const size = resources.PORTAL_UPLOAD_PART_SIZE
    const file = new File([new Uint8Array(size).fill(127), new Uint8Array([1, 2, 3, 255])], "raw.project", { type: "application/x-project" })
    const ticket = { partSize: size }
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
        const input = JSON.parse(String(init.body))
        calls.push(`${input.action}:${input.partNumber ?? ""}`)
        if (input.action === "start") return Response.json({ ticket })
        if (input.action === "part") {
            if (input.partNumber === 2 && failSecond) { failSecond = false; return Response.json({ error: "Temporarily inaccessible" }, { status: 404 }) }
            return Response.json({ uploadUrl: `https://storage.example/${input.partNumber}` })
        }
        if (input.action === "complete") { assert.equal(input.size, file.size); assert.equal(input.partCount, 2); return Response.json({ resource: { id: "asset" } }) }
        throw new Error("Unexpected request")
    }) as typeof fetch
    ;(globalThis as any).XMLHttpRequest = class {
        upload: any = {}; status = 200; onload?: () => void; url = "";
        open(_method: string, url: string) { this.url = url }
        setRequestHeader() {}
        send(body: Blob) { void body.arrayBuffer().then((bytes) => { parts.set(Number(this.url.split("/").at(-1)), new Uint8Array(bytes)); this.upload.onprogress?.({ loaded: body.size }); this.onload?.() }) }
    }
    try {
        const task = new transfer.ResourceTransfer("https://portal.example/resources", requestId, selection.fileSelection(file))
        await assert.rejects(task.run(new AbortController().signal, () => {}), /Temporarily inaccessible/)
        assert.equal((await task.run(new AbortController().signal, () => {})).id, "asset")
        assert.equal(calls.filter((call) => call === "start:").length, 1)
        assert.equal(calls.filter((call) => call === "part:1").length, 1)
        assert.equal(parts.get(1)!.length, size)
        assert.deepEqual(parts.get(2), new Uint8Array([1, 2, 3, 255]))
    } finally { globalThis.fetch = oldFetch; (globalThis as any).XMLHttpRequest = oldXHR }
})

test("multipart API rejects revoked or cross-relationship tickets before storage and only saves verified completion", async () => {
    let authorized = true
    let stored = false
    let storageCalls = 0
    let saves = 0
    const implementation = multipart(async (command) => {
        storageCalls++
        if (command.constructor.name === "CreateMultipartUploadCommand") return { UploadId: "id" }
        if (command.constructor.name === "HeadObjectCommand") {
            if (!stored) throw notFound()
            return { ContentLength: 10, ContentType: "application/zip" }
        }
        return { Parts: [] }
    })
    const ticket = await implementation.startResourceMultipart(scope, { name: "Folder.zip", type: "application/zip", size: 10, folder: true, requestId })
    storageCalls = 0
    const route = load("app/api/client-portal/session/[token]/resources/multipart/route.ts", {
        "@/lib/client-portal/session": { resolveClientPortalAccessByToken: async () => authorized ? { workspace: { id: scope.workspaceId }, relationship: { id: scope.relationshipId }, session: { id: scope.sessionId } } : null },
        "@/lib/client-portal/resource-multipart": implementation,
        "@/lib/client-portal/resources": resources,
        "@/lib/env": { getRequiredEnv: () => "test-key" },
        "@/lib/client-portal/resource-persistence": { persistPortalResource: async (upload: any, actualScope: any) => { assert.deepEqual(actualScope, scope); assert.equal(upload.size, 10); saves++; return { resource: { id: "asset" } } } },
    })
    const post = (body: unknown) => route.POST(new Request("https://portal.example", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ token: "token" }) })
    authorized = false
    assert.equal((await post({ action: "complete", ticket, size: 10, partCount: 1 })).status, 404)
    authorized = true
    assert.equal((await post({ action: "complete", ticket: { ...ticket, path: "other/client-portal/file" }, size: 10, partCount: 1 })).status, 400)
    assert.equal(storageCalls, 0)
    assert.equal((await post({ action: "complete", ticket, size: 10, partCount: 1 })).status, 503)
    assert.equal(saves, 0)
    stored = true
    const response = await post({ action: "complete", ticket, size: 10, partCount: 1 })
    assert.equal(response.status, 201)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.equal(saves, 1)
})

test("team downloads enforce workspace, capabilities and asset access before signing", async () => {
    let permitted = true
    let allowed: Set<string> | null = new Set()
    let asset: any = { native_kind: "client_portal_resource", storage_path: "workspace/client-portal/relationship/session/folder", title: "施工資料.zip" }
    let reads = 0
    let signed = 0
    const route = load("app/api/workspaces/[workspaceSlug]/assets/[assetId]/download/route.ts", {
        "@/lib/workspace-access": {
            requireWorkspaceAccess: async () => ({ workspace: { id: "workspace" }, access: {} }),
            workspaceAccessHasCapability: () => permitted,
            accessibleRelationshipIds: async () => new Set(["relationship"]),
            accessibleWorkItemIds: async () => new Set(),
            accessibleAssetIds: async () => allowed,
        },
        "@/lib/relationships": { getAsset: async (workspace: string, id: string) => { assert.equal(workspace, "workspace"); assert.equal(id, "asset"); reads++; return asset } },
        "@/lib/onboarding/uploads": { createPrivateResourceDownloadUrl: async (path: string, name: string) => { assert.equal(path, asset.storage_path); assert.equal(name, "施工資料.zip"); signed++; return "https://storage.example/download" } },
    })
    const get = () => route.GET(new Request("https://app.example"), { params: Promise.resolve({ workspaceSlug: "agency", assetId: "asset" }) })
    assert.equal((await get()).status, 404)
    assert.equal(reads, 0)
    allowed = new Set(["asset"])
    permitted = false
    assert.equal((await get()).status, 404)
    assert.equal(reads, 0)
    permitted = true
    asset = { ...asset, storage_path: "other/client-portal/file" }
    assert.equal((await get()).status, 404)
    assert.equal(signed, 0)
    asset = { ...asset, storage_path: "workspace/client-portal/relationship/session/folder" }
    const response = await get()
    assert.equal(response.status, 303)
    assert.equal(response.headers.get("location"), "https://storage.example/download")
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.equal(signed, 1)
})
