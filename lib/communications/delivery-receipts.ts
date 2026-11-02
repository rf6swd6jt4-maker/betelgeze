import { recordVersionKey } from "../record-version.js"
import type { CommunicationDelivery } from "./types"

type Receipt = Pick<CommunicationDelivery, "status" | "sentAt" | "deliveredAt" | "readAt" | "failedAt">

export function deliveryReceiptStages(delivery: Receipt, messageCreatedAt: string) {
    const status = delivery.status.replace(/^whatsapp_/, "")
    const createdTime = recordVersionKey(messageCreatedAt)
    const stages = [
        { label: "Sent", time: delivery.sentAt, reported: status === "sent" },
        { label: "Delivered", time: delivery.deliveredAt, reported: status === "delivered" },
        { label: "Read", time: delivery.readAt, reported: status === "read" },
        { label: "Failed", time: delivery.failedAt, reported: ["send_failed", "delivery_failed", "failed"].includes(status) },
    ]
    // Legacy storage and older snapshots used message creation time for missing
    // provider times, including per-channel rows copied from those messages.
    return stages.filter(stage => stage.time || stage.reported).map(({ label, time }) => ({
        label,
        time: time && Number.isFinite(Date.parse(time)) && recordVersionKey(time) !== createdTime ? time : null,
    }))
}
