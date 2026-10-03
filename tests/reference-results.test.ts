import assert from "node:assert/strict"
import test from "node:test"
import { readReferenceResults } from "../lib/communications/reference-results.ts"

const context = { userId: "user", workspaceId: "workspace", workspaceSlug: "demo", conversationId: "conversation" }
const id = "00000000-0000-4000-8000-000000000001"
const reference = { type: "asset", id, label: "Design draft", detail: "Acme", href: `/demo/assets/${id}` }
const envelope = (results: unknown = [reference]) => ({ scope: { userId: "user", workspaceId: "workspace" }, results })

test("both reference consumers accept only complete compact DTOs in the current account scope", () => {
    assert.deepEqual(readReferenceResults(envelope(), context, 4), [reference])
    for (const field of ["userId", "workspaceId"]) assert.throws(() => readReferenceResults({ ...envelope(), scope: { ...context, [field]: "other" } }, context, 4), /Could not check/)
    for (const invalid of [null, [], { scope: null, results: [] }, envelope({}), envelope(Array(5).fill(reference))]) assert.throws(() => readReferenceResults(invalid, context, 4), /Could not check/)
})

test("malformed identities, labels and destinations fail the complete response closed", () => {
    for (const patch of [
        { type: "account" }, { id: "invalid" }, { label: null }, { label: "  " }, { label: "x".repeat(241) }, { label: "Hidden\nName" },
        { detail: {} }, { detail: "x".repeat(161) }, { href: "https://example.com/" }, { href: `/other/assets/${id}` },
        { href: `/demo/work-items/${id}` }, { href: `/demo/assets/${id}?redirect=other` }, { href: `/demo/assets/${id}/../../settings` },
    ]) assert.throws(() => readReferenceResults(envelope([{ ...reference, ...patch }]), context, 4), /Could not check/)
    assert.throws(() => readReferenceResults(envelope([reference, reference]), context, 4), /Could not check/)
})

test("resolver responses may contain only requested records and canonical authorised relationship destinations", () => {
    assert.throws(() => readReferenceResults(envelope(), context, 40, []), /Could not check/)
    assert.deepEqual(readReferenceResults(envelope(), context, 40, [{ type: "asset", id }]), [reference])
    for (const route of ["relationships", "onboarding", "work"]) {
        const result = { ...reference, type: "relationship", href: `/demo/${route}/${id}` }
        assert.deepEqual(readReferenceResults(envelope([result]), context, 4), [result])
    }
})
