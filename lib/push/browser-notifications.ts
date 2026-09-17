import { recordVersionKey } from "../record-version.js"

export async function dismissReadChatNotification(conversationId: string, readThroughCreatedAt: string, readThroughMessageId: string | null = null) {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return

    try {
        const registration = await navigator.serviceWorker.getRegistration("/")
        if (!registration) return
        const notifications = await registration.getNotifications()
        for (const notification of notifications) {
            const data = notification.data && typeof notification.data === "object"
                ? notification.data as Record<string, unknown>
                : {}
            if (data.conversationId !== conversationId && notification.tag !== `chat:${conversationId}`) continue
            const messageCreatedAt = typeof data.messageCreatedAt === "string" ? data.messageCreatedAt : null
            if (!messageCreatedAt) continue
            const order = recordVersionKey(messageCreatedAt).localeCompare(recordVersionKey(readThroughCreatedAt))
            if (order < 0 || (order === 0 && readThroughMessageId && typeof data.messageId === "string" && data.messageId <= readThroughMessageId)) notification.close()
        }
    } catch {
        // Notification cleanup is best-effort and must never interrupt read persistence.
    }
}
