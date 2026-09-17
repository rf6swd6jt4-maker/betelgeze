export type ChatActivityContext = {
    workspaceId: string
    conversationId: string | null
    conversationKind: "client" | "native"
    connectionLive: boolean
    workspaceTabActive: boolean
}

export function chatActivityIsActive(context: ChatActivityContext, visible: boolean, focused: boolean) {
    return context.workspaceTabActive && visible && focused && context.connectionLive && Boolean(context.conversationId)
}

// Every transition and heartbeat shares the same sequence, including beacons.
// Requests may finish out of order; SQL accepts only the newest revision.
export function createChatActivitySequence(tabId: string) {
    let revision = 0
    return (context: ChatActivityContext, active: boolean, transition: boolean) => ({
        tabId, revision: ++revision, active, transition,
        workspaceId: context.workspaceId, conversationId: context.conversationId,
        conversationKind: context.conversationKind, connectionLive: context.connectionLive,
    })
}
