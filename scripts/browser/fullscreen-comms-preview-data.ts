import type { NativeCommunicationsBootstrap, NativeMessage } from "@/lib/teams/types"
import type { CommunicationsBootstrap } from "@/lib/communications/types"

// Deliberately synthetic, browser-local data. No credentials or production IDs.
const currentUser = { id: "preview-you", name: "You", avatarSrc: null }
const people = [currentUser, { id: "preview-alex", name: "Alex Morgan", avatarSrc: null }, { id: "preview-sam", name: "Sam Taylor", avatarSrc: null }, { id: "preview-jamie", name: "Jamie Reed", avatarSrc: null }]
const now = Date.now()
const bodies = [
    "Morning! I’ve added the latest notes for the team.",
    "Thanks — I’ll have a look after this call.",
    "The updated plan is ready. There are a couple of small details to check before Friday.",
    "That works for me. Can we keep the opening section short?",
    "Absolutely. I’ve kept the key points and moved the extra detail into the appendix.",
    "Perfect. I’ll send through my comments this afternoon.",
    "A quick checklist:\n- [ ] Review the opening\n- [ ] Confirm the timeline\n- [x] Gather the reference material",
    "I’ve checked the reference material — everything is there.",
    "Great, thank you!",
    "Do you have a moment to look at the final paragraph? It should read clearly on a small screen too.",
    "Yes, I’ll check it now.",
    "All good from me. Let’s pick this up tomorrow morning.",
]
function messages(conversationId: string, other: string, amount = 28, age = 0): NativeMessage[] {
    return Array.from({ length: amount }, (_, index) => ({
        id: `${conversationId}-message-${index}`, clientRequestId: null, conversationId,
        senderUserId: index % 3 === 1 ? currentUser.id : other, senderWorkspaceRole: index % 3 === 1 ? "owner" : "staff",
        body: bodies[index % bodies.length], replyToMessageId: index === amount - 3 ? `${conversationId}-message-${amount - 5}` : null,
        attachment: null, createdAt: new Date(now - age - (amount - index) * 180000).toISOString(), editedAt: null,
    }))
}
export const teamBootstrap: NativeCommunicationsBootstrap = {
    workspaceId: "preview-workspace", workspaceSlug: "local-preview", currentUser, people, formerPeople: [],
    conversations: [
        { id: "preview-team", kind: "team", teamId: "preview-project-team", title: "Project team", subtitle: "Alex, Sam, Jamie and you", avatarSrc: null, memberIds: people.map(p => p.id), archived: false, canWrite: true, pinnedMessageId: "preview-team-message-6", updatedAt: new Date(now).toISOString(), messages: messages("preview-team", "preview-alex", 48) },
        ...people.slice(1).map((person, index) => ({ id: `preview-direct-${index}`, kind: "direct" as const, teamId: null, title: person.name, subtitle: "Direct message", avatarSrc: null, memberIds: [currentUser.id, person.id], archived: false, canWrite: true, pinnedMessageId: null, updatedAt: new Date(now - index * 240000).toISOString(), messages: messages(`preview-direct-${index}`, person.id, 18 + index * 7, (index + 1) * 60000) })),
        { id: "preview-empty", kind: "team", teamId: "preview-new-team", title: "New project", subtitle: "A fresh conversation", avatarSrc: null, memberIds: people.map(p => p.id), archived: false, canWrite: true, pinnedMessageId: null, updatedAt: new Date(now - 3600000).toISOString(), messages: [] },
    ],
    teams: [{ id: "preview-project-team", name: "Project team", kind: "custom", archivedAt: null, memberIds: people.map(p => p.id), responsibilities: [], maintenanceResponsibilities: [] }, { id: "preview-new-team", name: "New project", kind: "custom", archivedAt: null, memberIds: people.map(p => p.id), responsibilities: [], maintenanceResponsibilities: [] }],
    reactions: [{ id: "preview-reaction", conversationId: "preview-team", messageId: "preview-team-message-45", reactorUserId: "preview-sam", emoji: "👍", updatedAt: new Date(now).toISOString() }],
    readCursors: [], stickers: [], services: [], maintenanceCategories: [], canManageTeams: false, isOwner: true, currentUserRole: "owner", requestedConversationId: null, requestedDmUserId: null, schemaReady: true,
}
export const clientBootstrap: CommunicationsBootstrap = {
    workspaceId: teamBootstrap.workspaceId, workspaceSlug: teamBootstrap.workspaceSlug, currentUser, people, readCursors: [], reactions: [], stickers: [], selectedConversationId: null, schemaReady: true,
    conversations: ["Northstar Studio", "Harbour Coffee", "Willow Interiors", "New client"].map((title, index) => {
        const id = `preview-client-${index}`
        return { id, clientId: null, title, subtitle: "Local sample conversation", isTest: true, canSend: true, channels: ["meta_whatsapp"], primaryProvider: "meta_whatsapp", lastWhatsAppInboundAt: new Date(now).toISOString(), whatsappOptedOutAt: null, pinnedMessageId: null, participants: { managerId: "preview-alex", memberIds: people.map(person => person.id), optionalIds: [], eligibleIds: [] }, messages: messages(id, "preview-alex", index === 3 ? 0 : 22 + index * 3, index * 60000).map(m => ({ ...m, relationshipId: id, direction: m.senderUserId === currentUser.id ? "outbound" : "inbound", provider: "meta_whatsapp", status: "delivered", error: null, senderKind: m.senderUserId === currentUser.id ? "staff" : "client", automationKind: null, automationLabel: null, providerMessageId: m.id, replyToProviderMessageId: null, sentAt: m.createdAt, deliveredAt: m.createdAt, readAt: null, failedAt: null })) }
    }),
}

