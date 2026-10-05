import test from "node:test"
import assert from "node:assert/strict"
import { defaultTransferWork, recoverServiceTransfer, type ServiceTransferPreview, type ServiceTransferWork } from "../lib/service-assignee-transfer.ts"
const item = (extra: Partial<ServiceTransferWork>): ServiceTransferWork => ({ id: "work", title: "Work", status: "todo", execution_owner_id: "former", assignees: ["former"], movable: true, shared: false, ...extra })
const preview = (items: ServiceTransferWork[]): ServiceTransferPreview => ({ instanceId: "service", version: 1, stage: "setup", formerId: "former", recipientId: "recipient", fingerprint: "fixture", recipientName: "New person", formerName: "Former", items, appointment: false, bookingEnabled: true, formerSetupRetained: false, formerBookingRetained: false, teamMembershipRetained: true })
test("ordinary responsibility and inherited unassigned work are selected together", () => {
    assert.deepEqual(defaultTransferWork(preview([item({}), item({ id: "inherited", execution_owner_id: null, assignees: [] })])), ["work", "inherited"])
})
test("an independent execution owner or collaborator requires explicit selection", () => {
    assert.deepEqual(defaultTransferWork(preview([item({ execution_owner_id: "other" }), item({ id: "collaborative", assignees: ["former", "other"] })])), [])
})
test("shared, completed and private work marked non-transferable never enter the default handover", () => {
    assert.deepEqual(defaultTransferWork(preview([item({ movable: false, shared: true }), item({ id: "done", movable: false, status: "done" })])), [])
})

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
function recoveryRecord() {
    const p = { ...preview([item({ id: id(10), execution_owner_id: id(4), assignees: [id(4)] })]), instanceId: id(6), recipientId: id(5), fingerprint: "a".repeat(32) }
    return { input: { expectedUserId: id(3), requestId: id(8), instanceId: id(6), recipientId: id(5), fingerprint: p.fingerprint, workIds: [id(10)], reason: "Handover" }, preview: p }
}
test("recovery preserves exact request identity and rejects other accounts or services", () => {
    const value = recoveryRecord()
    assert.deepEqual(recoverServiceTransfer(JSON.stringify(value), id(3), id(6)), value)
    assert.equal(recoverServiceTransfer(JSON.stringify(value), id(99), id(6)), null)
    assert.equal(recoverServiceTransfer(JSON.stringify(value), id(3), id(99)), null)
})
test("malformed saved previews cannot crash the recovery dialog or become transfer requests", () => {
    for (const bad of [null, {}, { id: id(10), assignees: null }]) {
        const value = recoveryRecord()
        assert.equal(recoverServiceTransfer(JSON.stringify({ ...value, preview: { ...value.preview, items: [bad] } }), id(3), id(6)), null)
    }
    assert.equal(recoverServiceTransfer("broken", id(3), id(6)), null)
    const value = recoveryRecord()
    assert.equal(recoverServiceTransfer(JSON.stringify({ ...value, input: { ...value.input, workIds: Array(201).fill(id(10)) } }), id(3), id(6)), null)
})
