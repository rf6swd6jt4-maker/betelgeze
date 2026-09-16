const PUSH_APP_ORIGIN = "https://app.betelgeze.com"

type DeclarativeChatPushInput = {
    title: string
    body: string
    url: string
    tag: string
    conversationId: string
    messageId: string
    messageCreatedAt: string
    unreadCount: number
}

export function declarativeChatPushPayload(input: DeclarativeChatPushInput) {
    const data = {
        url: input.url,
        category: "chat",
        conversationId: input.conversationId,
        messageId: input.messageId,
        messageCreatedAt: input.messageCreatedAt,
        unreadCount: input.unreadCount,
    }
    return JSON.stringify({
        web_push: 8030,
        notification: {
            title: input.title,
            body: input.body,
            navigate: new URL(input.url, PUSH_APP_ORIGIN).href,
            icon: "/icons/betelgeze-icon-192.png",
            badge: "/icons/betelgeze-icon-192.png",
            tag: input.tag,
            renotify: true,
            silent: false,
            data,
        },
        // These fields keep already-installed older workers compatible until
        // they next check for the updated worker.
        category: "chat",
        title: input.title,
        body: input.body,
        url: input.url,
        tag: input.tag,
        messageId: input.messageId,
        messageCreatedAt: input.messageCreatedAt,
        unreadCount: input.unreadCount,
        conversationId: input.conversationId,
    })
}