export function installPreviewIO() {
    // LAN HTTP does not expose randomUUID everywhere. This polyfill is confined
    // to synthetic IDs; it is never included in the application bundle.
    if (!crypto.randomUUID) Object.defineProperty(crypto, "randomUUID", { value: () => "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (Number(c) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(c) / 4).toString(16)) })
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
    const assetFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href)
        if (url.origin !== location.origin) throw new Error("External requests are disabled in this local preview.")
        // Content-free layout diagnostics must reach this Mac, not mock I/O.
        if (url.pathname === "/__preview/layout-trace" || url.pathname === "/__preview/diagnostic") return assetFetch(input, init)
        if (!url.pathname.startsWith("/api/")) return assetFetch(input, init)
        const method = init?.method ?? "GET"
        const data = typeof init?.body === "string" ? JSON.parse(init.body) : {}
        const native = url.pathname.includes("/native/")
        const bootstrap = native ? teamBootstrap : clientBootstrap
        const id = data.conversationId ?? data.relationshipId ?? url.searchParams.get("conversationId") ?? url.searchParams.get("relationshipId")
        const conversation = bootstrap.conversations.find(c => c.id === id)
        if (url.pathname.endsWith("/activity") || url.pathname.endsWith("/typing")) return json({ ok: true })
        if (url.pathname.endsWith("/conversations") || url.pathname.endsWith("/sync")) return json(bootstrap)
        if (url.pathname.endsWith("/read")) {
            const message = conversation?.messages.find(m => m.id === data.messageId)
            return message ? json({ cursor: { workspaceId: bootstrap.workspaceId, userId: currentUser.id, kind: native ? "native" : "client", conversationId: id, lastReadMessageId: message.id, lastReadAt: message.createdAt } }) : json({ error: "Sample message not found" }, 404)
        }
        if (url.pathname.endsWith("/reactions") && method === "POST" && conversation) {
            const message = conversation.messages.find(m => m.id === data.messageId)
            if (!message) return json({ error: "Sample message not found" }, 404)
            if (native) {
                teamBootstrap.reactions = teamBootstrap.reactions.filter(r => r.messageId !== data.messageId || r.reactorUserId !== currentUser.id)
                const reaction = data.emoji ? { id: `preview-reaction-${data.messageId}`, conversationId: id, messageId: data.messageId, reactorUserId: currentUser.id, emoji: data.emoji, updatedAt: new Date().toISOString() } : null
                if (reaction) teamBootstrap.reactions.push(reaction)
                return json({ reaction })
            }
            clientBootstrap.reactions = clientBootstrap.reactions.filter(r => r.messageId !== data.messageId || r.direction !== "outbound")
            const reaction = data.emoji ? { id: `preview-reaction-${data.messageId}`, relationshipId: id, messageId: data.messageId, direction: "outbound" as const, reactorUserId: currentUser.id, emoji: data.emoji, updatedAt: new Date().toISOString() } : null
            if (reaction) clientBootstrap.reactions.push(reaction)
            return json({ reaction })
        }
        if (url.pathname.endsWith("/messages") && conversation) {
            if (method === "GET") {
                const messageId = url.searchParams.get("messageId")
                return json(messageId ? { message: conversation.messages.find(m => m.id === messageId) } : { messages: conversation.messages, hasMore: false, nextBefore: null })
            }
            if (method === "PATCH") {
                const message = conversation.messages.find(m => m.id === data.messageId)
                if (message) Object.assign(message, { body: data.body, editedAt: new Date().toISOString() })
                return json({ message })
            }
            if (method === "DELETE") {
                const messageId = url.searchParams.get("messageId")
                conversation.messages = conversation.messages.filter(m => m.id !== messageId) as typeof conversation.messages
                return json({ deleted: true, conversationId: id, messageId })
            }
        }
        if (url.pathname.endsWith("/clear") && conversation) { conversation.messages = []; return json({ cleared: true }) }
        if (url.pathname.endsWith("/pins") && conversation) { conversation.pinnedMessageId = data.messageId ?? null; return json({ pinnedMessageId: conversation.pinnedMessageId }) }
        return json({ error: "This account or provider action is not connected in the local preview." }, 400)
    }
}
