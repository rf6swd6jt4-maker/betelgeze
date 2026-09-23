import test from "node:test"
import assert from "node:assert/strict"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { assetUploadPath, assertUploadedAsset, readAssetUploadReceipt, signAssetUploadReceipt, type AssetUploadReceipt } from "../lib/assets/upload-receipt.ts"
import { parseRecordCreate, serializeRecordCreate, recoverRecordCreates, saveRecordCreate, acknowledgeRecordCreate, confirmedRecordRejection } from "../lib/assets/create-draft.ts"
const id = "00000000-0000-4000-8000-000000000001"
const receipt: AssetUploadReceipt = { id, workspaceId: "workspace", userId: "user", path: assetUploadPath("workspace", "user", id), name: "Brief.pdf", size: 100, type: "application/pdf", kind: "document", expires: 200 }
test("manual upload receipt binds account, workspace, path and immutable metadata", () => {
    const signed = signAssetUploadReceipt(receipt, "secret")
    assert.deepEqual(readAssetUploadReceipt(signed, "secret", "workspace", "user", 100), receipt)
    for (const [workspace, user] of [["foreign", "user"], ["workspace", "foreign"]]) assert.throws(() => readAssetUploadReceipt(signed, "secret", workspace, user, 100))
    assert.throws(() => readAssetUploadReceipt(signed + "x", "secret", "workspace", "user", 100))
    assert.throws(() => readAssetUploadReceipt(signed, "secret", "workspace", "user", 201))
    assert.throws(() => readAssetUploadReceipt(signAssetUploadReceipt({ ...receipt, path: "foreign/path" }, "secret"), "secret", "workspace", "user", 100))
    assertUploadedAsset(receipt, { ContentLength: 100, ContentType: "application/pdf", ETag: '"version"' })
    for (const object of [{ ContentLength: 99, ContentType: "application/pdf", ETag: "v" }, { ContentLength: 100, ContentType: "image/png", ETag: "v" }, { ContentLength: 100, ContentType: "application/pdf" }]) assert.throws(() => assertUploadedAsset(receipt, object))
})
test("real SDK signs immutable PUT condition and content type without contacting storage", async () => {
    const client = new S3Client({ region: "auto", endpoint: "https://example.invalid", credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" } })
    const url = new URL(await getSignedUrl(client, new PutObjectCommand({ Bucket: "fixture", Key: receipt.path, ContentType: receipt.type, ContentLength: receipt.size, IfNoneMatch: "*" }), { expiresIn: 900, signableHeaders: new Set(["content-type", "if-none-match"]) }))
    const signed = url.searchParams.get("X-Amz-SignedHeaders")!.split(";")
    assert(signed.includes("if-none-match")); assert(signed.includes("content-type")); assert(signed.includes("content-length"))
    client.destroy()
})
test("pending create intent retains request ID and scalar draft through restart without file bytes", () => {
    const form = new FormData(); form.set("record_request_id", id); form.set("expected_user_id", "user"); form.set("description", "A private fixture draft"); form.set("asset_file", new Blob(["file bytes"]), "a.txt")
    const raw = serializeRecordCreate(form), recovered = parseRecordCreate(raw, "user")!
    assert.equal(recovered.get("record_request_id"), id); assert.equal(recovered.get("description"), "A private fixture draft"); assert.equal(recovered.get("asset_file"), null)
    assert.throws(() => parseRecordCreate(raw, "different account")); assert.throws(() => parseRecordCreate('{"version":2}', "user"))
})

test("only authoritative terminal receipts release pending creation", () => {
    for (const code of ["08006", "08003", "PGRST000", "PGRST001", "PGRST500", "XX000", "P0001", "23503", undefined]) assert.equal(confirmedRecordRejection({ error: { code, message: "Lost acknowledgement" } }), false)
    assert.equal(confirmedRecordRejection({ data: { status: "rejected", error: "Relationship unavailable" } }), true)
    assert.equal(confirmedRecordRejection({ error: { code: "08006" }, data: { status: "rejected", error: "Unknown" } }), false)
    assert.equal(confirmedRecordRejection({ data: { status: "rejected" } }), false)
})
test("independent tabs preserve per-request drafts and acknowledgements only clear their own intent", () => {
    const values = new Map<string, string>()
    const storage = { get length() { return values.size }, key: (i: number) => [...values.keys()][i], getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
    const prefix = "fixture", make = (request: string, title: string) => { const f = new FormData(); f.set("record_request_id", request); f.set("expected_user_id", "user"); f.set("name", title); return f }
    const one = saveRecordCreate(storage, prefix, make(id, "Tab one")), two = saveRecordCreate(storage, prefix, make("00000000-0000-4000-8000-000000000002", "Tab two"))
    assert.equal(recoverRecordCreates(storage, prefix, "user").length, 2)
    assert.throws(() => saveRecordCreate(storage, prefix, make(id, "Changed attempt")), /preserved/)
    acknowledgeRecordCreate(storage, one)
    assert.deepEqual(recoverRecordCreates(storage, prefix, "user").map(x => x.form.get("name")), ["Tab two"])
    storage.setItem(two.key, "corrupt-but-preserved")
    acknowledgeRecordCreate(storage, two)
    assert.equal(storage.getItem(two.key), "corrupt-but-preserved")
    assert.throws(() => recoverRecordCreates(storage, prefix, "user"))
    assert.throws(() => recoverRecordCreates({ ...storage, getItem() { throw new Error("Storage denied") } }, prefix, "user"), /Storage denied/)
})

test("R2 CORS additive condition preserves unrelated rules and encryption upload headers", async () => {
    const { readFileSync } = await import("node:fs"), { default: ts } = await import("typescript")
    const unrelated = { id: "unrelated", allowed: { origins: ["https://fixture.invalid"], methods: ["GET"], headers: ["range"] } }
    let saved: { rules: Array<{ id: string; allowed: { headers: string[] } }> } | undefined
    const fixtureFetch = async (_url: string, init: { method?: string; body?: string }) => {
        if (init.method === "PUT") { saved = JSON.parse(init.body!); return new Response("{}", { status: 200 }) }
        return Response.json({ result: { rules: [unrelated] } })
    }
    const fixtureEnv: Record<string, string> = { R2_ACCOUNT_ID: "fixture", CLOUDFLARE_API_TOKEN: "fixture", R2_BUCKET_NAME: "fixture" }
    const compiled = { exports: {} }
    new Function("require", "module", "exports", "fetch", "process", ts.transpileModule(readFileSync("lib/onboarding/r2-cors.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(() => ({ getRequiredEnv: (key: string) => fixtureEnv[key] }), compiled, compiled.exports, fixtureFetch, { env: fixtureEnv })
    await (compiled.exports as { ensurePlatformDirectUploads(): Promise<void> }).ensurePlatformDirectUploads()
    assert.deepEqual(saved!.rules[0], unrelated)
    const headers = saved!.rules.find(rule => rule.id === "betelgeze-onboarding-platform")!.allowed.headers
    for (const header of ["content-type", "if-none-match", "x-amz-server-side-encryption-customer-algorithm", "x-amz-server-side-encryption-customer-key", "x-amz-server-side-encryption-customer-key-md5"]) assert(headers.includes(header))
})

// The browser owns fieldset behavior; this guard protects the intentional control boundary.
test("pending creation freezes editable controls and exposes explicit saved-intent recovery", async () => {
    const { readFileSync } = await import("node:fs")
    const source = readFileSync("components/workspace/WorkspaceCreateModal.tsx", "utf8")
    assert.match(source, /<fieldset[^>]+disabled=\{\(target === "asset" \|\| target === "note"\) && \(hasPendingCreate \|\| !draftReady\)\}/)
    assert.match(source, /requestRejected \? "Edit saved draft" : "Retry saved request"/)
    assert.match(source, /<p className="mt-2 font-medium">\{savedName\}<\/p>/)
    assert(source.indexOf("<fieldset") < source.indexOf('name="asset_file"'))
    assert(source.lastIndexOf("</fieldset>") > source.indexOf('name="name"'))
})
