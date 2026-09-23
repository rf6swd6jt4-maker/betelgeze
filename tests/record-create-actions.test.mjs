import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { confirmedRecordRejection } from "../lib/assets/create-draft.ts"
import { assetUploadPath, readAssetUploadReceipt, signAssetUploadReceipt } from "../lib/assets/upload-receipt.ts"

const workspaceId = "00000000-0000-4000-8000-000000000001"
const userId = "00000000-0000-4000-8000-000000000002"
const requestId = "00000000-0000-4000-8000-000000000003"
const actionCode = ts.transpileModule(readFileSync("app/[workspaceSlug]/relationships/actions.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function fixture() {
    const calls = []
    let response = { data: { status: "rejected", error: "Invalid text" } }
    let prior = null
    let verificationCount = 0
    const chain = { select() { return this }, eq() { return this }, async maybeSingle() { return { data: prior } } }
    const stubs = {
        "next/cache": { revalidatePath() {} },
        "next/navigation": {},
        "@/lib/workspaces": { requireWorkspace: async (slug, role) => {
            assert.equal(slug, "fixture")
            assert.equal(role, "admin")
            return { workspace: { id: workspaceId }, user: { id: userId } }
        } },
        "@/lib/supabase/admin": { supabaseAdmin: {
            from(name) { assert.equal(name, "record_attachment_commands"); return chain },
            async rpc(name, values) { assert.equal(name, "create_attachment_record"); calls.push(values); return response },
        } },
        "@/lib/relationships": {
            assetHref: (slug, id) => `/${slug}/assets/${id}`,
            workspaceHref: (slug, section) => `/${slug}/${section}`,
            relationshipHubHref: (slug, id) => `/${slug}/relationships/${id}`,
        },
        "@/lib/notes": { noteHref: (slug, id) => `/${slug}/notes/${id}` },
        "@/lib/env": { getRequiredEnv: () => "fixture-secret" },
        "@/lib/assets/create-draft": { confirmedRecordRejection },
        "@/lib/assets/upload-receipt": { readAssetUploadReceipt },
        "@/lib/assets/uploads": { verifyAssetUpload: async () => { verificationCount++ } },
    }
    const compiled = { exports: {} }
    // Invoke the actual actions. SQL behavior is covered by the isolated PostgreSQL fixture.
    new Function("require", "module", "exports", actionCode)(id => stubs[id] ?? {}, compiled, compiled.exports)
    return {
        actions: compiled.exports, calls,
        setResponse(value) { response = value },
        setPrior(value) { prior = value },
        get verificationCount() { return verificationCount },
    }
}

function noteForm() {
    const form = new FormData()
    form.set("expected_user_id", userId)
    form.set("record_request_id", requestId)
    form.set("name", " ")
    form.set("description", " ")
    return form
}

function assetForm(expires = Date.now() + 60_000) {
    const receipt = { id: requestId, workspaceId, userId, path: assetUploadPath(workspaceId, userId, requestId), name: "fixture.pdf", size: 100, type: "application/pdf", kind: "document", expires }
    const form = new FormData()
    form.set("expected_user_id", userId)
    form.set("record_request_id", requestId)
    form.set("upload_receipt", signAssetUploadReceipt(receipt, "fixture-secret"))
    form.set("title", "x".repeat(501))
    return form
}

test("whitespace-only note fields reach terminal SQL validation so saved intent can be revised", async () => {
    const f = fixture()
    const result = await f.actions.createNoteFromModal("fixture", noteForm())
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].p_payload.title, "")
    assert.equal(f.calls[0].p_payload.description, "")
    assert.equal(result.ok, false)
    assert.equal(result.rejected, true)
})

test("an action error code alone never releases an immutable pending create", async () => {
    const f = fixture()
    f.setResponse({ error: { code: "P0001", message: "An earlier response may have been lost" } })
    const result = await f.actions.createNoteFromModal("fixture", noteForm())
    assert.equal(result.ok, false)
    assert.equal(result.rejected, undefined)
})

test("oversized asset titles reach terminal SQL validation after exact upload verification", async () => {
    const f = fixture()
    const result = await f.actions.createAssetFromModal("fixture", assetForm())
    assert.equal(result.ok, false)
    assert.equal(result.rejected, true)
    assert.equal(f.calls[0].p_payload.title.length, 501)
    assert.equal(f.verificationCount, 1)
})

test("an expired receipt recovers a prior accepted create without verifying another upload", async () => {
    const f = fixture()
    f.setPrior({ record_id: requestId })
    f.setResponse({ data: { status: "accepted", record_id: requestId } })
    const result = await f.actions.createAssetFromModal("fixture", assetForm(1))
    assert.equal(result.ok, true)
    assert.equal(result.href, `/fixture/assets/${requestId}`)
    assert.equal(f.verificationCount, 0)
    assert.equal(f.calls[0].p_reject_reason, "upload_expired")
})

test("an actor cannot claim another actor's pending upload using their own receipt", async () => {
    const f = fixture()
    const form = assetForm()
    const foreignPath = assetUploadPath(workspaceId, "00000000-0000-4000-8000-000000000004", requestId)
    const ownReceipt = readAssetUploadReceipt(form.get("upload_receipt"), "fixture-secret", workspaceId, userId)
    assert.notEqual(foreignPath, ownReceipt.path)
    form.set("upload_receipt", signAssetUploadReceipt({ ...ownReceipt, path: foreignPath }, "fixture-secret"))
    const result = await f.actions.createAssetFromModal("fixture", form)
    assert.equal(result.ok, false)
    assert.equal(f.calls.length, 0)
    assert.equal(f.verificationCount, 0)
})

test("a changed session never reaches either record-create command", async () => {
    const f = fixture()
    const note = noteForm(), asset = assetForm()
    note.set("expected_user_id", "changed")
    asset.set("expected_user_id", "changed")
    assert.equal((await f.actions.createNoteFromModal("fixture", note)).ok, false)
    assert.equal((await f.actions.createAssetFromModal("fixture", asset)).ok, false)
    assert.equal(f.calls.length, 0)
    assert.equal(f.verificationCount, 0)
})
