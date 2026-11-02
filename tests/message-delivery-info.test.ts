import assert from "node:assert/strict"
import test from "node:test"
import { deliveryReceiptStages } from "../lib/communications/delivery-receipts.ts"

test("legacy status and creation-time backfills establish delivery stages without inventing event times", () => {
    const createdAt = "2026-08-01T10:11:12.123456Z"
    const delivery = { status: "whatsapp_read", sentAt: createdAt, deliveredAt: null, readAt: "2026-08-01T11:11:12.123456+01:00", failedAt: null }
    assert.deepEqual(deliveryReceiptStages(delivery, createdAt), [{ label: "Sent", time: null }, { label: "Read", time: null }])
    const readAt = "2026-08-01T10:11:12.123457Z"
    assert.deepEqual(deliveryReceiptStages({ ...delivery, readAt }, createdAt).at(-1), { label: "Read", time: readAt })
    assert.deepEqual(deliveryReceiptStages({ ...delivery, status: "sent", sentAt: null, readAt: null }, createdAt), [{ label: "Sent", time: null }])
})
