import assert from "node:assert/strict"
import test from "node:test"
import { appointmentNotificationStatus, appointmentNotificationNotice, deliverAppointmentSubmission } from "../lib/appointment-setting-delivery.ts"

test("a competing submission observes the original send without dispatching again", async () => {
    let sends = 0
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const send = async () => {
        sends += 1
        await pending
        return { status: "sent", error: null }
    }
    const read = async () => ({ status: "sending", error: null })
    const owner = deliverAppointmentSubmission({ alreadySubmitted: false, send, read })
    const replay = await deliverAppointmentSubmission({ alreadySubmitted: true, send, read })
    assert.equal(replay.notificationStatus, "pending")
    assert.equal(sends, 1)
    release()
    assert.equal((await owner).notificationStatus, "sent")
    assert.equal(sends, 1)
})

test("repeated submission does not retry failed or uncertain delivery", async () => {
    for (const status of ["send_failed", "send_uncertain", "partial_sent", "delivered"]) {
        const outcome = await deliverAppointmentSubmission({
            alreadySubmitted: true,
            send: async () => { throw new Error("Replay must not send") },
            read: async () => ({ status, error: "Existing delivery outcome" }),
        })
        assert.equal(outcome.notificationStatus, appointmentNotificationStatus(status))
        assert.equal(outcome.notificationError, "Existing delivery outcome")
    }
})

test("notification feedback distinguishes partial, uncertain, failed and accepted sends", () => {
    for (const status of ["sent", "delivered", "read"]) assert.equal(appointmentNotificationStatus(status), "sent")
    assert.equal(appointmentNotificationStatus("partial_sent"), "partial")
    assert.equal(appointmentNotificationStatus("send_uncertain"), "uncertain")
    assert.equal(appointmentNotificationStatus("send_failed"), "failed")
    assert.equal(appointmentNotificationStatus(null), "pending")
    assert.match(appointmentNotificationNotice("partial"), /some channels/)
    assert.match(appointmentNotificationNotice("uncertain"), /before retrying/)
    assert.doesNotMatch(appointmentNotificationNotice("pending"), /failed|was sent/)
})
