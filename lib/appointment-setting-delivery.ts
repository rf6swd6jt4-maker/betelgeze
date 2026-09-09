export type AppointmentNotificationStatus = "sent" | "partial" | "failed" | "uncertain" | "pending"

export type AppointmentDeliveryState = {
    checkedAt: number
    messagingError: string | null
    notificationError: string | null
    notifications: Record<string, AppointmentNotificationStatus>
}

export function appointmentNotificationLabel(status: AppointmentNotificationStatus | undefined) {
    switch (status) {
        case "sent": return "Client notified"
        case "partial": return "Some channels need attention"
        case "failed": return "Notification failed"
        case "uncertain": return "Delivery unconfirmed"
        case "pending": return "Notification pending"
        default: return "Notification status unavailable"
    }
}

export function appointmentNotificationStatus(status: string | null | undefined): AppointmentNotificationStatus {
    if (status === "sent" || status === "delivered" || status === "read") return "sent"
    if (status === "partial_sent") return "partial"
    if (status === "send_failed") return "failed"
    if (status === "send_uncertain") return "uncertain"
    return "pending"
}

// Only the transaction that changed draft -> submitted owns delivery. Repeated
// submissions observe the existing message; they must never dispatch it again.
export async function deliverAppointmentSubmission(input: {
    alreadySubmitted: boolean
    send: () => Promise<{ status: string; error: string | null }>
    read: () => Promise<{ status: string | null; error: string | null }>
}) {
    const result = await (input.alreadySubmitted ? input.read() : input.send())
    return { notificationStatus: appointmentNotificationStatus(result.status), notificationError: result.error }
}

export function appointmentNotificationNotice(status: AppointmentNotificationStatus) {
    switch (status) {
        case "sent": return "Appointment submitted. The client notification was sent."
        case "partial": return "Appointment submitted. The notification was sent on some channels; check Communications for the remaining delivery."
        case "failed": return "Appointment submitted, but the notification failed. Open Communications to review and retry it."
        case "uncertain": return "Appointment submitted. Notification delivery is still being confirmed; check Communications before retrying."
        case "pending": return "Appointment submitted. Check Communications for notification progress."
    }
}
