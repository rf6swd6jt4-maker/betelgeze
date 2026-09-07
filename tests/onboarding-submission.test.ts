import assert from "node:assert/strict"
import test from "node:test"
import { signUploadReceipt, validUploadReceipt } from "../lib/onboarding/upload-receipt.ts"
import { sameOnboardingResponse } from "../lib/onboarding/submission-response.ts"
import { postOnboardingSubmission, type OnboardingSubmissionResult } from "../lib/onboarding/submission-client.ts"
import { confirmedOnboardingNavigation } from "../lib/onboarding/confirmed-navigation.ts"

const scope = { workspaceId: "workspace", relationshipId: "relationship", sessionId: "session", stepKey: "step", fieldName: "file-field" }
const file = { path: "workspace/onboarding/relationship/session/step/file.pdf", name: "file.pdf", size: 128, type: "application/pdf", kind: "document" as const, provider: "r2" as const }
const now = 1_000_000_000
const key = "test-only-receipt-secret"
const received = { ...file, receipt: signUploadReceipt(scope, file, key, now) }
const outcome: Extract<OnboardingSubmissionResult, { ok: true }> = { ok: true, nextStepKey: "two", nextPath: "/onboarding/session/token?step=two", clientPortalUrl: null, compositionHash: "revision" }

test("upload receipts bind the confirmed object to its session, field and metadata", () => {
    assert.equal(validUploadReceipt(scope, received, key, now + 1), true)
    for (const field of Object.keys(scope)) {
        assert.equal(validUploadReceipt({ ...scope, [field]: "different" }, received, key, now + 1), false)
    }
    for (const change of [{ path: "other/file.pdf" }, { name: "changed.pdf" }, { size: 129 }, { type: "text/plain" }, { provider: "supabase" as const }]) {
        assert.equal(validUploadReceipt(scope, { ...received, ...change }, key, now + 1), false)
    }
    assert.equal(validUploadReceipt(scope, received, "wrong-key", now + 1), false)
    assert.equal(validUploadReceipt(scope, { ...received, receipt: received.receipt + "x" }, key, now + 1), false)
    assert.equal(validUploadReceipt(scope, received, key, now - 1), false)
    assert.equal(validUploadReceipt(scope, received, key, now + 8 * 86400000), false)
    assert.equal(validUploadReceipt(scope, file, key, now), false)
})

test("duplicate submission accepts the saved answers and rejects different answers or files", () => {
    const stored = { name: "Example", files: [received] }
    assert.equal(sameOnboardingResponse(stored, { files: [{ ...received, receipt: "renewed" }], name: "Example" }), true)
    assert.equal(sameOnboardingResponse(stored, { ...stored, name: "Changed" }), false)
    assert.equal(sameOnboardingResponse(stored, { ...stored, files: [{ ...file, path: "different" }] }), false)
    assert.equal(sameOnboardingResponse(undefined, stored), false)
})

test("a lost acknowledgement retries the same payload and returns the server receipt", async () => {
    const payloads: string[] = []
    let saved: unknown
    const fetcher: typeof fetch = async (_url, init) => {
        payloads.push(String(init?.body))
        const body = JSON.parse(String(init?.body))
        if (!saved) {
            saved = body
            throw new TypeError("Connection dropped after commit")
        }
        assert.deepEqual(body, saved)
        return Response.json(outcome)
    }
    assert.deepEqual(await postOnboardingSubmission("token", "one", { name: "Example" }, "revision", fetcher), outcome)
    assert.equal(payloads.length, 2)
    assert.equal(payloads[0], payloads[1])
})

test("offline and invalid acknowledgements never report a successful save", async () => {
    let attempts = 0
    const offline: typeof fetch = async () => { attempts++; throw new TypeError("offline") }
    assert.equal((await postOnboardingSubmission("token", "one", {}, null, offline)).ok, false)
    assert.equal(attempts, 2)
    const invalid: typeof fetch = async () => Response.json({ ok: true })
    assert.equal((await postOnboardingSubmission("token", "one", {}, null, invalid)).ok, false)
})

test("required-field errors stay on the current step without an automatic retry", async () => {
    let attempts = 0
    const rejected: typeof fetch = async () => { attempts++; return Response.json({ ok: false, error: "Email is required." }, { status: 400 }) }
    assert.deepEqual(await postOnboardingSubmission("token", "one", {}, null, rejected), { ok: false, error: "Email is required." })
    assert.equal(attempts, 1)
})

test("only the acknowledged next step advances the preloaded view", () => {
    const input = { result: outcome, compositionHash: "revision", preparedAt: now, stepKeys: ["one", "two", "three"], now: now + 100 }
    assert.deepEqual(confirmedOnboardingNavigation(input), { key: "two", completed: ["one"] })
    assert.equal(confirmedOnboardingNavigation({ ...input, compositionHash: "changed" }), null)
    assert.equal(confirmedOnboardingNavigation({ ...input, now: now + 46 * 60 * 1000 }), null)
    assert.equal(confirmedOnboardingNavigation({ ...input, result: { ...outcome, nextStepKey: "unknown" } }), null)
    assert.equal(confirmedOnboardingNavigation({ ...input, result: { ...outcome, nextStepKey: null, clientPortalUrl: "https://portal.example.test" } }), null)
})
