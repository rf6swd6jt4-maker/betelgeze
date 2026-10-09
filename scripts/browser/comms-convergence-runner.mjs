import React, { useLayoutEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { useCommunicationsUnread } from "./useCommunicationsUnread.js"
import { useSharedUnreadSummary } from "./useSharedUnreadSummary.js"
import * as reads from "./read-state.js"
import {publishDeviceChatRead} from "./device-read-state.js"
import * as unreadBroadcast from "./unread-broadcast.js"
const { invalidateUnreadSummary } = unreadBroadcast
import { clientRealtime, nativeRealtime, clientSnapshot, nativeSnapshot, panelInvalidator } from "./callbacks.js"
const h = React.createElement
const kind = new URLSearchParams(location.search).get("kind") === "client" ? "client" : "native"
const position = n => ({ lastReadMessageId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, lastReadAt: `2026-10-07T10:00:00.${String(n).padStart(6, "0")}Z` })
let summaryRows = [{ kind, conversationId: "chat", count: 3, latestMessageId: position(3).lastReadMessageId, latestMessageAt: position(3).lastReadAt }]
let snapshotRead = null, mode = "immediate", pending = [], counters = { summary: 0, snapshot: 0, reads: 0, readBatches: 0 }, eventStarted = 0, observations = []
let visible = { shell: -1, row: -1 }, trigger, messageTrigger, recover
window.addEventListener("betelgeze:chat-read", () => { counters.readBatches++ })
function response(rows,cursorsIncluded) { return { ok: true, json: async () => ({ deviceId:"fixture-device",cursorsIncluded,...cursorsIncluded?{readCursors:[]}: {},conversations: rows }) } }
window.fetch = async (url) => {
    if (String(url).includes("/unread?scope=device")) {
        counters.summary++
        const rows = structuredClone(summaryRows), cursorsIncluded=String(url).includes("cursors=1")
        if (mode === "hold") return new Promise((resolve, reject) => pending.push({ resolve: () => resolve(response(rows,cursorsIncluded)), reject }))
        if (mode === "fail") throw Error("Synthetic summary offline")
        return response(rows,cursorsIncluded)
    }
    if (String(url).includes("/sync") || String(url).includes("/native/conversations")) {
        counters.snapshot++
        return { ok: true, json: async () => ({ schemaReady: true, conversations: [{ id: "chat", messages: [] }], readCursors: snapshotRead ? [{ ...snapshotRead, conversationId: "chat", relationshipId: "chat", userId: "me" }] : [], teams: [], stickers: [] }) }
    }
    counters.reads++
    throw Error("Unexpected request " + url)
}
function App() {
    const shell = useCommunicationsUnread("w", "fixture", "me", true)
    const hosted = useCommunicationsUnread("w", "fixture", "me", false)
    const shared = useSharedUnreadSummary("w", "me")
    const [cursors, setReadCursors] = useState([]), [selected, setSelected] = useState("chat"), [draft, setDraft] = useState("")
    const lifetime = useRef({ controller: new AbortController(), userId: "me", workspaceId: "w" }), knownReadCursors = useRef(cursors), publishedReadSnapshot = useRef(false)
    useLayoutEffect(() => { knownReadCursors.current = cursors }, [cursors])
    const invalidate = useMemo(() => panelInvalidator({ workspaceId: "w", userId: "me", invalidateUnreadSummary }, hosted.invalidate), [hosted.invalidate])
    useLayoutEffect(() => {
        const dependencies = {
            ...reads, unreadMessageEventKey: unreadBroadcast.unreadMessageEventKey, bootstrap: { workspaceId: "w", workspaceSlug: "fixture", currentUser: { id: "me" } }, onUnreadInvalidated: invalidate,
            updates: { beginRead: () => ({}), applySnapshot: () => true, getSnapshot: () => ({ conversations: [] }), removeMessage() {} },
            record: value => value ?? {}, text: value => typeof value === "string" ? value : null, stringValue: value => typeof value === "string" ? value : null, realtimeMessage: () => null,
            setReplyingTo() {}, setEditingMessage() {}, setActionMessageId() {}, setDraft() {}, setEditState() {}, editingSessionRef: { current: null },
            setReadCursors, knownReadCursors, publishedReadSnapshot, mergeCursor: (current, incoming) => reads.mergeChatReadCursor(current, incoming, cursor => cursor.conversationId ?? cursor.relationshipId),
            refresh: async () => {}, synchronize: async () => {}, NATIVE_TYPING_EVENT: "typing", syncLifetime: lifetime, selectedRef: { current: selected },
            knownMessageKeysRef: { current: new Set() }, messageAnimationKey: message => message.id, invalidateUnreadSummary, setSchemaReady() {}, setTeams() {}, setStickers() {}, setSelectedId() {}, flushPendingRead: async () => {}, fetch: window.fetch,
        }
        const handlers = new Map(), channel = { on(_event, options, handler) { if (options.table) handlers.set(options.table, handler); return channel } }
        ;(kind === "native" ? nativeRealtime : clientRealtime)(dependencies)(channel)
        trigger = payload => handlers.get(kind === "native" ? "workspace_native_read_cursors" : "communication_read_cursors")(payload)
        messageTrigger = payload => handlers.get(kind === "native" ? "workspace_native_messages" : "client_messages")(payload)
        recover = (kind === "native" ? nativeSnapshot : clientSnapshot)(dependencies)
    }, [invalidate, selected])
    const count = shared?.rows.find(row => row.kind === kind && row.conversationId === "chat")?.count ?? 0
    useLayoutEffect(() => {
        visible = { shell: shell.count, row: count, loaded: Boolean(shared), stale: shell.stale, cursor: cursors[0]?.lastReadMessageId, selected, draft }
        if (eventStarted && shell.count === 0 && count === 0) { observations.push(performance.now() - eventStarted); eventStarted = 0 }
    }, [shell.count, shell.stale, count, shared, cursors, selected, draft])
    return h("main", null, h("h1", null, "Synthetic hosted Comms"), h("span", null, "Shell unread "), h("output", { id: "shell-count" }, shell.count),
        h("nav", null, h("button", { id: "chat", onClick: () => setSelected("chat") }, "Chat ", h("output", { id: "row-count" }, count)), h("button", { id: "other", onClick: () => setSelected("other") }, "Other chat")),
        h("div", { id: "pane", "data-selected": selected }, Array.from({ length: 60 }, (_, i) => h("p", { key: i }, `${selected} synthetic message ${i}`))),
        h("input", { id: "composer", "aria-label": "Draft", value: draft, onChange: event => setDraft(event.target.value) }))
}
window.commsConvergence = {
    get state() { return { ...visible, counters: { ...counters }, observations: [...observations], pending: pending.length } },
    summary(next, nextMode = "immediate") { summaryRows = next; mode = nextMode },
    rows(n = 3) { return [{ kind, conversationId: "chat", count: n, latestMessageId: position(n).lastReadMessageId, latestMessageAt: position(n).lastReadAt }] },
    settle(fail = false) { const requests = pending; pending = []; for (const request of requests) { if (fail) request.reject(Error("Synthetic held summary failed")); else request.resolve() } },
    remote(n = 3, userId = "me") { eventStarted = performance.now(); trigger({ eventType: "UPDATE", new: { workspace_id: "w", conversation_id: "chat", relationship_id: "chat", user_id: userId, last_read_message_id: position(n).lastReadMessageId, last_read_at: position(n).lastReadAt } }) },
    duplicate(n = 3) { for (let i = 0; i < 12; i++) this.remote(n) },
    acknowledge(n = 3) { eventStarted = performance.now(); publishDeviceChatRead({ workspaceId: "w", userId: "me", deviceId:"fixture-device", kind, conversationId: "chat", ...position(n) }) },
    async snapshot(n = 3, unread = true) { snapshotRead = position(n); eventStarted = performance.now(); if (kind === "native") await recover(undefined, { unread }); else await recover() },
    messageEvent() { messageTrigger({ eventType: "DELETE", commit_timestamp: "2026-10-07T12:00:00Z", old: { id: "synthetic-deleted-message" }, new: {} }) },
    invalidate() { invalidateUnreadSummary("w", "me") },
    resetTiming() { observations = [] },
}
createRoot(document.getElementById("root")).render(h(App))
