"use client"

import { readChatDraft, writeChatDraft } from "@/lib/communications/offline-drafts"
import { useOfflineChat } from "@/components/communications/useOfflineChat"
import { ChatOutboxStatus } from "@/components/communications/ChatOutboxStatus"

import { useRosterDialog } from "@/components/communications/useRosterDialog"
import { chatCheckboxBody } from "@/lib/chat-formatting"
import { MessageQuoteSelection } from "@/components/communications/MessageQuoteSelection"
import { messageQuoteFromValue, resolveMessageQuote, type MessageQuote } from "@/lib/communications/message-quotes"
import { ChatMessageText } from "@/components/communications/ChatMessageText"

import Image from "next/image"
import { ComposerFooter } from "@/components/communications/ComposerFooter"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Avatar } from "@/components/account/Avatar"
import { CommunicationsConnectionStatus } from "@/components/communications/CommunicationsConnectionStatus"
import { ComposerMessagePreview } from "@/components/communications/ComposerMessagePreview"
import { copyMessageText, downloadMessageAttachment, MessageReactionActions, MessageActionPopup, PrimaryMessageActions, type MessageActionView } from "@/components/communications/MessageActionMenu"
import { CancelIcon, CheckIcon, DeleteIcon, DoubleDeliveryCheckIcon, ReplyIcon, SingleDeliveryCheckIcon } from "@/components/communications/MessageInteractionIcons"
import { JumpToLatestButton, messagePaneCanShowNewMessage } from "@/components/communications/JumpToLatestButton"
import { MessageComposer } from "@/components/communications/MessageComposer"
import { MessageMediaLightbox, type MessageMediaPreview } from "@/components/communications/MessageMediaLightbox"
import { MessageReadAvatars } from "@/components/communications/MessageReadAvatars"
import { PinnedMessageBar } from "@/components/communications/PinnedMessageBar"
import { ResizableConversationColumns } from "@/components/communications/ResizableConversationColumns"
import { useConversationHistory } from "@/components/communications/useConversationHistory"
import type { CommunicationHistoryPage } from "@/lib/communications/history-page"
import { useConversationLayout } from "@/components/communications/useConversationLayout"
import { prepareCommunicationMedia } from "@/lib/communications/prepare-media"
import { ConversationMedia } from "@/components/communications/ConversationMedia"
import { ChatMotionViewport } from "@/components/communications/ChatMotionViewport"
import { NativeChatViewport } from "@/components/communications/NativeChatViewport"
import { beginMessageSwipe, moveMessageSwipe, finishMessageSwipe, type MessageSwipe } from "@/lib/communications/message-swipe"
import { NativeMessageBubble, type MessageActionAnchor } from "@/components/communications/NativeMessageBubble"
import { NativeAttachment } from "@/components/communications/NativeAttachment"
import { validateNativeAttachmentFile } from "@/lib/communications/native-attachments"
import { UnreadMessageCount } from "@/components/communications/UnreadMessageCount"
import { createCoordinatedChat, chatMutationRequest, ChatMutationError, type ChatRead } from "@/lib/communications/coordinated-updates"
import { requestChatCheckbox } from "@/lib/communications/checklist-updates"
import { useMessagePaneInteractions } from "@/components/communications/useMessagePaneInteractions"
import { useReliableCommunicationsRealtime, type CommunicationsConnectionState } from "@/components/communications/useReliableCommunicationsRealtime"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { dismissReadChatNotification } from "@/lib/push/browser-notifications"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { openWorkspaceMemberProfile } from "@/lib/workspace-member-profile"
import type { CommunicationAttachment, CommunicationSticker } from "@/lib/communications/types"
import { nativeConversationUnreadCount } from "@/lib/communications/unread"
import { Assignee } from "@/components/ui"
import { List, ListItem } from "@/components/list/List"
import { nativeMessageCanEdit } from "@/lib/teams/message-editing"
import type { NativeCommunicationsBootstrap, NativeConversation, NativeMessage, NativeReaction, NativeReadCursor, WorkspaceTeam } from "@/lib/teams/types"
import { closeWorkspaceComposer } from "@/lib/workspace-composer-viewport"

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function text(value: unknown) { return typeof value === "string" && value ? value : null }
function messageTime(value: string) { return new Intl.DateTimeFormat("en-IE", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) }
function messageDay(value: string) { return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) }
function sameDay(left: string, right: string) { return new Date(left).toDateString() === new Date(right).toDateString() }
function attachmentPreview(attachment: CommunicationAttachment | null) { return attachment ? `${attachment.kind === "image" ? "Image" : attachment.kind === "video" ? "Video" : attachment.kind === "audio" ? "Audio" : attachment.kind === "sticker" ? "Sticker" : "File"}: ${attachment.fileName}` : "" }
function messagePreview(message: NativeMessage) { return message.body || attachmentPreview(message.attachment) || "Message" }

const NATIVE_TYPING_EVENT = "native_typing"
const NATIVE_TYPING_EXPIRY_MS = 6_000
const NATIVE_TYPING_REFRESH_MS = 2_000

type NativeTypingByConversation = Record<string, Record<string, number>>

function updateNativeTyping(current: NativeTypingByConversation, conversationId: string, userId: string, expiresAt: number | null) {
    const conversation = { ...(current[conversationId] ?? {}) }
    if (expiresAt === null) delete conversation[userId]
    else conversation[userId] = expiresAt
    if (!Object.keys(conversation).length) {
        const next = { ...current }
        delete next[conversationId]
        return next
    }
    return { ...current, [conversationId]: conversation }
}

function NativeTypingDots({ label }: { label: string }) {
    return <div role="status" aria-live="polite" aria-label={label} className="flex justify-start">
        <span className="inline-flex h-10 items-center gap-1 rounded-2xl rounded-bl-md border border-neutral-800 bg-neutral-900 px-4">
            <span className="sr-only">{label}</span>
            {[0, 1, 2].map((index) => <span key={index} aria-hidden="true" className="betelgeze-typing-dot h-1.5 w-1.5 rounded-full bg-neutral-400" style={{ animationDelay: `${index * 140}ms` }} />)}
        </span>
    </div>
}

function NativeDeliveryTicks({ message, read }: { message: NativeMessage; read: boolean }) {
    if (message.clientRequestId === message.id) return <span className="inline-flex shrink-0" title="Sending" aria-label="Sending"><SingleDeliveryCheckIcon /></span>
    return <span className={`inline-flex shrink-0 ${read ? "text-sky-500" : ""}`} title={read ? "Read" : "Delivered to account"} aria-label={read ? "Read" : "Delivered to account"}><DoubleDeliveryCheckIcon /></span>
}

function SearchIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg> }
function BackIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m15 6-6 6 6 6" /></svg> }
function AttachmentIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m8.5 12.5 6.8-6.8a3 3 0 0 1 4.2 4.2l-9.2 9.2a5 5 0 0 1-7.1-7.1l9-9" /></svg> }
function StickerIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="M5 3h10a4 4 0 0 1 4 4v7l-7 7H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M12 21v-5a2 2 0 0 1 2-2h5" /><path d="M7 9h.01M15 9h.01M8 13c1.5 1.2 6.5 1.2 8 0" /></svg> }
function TeamIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><circle cx="8" cy="8" r="3" /><circle cx="16" cy="9" r="2.5" /><path d="M3 19c0-3 2-5 5-5s5 2 5 5" /><path d="M13 15c1-.8 2-1.2 3.5-1 2.5.3 4 2.1 4 4.5" /></svg> }


function TeamAvatar({ conversation, currentUserId }: { conversation: NativeConversation; currentUserId: string }) {
    if (conversation.system) return <span className="h-11 w-11 shrink-0 overflow-hidden rounded-full"><Avatar src={conversation.avatarSrc} name="BE" className="h-full w-full" /></span>
    if (conversation.kind === "team") return <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-800 text-neutral-300"><TeamIcon /></span>
    const profileUserId = conversation.memberIds.find((id) => id !== currentUserId)
    return <span role="button" tabIndex={0} aria-label={`Open ${conversation.title} profile`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (profileUserId) openWorkspaceMemberProfile(profileUserId) }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && profileUserId) { event.preventDefault(); event.stopPropagation(); openWorkspaceMemberProfile(profileUserId) } }} className="h-11 w-11 shrink-0 overflow-hidden rounded-full outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"><Avatar src={conversation.avatarSrc} name={conversation.title} className="h-full w-full" /></span>
}

function TeamEditor({ bootstrap, team, onClose }: { bootstrap: NativeCommunicationsBootstrap; team: WorkspaceTeam | null | undefined; onClose: () => void; onSaved: () => Promise<void> }) {
    const dialogRef = useRosterDialog(Boolean(team), onClose)
    if (!team) return null
    return <div role="dialog" aria-modal="true" aria-labelledby="team-roster-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-4">
        <section ref={dialogRef} className="betelgeze-popup-enter max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-950 p-4">
            <header className="flex items-center gap-3"><h2 id="team-roster-title" className="min-w-0 flex-1 truncate text-lg font-semibold">{team.name}</h2><button type="button" onClick={onClose} aria-label="Close team members" className="h-9 w-9 text-xl text-neutral-500">×</button></header>
            <List ariaLabel="Conversation members" className="!mt-3">{team.memberIds.map((id) => { const person = bootstrap.people.find((p) => p.id === id); return <ListItem key={id} className="px-3 py-2"><Assignee userId={id} name={person?.name ?? "Former member"} avatarSrc={person?.avatarSrc} /></ListItem> })}</List>
            <p className="mt-3 text-xs leading-5 text-neutral-500">{team.kind === "relationship" ? "This team was assembled during POS. Membership follows the client’s delivery assignments." : team.kind === "custom" ? "This existing group is read-only. New client teams are assembled during POS." : "Group membership is managed through workspace settings."}</p>
        </section>
    </div>
}

function mergeMessages(current: NativeMessage[], incoming: NativeMessage[]) {
    const keyed = new Map<string, NativeMessage>()
    for (const message of [...current, ...incoming]) {
        const key = message.clientRequestId ? `request:${message.clientRequestId}` : `id:${message.id}`
        const existing = keyed.get(key)
        if (existing && existing.id !== existing.clientRequestId && message.id === message.clientRequestId) continue
        if (existing?.editedAt && existing.editedAt > (message.editedAt ?? "")) continue
        keyed.set(key, { ...existing, ...message })
    }
    return [...keyed.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

function messageAnimationKey(message: NativeMessage) {
    return message.clientRequestId ? `request:${message.clientRequestId}` : `id:${message.id}`
}

function mergeCursor(current: NativeReadCursor[], incoming: NativeReadCursor) {
    const existing = current.find((cursor) => cursor.conversationId === incoming.conversationId && cursor.userId === incoming.userId)
    if (existing && existing.lastReadAt > incoming.lastReadAt) return current
    if (existing && existing.lastReadAt === incoming.lastReadAt && existing.lastReadMessageId === incoming.lastReadMessageId) return current
    return [...current.filter((cursor) => !(cursor.conversationId === incoming.conversationId && cursor.userId === incoming.userId)), incoming]
}

function realtimeMessage(value: unknown): NativeMessage | null {
    const row = record(value); const id = text(row.id); const conversationId = text(row.conversation_id); const senderUserId = text(row.sender_user_id) ?? (row.sender_user_id === null ? "be" : null); const createdAt = text(row.created_at)
    if (row.body_encryption_version !== null && row.body_encryption_version !== undefined) return null
    if (!id || !conversationId || !senderUserId || !createdAt) return null
    const attachment = row.attachment && typeof row.attachment === "object" && !Array.isArray(row.attachment) ? row.attachment as CommunicationAttachment : null
    return { id, clientRequestId: text(row.client_request_id), conversationId, senderUserId, senderWorkspaceRole: row.sender_workspace_role === "owner" || row.sender_workspace_role === "admin" || row.sender_workspace_role === "staff" ? row.sender_workspace_role : null, body: typeof row.body === "string" ? row.body : "", replyToMessageId: text(row.reply_to_message_id), quote: messageQuoteFromValue(row.quote), attachment, createdAt, editedAt: text(row.edited_at) }
}

export function TeamCommunicationsWorkspace({ active, bootstrap, onConnectionStateChange, onOpenClients, onSelectedConversationChange, onUnreadCountChange, clientUnreadCount, conversationListWidth, onConversationListWidthChange }: {
    active: boolean
    bootstrap: NativeCommunicationsBootstrap
    onConnectionStateChange?: (state: CommunicationsConnectionState) => void
    onOpenClients: () => void
    onSelectedConversationChange?: (conversationId: string | null) => void
    onUnreadCountChange?: (count: number) => void
    clientUnreadCount?: number
    conversationListWidth: number
    onConversationListWidthChange: (width: number) => void
}) {
    const supabase = useMemo(() => createSupabaseBrowserClient(), [])
    const [updates] = useState(() => createCoordinatedChat<NativeMessage, NativeConversation, NativeReaction>(bootstrap, (reaction) => `${reaction.messageId}:${reaction.reactorUserId}`))
    const { conversations, reactions } = useSyncExternalStore(updates.subscribe, updates.getSnapshot, updates.getSnapshot)
    const { setConversations } = updates
    const [schemaReady, setSchemaReady] = useState(bootstrap.schemaReady)
    const [teams, setTeams] = useState(bootstrap.teams)
    const [readCursors, setReadCursors] = useState(bootstrap.readCursors)
    const [selectedId, setSelectedId] = useState(bootstrap.requestedConversationId)
    const bootstrappedSelection = useRef(bootstrap.requestedConversationId)
    const [search, setSearch] = useState("")
    const [showArchived, setShowArchived] = useState(false)
    const [draft, setDraft] = useState("")
    const restoredDraftKey = useRef<string | null>(null)
    const [editingMessage, setEditingMessage] = useState<NativeMessage | null>(null)
    const [editState, setEditState] = useState<"idle" | "saving">("idle")
    const [replyingTo, setReplyingTo] = useState<(NativeMessage & { selectedQuote?: MessageQuote }) | null>(null)
    const [quoteHighlight, setQuoteHighlight] = useState<{ messageId: string; quote: MessageQuote } | null>(null)
    const quoteHighlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const jumpRequestRef = useRef(0)
    const [attachment, setAttachment] = useState<CommunicationAttachment | null>(null)
    const [attachmentState, setAttachmentState] = useState<"idle" | "uploading">("idle")
    const [stickers, setStickers] = useState(bootstrap.stickers)
    const [stickerTrayOpen, setStickerTrayOpen] = useState(false)
    const [stickerUploadState, setStickerUploadState] = useState<"idle" | "uploading">("idle")
    const [error, setError] = useState<string | null>(null)
    const [actionMessageId, setActionMessageId] = useState<string | null>(null)
    const [actionAnchor, setActionAnchor] = useState<MessageActionAnchor | null>(null)
    const [actionView, setActionView] = useState<MessageActionView>("actions")
    const [recentReaction, setRecentReaction] = useState<string | null>(null)
    const [downloadingMessageId, setDownloadingMessageId] = useState<string | null>(null)
    const [swipePosition, setSwipePosition] = useState<{ id: string; offset: number; active: boolean } | null>(null)
    const [previewMedia, setPreviewMedia] = useState<MessageMediaPreview | null>(null)
    const [editingTeam, setEditingTeam] = useState<WorkspaceTeam | null | undefined>(undefined)
    const [showJumpToLatest, setShowJumpToLatest] = useState(false)
    const [atLatest, setAtLatest] = useState(true)
    const [documentVisible, setDocumentVisible] = useState(() => typeof document !== "undefined" && document.visibilityState === "visible")
    const [enteringMessageIds, setEnteringMessageIds] = useState<Set<string>>(() => new Set())
    const [typingByConversation, setTypingByConversation] = useState<NativeTypingByConversation>({})
    const messagePaneRef = useRef<HTMLDivElement | null>(null)
    const followLatestRef = useRef(true)
    const messageAnimationTimersRef = useRef<number[]>([])
    const knownMessageKeysRef = useRef(new Set(bootstrap.conversations.flatMap((conversation) => conversation.messages.map(messageAnimationKey))))
    const composerRef = useRef<HTMLElement | null>(null)
    const attachmentInputRef = useRef<HTMLInputElement | null>(null)
    const stickerInputRef = useRef<HTMLInputElement | null>(null)
    const swipeStartRef = useRef<MessageSwipe | null>(null)
    const selectedRef = useRef(selectedId)
    const conversationsRef = useRef(conversations)
    const sentTypingConversationRef = useRef<string | null>(null)
    const lastTypingBroadcastAtRef = useRef(0)
    const pendingReadRef = useRef<NativeReadCursor | null>(null)
    const editingDraftSnapshotRef = useRef("")
    const readRequestRef = useRef<string | null>(null)
    const workspaceTabActive = useWorkspaceTabActive()
    const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null
    const history = useConversationHistory(selectedId, selected?.messages ?? [], {
        hasMore: Boolean(selected?.messageWindowStart),
        load: async (before, signal) => {
            const conversationId = selectedId!
            const read = updates.beginRead()
            const query = new URLSearchParams({ conversationId, beforeId: before.id, beforeCreatedAt: before.createdAt })
            const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/messages?${query}`, { cache: "no-store", signal })
            const result = await response.json() as CommunicationHistoryPage<NativeMessage> & { error?: string }
            if (!response.ok || !Array.isArray(result.messages)) throw new Error(result.error ?? "Could not load earlier messages.")
            if (!signal.aborted) updates.mergeReadMessages(read, conversationId, result.messages)
            return result
        },
    })
    const messagePaneInteractions = useMessagePaneInteractions(composerRef)
    const selectingQuote = selected?.canWrite ? selected.messages.find((message) => message.id === replyingTo?.id && Boolean(message.body.trim()) && message.id !== message.clientRequestId) ?? null : null
    const cancelQuoteSelection = useCallback(() => setReplyingTo(null), [])
    const updateSelectedQuote = useCallback((messageId: string, quote: MessageQuote | null) => {
        setReplyingTo((current) => {
            if (!current || current.id !== messageId) return current
            if (current.selectedQuote?.start === quote?.start && current.selectedQuote?.end === quote?.end && current.selectedQuote?.text === quote?.text) return current
            return { ...current, selectedQuote: quote ?? undefined }
        })
    }, [])
    useEffect(() => () => { if (quoteHighlightTimer.current) clearTimeout(quoteHighlightTimer.current) }, [])
    const focusedMessageId = editingMessage?.id ?? replyingTo?.id ?? null
    const peopleById = useMemo(() => new Map([...bootstrap.people, ...bootstrap.formerPeople, { id: "be", name: "BE", avatarSrc: "/brand/betelgeze-logo.svg" }].map((person) => [person.id, person])), [bootstrap.formerPeople, bootstrap.people])

    useEffect(() => { selectedRef.current = selectedId; onSelectedConversationChange?.(selectedId) }, [onSelectedConversationChange, selectedId])
    useEffect(() => { conversationsRef.current = conversations }, [conversations])
    useEffect(() => { const update = () => setDocumentVisible(document.visibilityState === "visible"); document.addEventListener("visibilitychange", update); return () => document.removeEventListener("visibilitychange", update) }, [])
    useEffect(() => { const timer = window.setTimeout(() => setRecentReaction(localStorage.getItem(`betelgeze:communications:recent-reaction:${bootstrap.workspaceId}`)), 0); return () => window.clearTimeout(timer) }, [bootstrap.workspaceId])
    useConversationLayout(messagePaneRef, followLatestRef, selectedId, active && workspaceTabActive && documentVisible, setAtLatest, setShowJumpToLatest)
    useEffect(() => () => messageAnimationTimersRef.current.forEach((timer) => window.clearTimeout(timer)), [])
    useEffect(() => {
        const interval = window.setInterval(() => {
            const now = Date.now()
            setTypingByConversation((current) => {
                let next = current
                for (const [conversationId, users] of Object.entries(current)) {
                    for (const [userId, expiresAt] of Object.entries(users)) {
                        if (expiresAt <= now) next = updateNativeTyping(next, conversationId, userId, null)
                    }
                }
                return next
            })
        }, 1_000)
        return () => window.clearInterval(interval)
    }, [])



    const updateConversationMessages = useCallback((conversationId: string, incoming: NativeMessage[], animate = false, read?: ChatRead, acknowledgement = false) => {
        if (read) incoming = updates.mergeReadMessages(read, conversationId, incoming, acknowledgement)
        const newMessages = incoming.filter((message) => !knownMessageKeysRef.current.has(messageAnimationKey(message)))
        incoming.forEach((message) => knownMessageKeysRef.current.add(messageAnimationKey(message)))
        if (animate && newMessages.length && selectedRef.current === conversationId && messagePaneCanShowNewMessage(messagePaneRef.current, followLatestRef.current)) {
            const ids = newMessages.map((message) => message.id)
            setEnteringMessageIds((current) => new Set([...current, ...ids]))
            const timer = window.setTimeout(() => {
                setEnteringMessageIds((current) => new Set([...current].filter((id) => !ids.includes(id))))
                messageAnimationTimersRef.current = messageAnimationTimersRef.current.filter((candidate) => candidate !== timer)
            }, 320)
            messageAnimationTimersRef.current.push(timer)
        }
        for (const message of incoming) {
            setTypingByConversation((current) => updateNativeTyping(current, conversationId, message.senderUserId, null))
        }
        if (!read) setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, messages: mergeMessages(conversation.messages, incoming), updatedAt: incoming.at(-1)?.createdAt ?? conversation.updatedAt } : conversation).sort((left, right) => (right.messages.at(-1)?.createdAt ?? right.updatedAt).localeCompare(left.messages.at(-1)?.createdAt ?? left.updatedAt)))
    }, [setConversations, updates])

    const offline = useOfflineChat({
        userId: bootstrap.currentUser.id, workspaceId: bootstrap.workspaceId, workspaceSlug: bootstrap.workspaceSlug,
        kind: "native", conversations, people: bootstrap.people,
        onMessage: (conversationId, message) => updateConversationMessages(conversationId, [message as unknown as NativeMessage]),
        onRemove: (id) => updates.removeMessage(id),
    })
    const enqueueingRef = useRef(false)

    const persistReadCursor = useCallback(async (cursor: NativeReadCursor) => {
        pendingReadRef.current = cursor
        setReadCursors((current) => mergeCursor(current, cursor))
        if (readRequestRef.current === cursor.lastReadMessageId) return
        readRequestRef.current = cursor.lastReadMessageId
        try {
            const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: cursor.conversationId, messageId: cursor.lastReadMessageId }) })
            const result = await response.json().catch(() => null) as { cursor?: NativeReadCursor; notificationReadThrough?: string; error?: string } | null
            if (!response.ok || !result?.cursor) throw new Error(result?.error ?? "Could not save the read position.")
            setReadCursors((current) => mergeCursor(current, result.cursor!))
            if (result.notificationReadThrough) void dismissReadChatNotification(cursor.conversationId, result.notificationReadThrough)
            if (pendingReadRef.current?.conversationId === cursor.conversationId && pendingReadRef.current.lastReadMessageId === cursor.lastReadMessageId) pendingReadRef.current = null
        } finally {
            if (readRequestRef.current === cursor.lastReadMessageId) readRequestRef.current = null
        }
    }, [bootstrap.workspaceSlug])

    const flushPendingRead = useCallback(async () => {
        const pending = pendingReadRef.current
        if (pending) await persistReadCursor(pending)
    }, [persistReadCursor])

    const refresh = useCallback(async (selectId?: string | null) => {
        const read = updates.beginRead()
        const conversationId = selectId === undefined ? selectedRef.current : selectId
        const search = conversationId ? `?conversation=${encodeURIComponent(conversationId)}` : ""
        const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/conversations${search}`, { cache: "no-store" })
        const next = await response.json().catch(() => null) as NativeCommunicationsBootstrap | null
        if (!response.ok || !next) throw new Error("Could not refresh team conversations.")
        next.conversations.forEach((conversation) => conversation.messages.forEach((message) => knownMessageKeysRef.current.add(messageAnimationKey(message))))
        if (!updates.applySnapshot(read, next)) return
        setSchemaReady(next.schemaReady); setTeams(next.teams); setReadCursors((current) => next.readCursors.reduce((result, cursor) => mergeCursor(result, cursor), current)); setStickers(next.stickers)
        setSelectedId((current) => {
            const requested = selectId === undefined ? current : selectId
            return requested && next.conversations.some((conversation) => conversation.id === requested) ? requested : null
        })
        await flushPendingRead()
    }, [bootstrap.workspaceSlug, flushPendingRead, updates])

    useEffect(() => {
        if (!bootstrap.requestedDmUserId) return
        let cancelled = false
        void fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/conversations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: bootstrap.requestedDmUserId }) })
            .then(async (response) => { const result = await response.json().catch(() => null) as { conversationId?: string; error?: string } | null; if (!response.ok || !result?.conversationId) throw new Error(result?.error ?? "Could not open direct message."); if (!cancelled) await refresh(result.conversationId) })
            .catch((openError) => { if (!cancelled) setError(openError instanceof Error ? openError.message : "Could not open direct message.") })
        return () => { cancelled = true }
    }, [bootstrap.requestedDmUserId, bootstrap.workspaceSlug, refresh])

    function selectConversation(id: string | null) {
        closeWorkspaceComposer(composerRef.current)
        void flushPendingRead().catch(() => undefined)
        followLatestRef.current = true; setAtLatest(true); setShowJumpToLatest(false)
        jumpRequestRef.current++; setQuoteHighlight(null);
        setSelectedId(id); setReplyingTo(null); setEditingMessage(null); setEditState("idle"); setActionMessageId(null); setActionView("actions"); setAttachment(null); setError(null)
        setDraft(id ? readChatDraft(`betelgeze:native-chat:draft:${bootstrap.currentUser.id}:${bootstrap.workspaceId}:${id}`) : "")
    }

    useEffect(() => {
        const key = selectedId ? `betelgeze:native-chat:draft:${bootstrap.currentUser.id}:${bootstrap.workspaceId}:${selectedId}` : null
        // Read before effects can write the empty initial composer over a draft.
        const saved = key ? readChatDraft(key) : ""
        const timer = window.setTimeout(() => { restoredDraftKey.current = key; setDraft(saved) }, 0)
        return () => window.clearTimeout(timer)
    }, [bootstrap.currentUser.id, bootstrap.workspaceId, selectedId])
    useEffect(() => {
        const key = selectedId ? `betelgeze:native-chat:draft:${bootstrap.currentUser.id}:${bootstrap.workspaceId}:${selectedId}` : null
        if (!key || restoredDraftKey.current !== key || editingMessage) return
        writeChatDraft(key, draft)
    }, [bootstrap.currentUser.id, bootstrap.workspaceId, draft, selectedId, editingMessage])

    useEffect(() => {
        if (!selectedId) return
        if (bootstrappedSelection.current === selectedId) { bootstrappedSelection.current = null; return }
        const controller = new AbortController()
        const read = updates.beginRead()
        void fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/messages?conversationId=${encodeURIComponent(selectedId)}`, { signal: controller.signal })
            .then(async (response) => response.ok ? response.json() as Promise<{ messages?: NativeMessage[] }> : null)
            .then((result) => { if (result?.messages) updateConversationMessages(selectedId, result.messages, false, read) })
            .catch(() => undefined)
        return () => controller.abort()
    }, [bootstrap.workspaceSlug, selectedId, updateConversationMessages, updates])

    const registerRealtime = useCallback((channel: ReturnType<typeof supabase.channel>) => channel
                .on("broadcast", { event: NATIVE_TYPING_EVENT }, ({ payload }) => {
                    const typing = record(payload)
                    const conversationId = text(typing.conversationId)
                    const userId = text(typing.userId)
                    if (!conversationId || !userId || userId === bootstrap.currentUser.id) return
                    const conversation = conversationsRef.current.find((candidate) => candidate.id === conversationId)
                    if (!conversation?.memberIds.includes(userId)) return
                    setTypingByConversation((current) => updateNativeTyping(current, conversationId, userId, typing.typing === true ? Date.now() + NATIVE_TYPING_EXPIRY_MS : null))
                })
                .on("postgres_changes", { event: "*", schema: "public", table: "workspace_native_messages", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, (payload) => {
                    if (payload.eventType === "DELETE") {
                        const deleted = record(payload.old); const messageId = text(deleted.id)
                        if (messageId) {
                            updates.removeMessage(messageId)

                            setReplyingTo((current) => current?.id === messageId ? null : current)
                            setEditingMessage((current) => current?.id === messageId ? null : current)
                            setActionMessageId((current) => current === messageId ? null : current)
                        }
                        return
                    }
                    const message = realtimeMessage(payload.new)
                    if (message) updateConversationMessages(message.conversationId, [message], true)
                    else {
                        const row = record(payload.new)
                        const conversationId = text(row.conversation_id)
                        const messageId = text(row.id)
                        const read = updates.beginRead()
                        if (conversationId && messageId) void fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/messages?conversationId=${encodeURIComponent(conversationId)}&messageId=${encodeURIComponent(messageId)}`, { cache: "no-store" })
                            .then(async (response) => response.ok ? response.json() as Promise<{ message?: NativeMessage }> : null)
                            .then((result) => { if (result?.message) updateConversationMessages(conversationId, [result.message], true, read) })
                            .catch(() => undefined)
                    }
                })
                .on("postgres_changes", { event: "*", schema: "public", table: "workspace_native_reactions", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, (payload) => {
                    const row = record(payload.eventType === "DELETE" ? payload.old : payload.new); const messageId = text(row.message_id); const reactorUserId = text(row.reactor_user_id)
                    if (!messageId || !reactorUserId) return
                    if (payload.eventType === "DELETE") updates.receiveReaction(`${messageId}:${reactorUserId}`, null, text(row.updated_at) ?? undefined)
                    else { const id = text(row.id); const conversationId = text(row.conversation_id); const emoji = text(row.emoji); const updatedAt = text(row.updated_at); if (id && conversationId && emoji && updatedAt) updates.receiveReaction(`${messageId}:${reactorUserId}`, { id, conversationId, messageId, reactorUserId, emoji, updatedAt }) }
                })
                .on("postgres_changes", { event: "*", schema: "public", table: "workspace_native_read_cursors", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, (payload) => { const row = record(payload.new); const conversationId = text(row.conversation_id); const userId = text(row.user_id); const lastReadAt = text(row.last_read_at); if (conversationId && userId && lastReadAt) setReadCursors((current) => [...current.filter((cursor) => !(cursor.conversationId === conversationId && cursor.userId === userId)), { conversationId, userId, lastReadMessageId: text(row.last_read_message_id), lastReadAt }]) })
                .on("postgres_changes", { event: "*", schema: "public", table: "workspace_native_conversations", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, () => { void refresh().catch(() => undefined) })
                .on("postgres_changes", { event: "*", schema: "public", table: "workspace_team_members", filter: `workspace_id=eq.${bootstrap.workspaceId}` }, () => { void refresh().catch(() => undefined) })
        , [bootstrap.currentUser.id, bootstrap.workspaceId, bootstrap.workspaceSlug, refresh, supabase, updateConversationMessages, updates])

    const connection = useReliableCommunicationsRealtime({ active, privateChannel: true, register: registerRealtime, schemaReady, supabase, synchronize: refresh, topic: `communications:${bootstrap.workspaceSlug}` })
    const sendRealtimeBroadcast = connection.sendBroadcast

    const stopNativeTyping = useCallback((conversationId: string | null) => {
        if (!conversationId) return
        if (sentTypingConversationRef.current === conversationId) sentTypingConversationRef.current = null
        lastTypingBroadcastAtRef.current = 0
        void sendRealtimeBroadcast(NATIVE_TYPING_EVENT, { conversationId, userId: bootstrap.currentUser.id, typing: false })
    }, [bootstrap.currentUser.id, sendRealtimeBroadcast])

    function handleDraftChange(value: string) {
        setDraft(value)
        if (editingMessage) {
            stopNativeTyping(sentTypingConversationRef.current)
            return
        }
        if (!selected?.canWrite || !value.trim() || !active || !workspaceTabActive || !documentVisible || connection.state !== "live") {
            stopNativeTyping(sentTypingConversationRef.current)
            return
        }
        const now = Date.now()
        if (sentTypingConversationRef.current === selected.id && now - lastTypingBroadcastAtRef.current < NATIVE_TYPING_REFRESH_MS) return
        sentTypingConversationRef.current = selected.id
        lastTypingBroadcastAtRef.current = now
        void sendRealtimeBroadcast(NATIVE_TYPING_EVENT, { conversationId: selected.id, userId: bootstrap.currentUser.id, typing: true })
    }

    useEffect(() => {
        const sentConversationId = sentTypingConversationRef.current
        if (sentConversationId && sentConversationId !== selectedId) stopNativeTyping(sentConversationId)
    }, [selectedId, stopNativeTyping])

    useEffect(() => {
        if (connection.state === "live") return
        sentTypingConversationRef.current = null
        lastTypingBroadcastAtRef.current = 0
        const timer = window.setTimeout(() => setTypingByConversation({}), 0)
        return () => window.clearTimeout(timer)
    }, [connection.state])

    useEffect(() => () => stopNativeTyping(sentTypingConversationRef.current), [stopNativeTyping])

    useEffect(() => onConnectionStateChange?.(connection.state), [connection.state, onConnectionStateChange])

    const unreadCount = useMemo(() => conversations.reduce((total, conversation) => {
        const ownCursor = readCursors.find((cursor) => cursor.conversationId === conversation.id && cursor.userId === bootstrap.currentUser.id)
        const visiblyReading = conversation.id === selectedId && active && workspaceTabActive && documentVisible && atLatest
        return total + nativeConversationUnreadCount(conversation, ownCursor, bootstrap.currentUser.id, visiblyReading)
    }, 0), [active, atLatest, bootstrap.currentUser.id, conversations, documentVisible, readCursors, selectedId, workspaceTabActive])

    useEffect(() => onUnreadCountChange?.(unreadCount), [onUnreadCountChange, unreadCount])

    useEffect(() => {
        if (!active || !workspaceTabActive || !documentVisible || !atLatest || !selectedId || !selected?.messages.length || !schemaReady) return
        const latest = selected.messages.at(-1)!
        const current = readCursors.find((cursor) => cursor.conversationId === selectedId && cursor.userId === bootstrap.currentUser.id)
        if (current?.lastReadMessageId === latest.id) {
            void dismissReadChatNotification(selectedId, latest.createdAt)
            return
        }
        const cursor: NativeReadCursor = { conversationId: selectedId, userId: bootstrap.currentUser.id, lastReadMessageId: latest.id, lastReadAt: latest.createdAt }
        const timer = window.setTimeout(() => { void persistReadCursor(cursor).catch(() => undefined) }, 0)
        return () => window.clearTimeout(timer)
    }, [active, atLatest, bootstrap.currentUser.id, documentVisible, persistReadCursor, readCursors, schemaReady, selected?.messages, selectedId, workspaceTabActive])

    async function uploadAttachment(file: File) {
        if (!selected || attachmentState === "uploading") return
        const validation = validateNativeAttachmentFile(file)
        if (validation.error) { setError(validation.error); if (attachmentInputRef.current) attachmentInputRef.current.value = ""; return }
        setAttachmentState("uploading"); setError(null)
        try {
            const { preview, ...media } = await prepareCommunicationMedia(file)
            const preparedResponse = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/attachments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: selected.id, name: file.name, size: file.size, type: file.type, media, previewSize: preview?.size }) })
            const prepared = await preparedResponse.json().catch(() => null) as { uploadUrl?: string; previewUploadUrl?: string; uploadHeaders?: Record<string, string>; attachment?: CommunicationAttachment; error?: string } | null
            if (!preparedResponse.ok || !prepared?.uploadUrl || !prepared.attachment) throw new Error(prepared?.error ?? "Could not prepare attachment.")
            const uploaded = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": prepared.attachment.mimeType, ...(prepared.uploadHeaders ?? {}) }, body: file })
            if (!uploaded.ok) throw new Error("Could not upload attachment.")
            if (preview && prepared.previewUploadUrl) {
                const previewResponse = await fetch(prepared.previewUploadUrl, { method: "PUT", headers: { "Content-Type": "image/webp", ...(prepared.uploadHeaders ?? {}) }, body: preview }).catch(() => null)
                prepared.attachment.hasPreview = Boolean(previewResponse?.ok)
            }
            if (selectedRef.current === selected.id) setAttachment(prepared.attachment)
        } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "Could not upload attachment.") }
        finally { setAttachmentState("idle"); if (attachmentInputRef.current) attachmentInputRef.current.value = "" }
    }

    async function uploadSticker(file: File) {
        if (stickerUploadState === "uploading") return
        setStickerUploadState("uploading"); setError(null)
        try {
            const formData = new FormData(); formData.set("file", file)
            const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/stickers`, { method: "POST", body: formData })
            const result = await response.json().catch(() => null) as { sticker?: CommunicationSticker; error?: string } | null
            if (!response.ok || !result?.sticker) throw new Error(result?.error ?? "Could not add this sticker.")
            setStickers((current) => current.some((sticker) => sticker.id === result.sticker!.id) ? current : [...current, result.sticker!])
        } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "Could not add this sticker.") }
        finally { setStickerUploadState("idle"); if (stickerInputRef.current) stickerInputRef.current.value = "" }
    }

    async function sendSticker(sticker: CommunicationSticker) {
        if (!selected?.canWrite) return
        const clientRequestId = crypto.randomUUID(); const replyTarget = replyingTo
        const stickerAttachment: CommunicationAttachment = { kind: "sticker", fileName: sticker.fileName, mimeType: "image/webp", size: sticker.size, storagePath: sticker.storagePath, url: sticker.url }
        const optimistic: NativeMessage = { id: clientRequestId, clientRequestId, conversationId: selected.id, senderUserId: bootstrap.currentUser.id, senderWorkspaceRole: bootstrap.currentUserRole, body: "", replyToMessageId: replyTarget?.id ?? null, quote: replyTarget?.selectedQuote ?? null, attachment: stickerAttachment, createdAt: new Date().toISOString(), editedAt: null }
        if (enqueueingRef.current) return
        enqueueingRef.current = true
        try {
            await offline.queue(selected.id, selected.title, { conversationId: selected.id, clientRequestId, body: "", replyToMessageId: replyTarget?.id, quote: replyTarget?.selectedQuote ?? null, attachment: stickerAttachment }, { ...optimistic })
            updateConversationMessages(selected.id, [optimistic], true)
            if (selectedRef.current === selected.id) { setStickerTrayOpen(false); setReplyingTo(null); setError(null) }
        } catch { setError("Could not save this message on your device. Your draft is still here; try again.") }
        finally { enqueueingRef.current = false }
    }

    async function sendMessage() {
        if (!selected?.canWrite) return
        const body = draft.trim(); if (!body && !attachment) return
        stopNativeTyping(selected.id)
        const clientRequestId = crypto.randomUUID(); const replyTarget = replyingTo
        const optimistic: NativeMessage = { id: clientRequestId, clientRequestId, conversationId: selected.id, senderUserId: bootstrap.currentUser.id, senderWorkspaceRole: bootstrap.currentUserRole, body, replyToMessageId: replyTarget?.id ?? null, quote: replyTarget?.selectedQuote ?? null, attachment, createdAt: new Date().toISOString(), editedAt: null }
        if (enqueueingRef.current) return
        enqueueingRef.current = true
        try {
            await offline.queue(selected.id, selected.title, { conversationId: selected.id, clientRequestId, body, replyToMessageId: replyTarget?.id, quote: replyTarget?.selectedQuote ?? null, attachment: optimistic.attachment }, { ...optimistic })
            updateConversationMessages(selected.id, [optimistic], true)
            if (selectedRef.current === selected.id) {
                setDraft((current) => current.trim() === body ? "" : current)
                setReplyingTo((current) => current === replyTarget ? null : current)
                setAttachment((current) => current === optimistic.attachment ? null : current)
                setError(null)
            }
        } catch { setError("Could not save this message on your device. Your draft is still here; try again.") }
        finally { enqueueingRef.current = false }
    }

    function startEditingMessage(message: NativeMessage) {
        if (!selected?.canWrite || !nativeMessageCanEdit(message, bootstrap.currentUser.id)) return
        editingDraftSnapshotRef.current = draft
        stopNativeTyping(selected.id)
        setEditingMessage(message)
        setEditState("idle")
        setDraft(message.body)
        setReplyingTo(null)
        setAttachment(null)
        setStickerTrayOpen(false)
        setActionMessageId(null)
        setError(null)
        window.requestAnimationFrame(() => composerRef.current?.focus({ preventScroll: true }))
    }

    function cancelEditingMessage() {
        setEditingMessage(null)
        setEditState("idle")
        setDraft(editingDraftSnapshotRef.current)
        setError(null)
        window.requestAnimationFrame(() => composerRef.current?.focus({ preventScroll: true }))
    }

    async function saveEditedMessage() {
        if (!selected?.canWrite || !editingMessage || editState === "saving") return
        const body = draft.trim()
        if (!body || body === editingMessage.body.trim()) return
        const conversationId = selected.id
        const messageId = editingMessage.id
        setEditState("saving")
        setError(null)
        try {
            await updates.mutateMessage(messageId, { ...editingMessage, body }, async () => {
                const result = await chatMutationRequest<{ message?: NativeMessage }>(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/messages`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, messageId, body }) })
                if (!result.message) throw new ChatMutationError("Could not confirm the edit.", true)
                return result.message
            })
            setEditingMessage((current) => current?.id === messageId ? null : current)
            if (selectedRef.current === conversationId) setDraft(editingDraftSnapshotRef.current)
        } catch (error) { setError(error instanceof Error ? error.message : "Could not edit message.") }
        finally { setEditState("idle"); void refresh().catch(() => undefined) }
    }

    async function toggleCheckbox(message: NativeMessage, line: number, checked: boolean, expectedBody: string) {
        const body = chatCheckboxBody(expectedBody, line, checked)
        if (body === null) throw new ChatMutationError("Checklist item not found.")
        let savedBody = body
        try {
            await updates.mutateMessage(message.id, { ...message, body }, async () => {
                savedBody = await requestChatCheckbox(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/checklist`, { conversationId: message.conversationId, messageId: message.id, line, checked, expectedBody })
                return { ...message, body: savedBody }
            })
            return savedBody
        } finally { void refresh().catch(() => undefined) }
    }

    async function sendReaction(message: NativeMessage, emoji: string) {
        if (!selected?.canWrite) return
        const conversationId = selected.id
        const optimistic: NativeReaction | null = emoji ? { id: `optimistic:${message.id}`, conversationId, messageId: message.id, reactorUserId: bootstrap.currentUser.id, emoji, updatedAt: new Date().toISOString() } : null
        setActionMessageId(null)
        setError(null)
        try {
            await updates.mutateReaction(`${message.id}:${bootstrap.currentUser.id}`, optimistic, async () => {
                const result = await chatMutationRequest<{ reaction: NativeReaction | null }>(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/reactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, messageId: message.id, emoji }) })
                if (!("reaction" in result)) throw new ChatMutationError("Could not confirm the reaction.", true)
                return result.reaction
            })
        } catch (error) { setError(error instanceof Error ? error.message : "Could not send reaction.") }
        finally { void refresh().catch(() => undefined) }
    }

    function rememberRecentReaction(emoji: string) {
        setRecentReaction(emoji)
        localStorage.setItem(`betelgeze:communications:recent-reaction:${bootstrap.workspaceId}`, emoji)
    }

    async function copyMessage(message: NativeMessage) {
        setActionMessageId(null)
        setError(null)
        try {
            await copyMessageText(messagePreview(message))
        } catch (copyError) {
            setError(copyError instanceof Error ? copyError.message : "Could not copy this message.")
        }
    }

    async function downloadAttachment(message: NativeMessage) {
        if (!message.attachment || message.attachment.kind === "sticker" || downloadingMessageId) return
        setActionMessageId(null)
        setDownloadingMessageId(message.id)
        setError(null)
        try {
            await downloadMessageAttachment(message.attachment.url, message.attachment.fileName)
        } catch (downloadError) {
            setError(downloadError instanceof Error ? downloadError.message : "Could not download this attachment.")
        } finally {
            setDownloadingMessageId(null)
        }
    }

    async function togglePinnedMessage(message: NativeMessage) {
        if (!selected) return
        const conversationId = selected.id
        const pinnedMessageId = selected.pinnedMessageId === message.id ? null : message.id
        setActionMessageId(null)
        setError(null)
        try {
            await updates.mutatePin(conversationId, pinnedMessageId, async () => {
                const result = await chatMutationRequest<{ pinnedMessageId: string | null }>(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/pins`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, messageId: pinnedMessageId }) })
                if (result.pinnedMessageId !== pinnedMessageId) throw new ChatMutationError("Could not confirm the pinned message.", true)
            })
        } catch (error) { setError(error instanceof Error ? error.message : "Could not pin message.") }
        finally { void refresh().catch(() => undefined) }
    }

    function startQuotingMessage(message: NativeMessage) {
        if (!selected?.canWrite) return
        setActionMessageId(null)
        setReplyingTo(message)
        setQuoteHighlight(null)
        followLatestRef.current = false
        composerRef.current?.focus({ preventScroll: true })
    }

    async function jumpToMessage(messageId: string, quote?: MessageQuote | null) {
        const conversationId = selectedId
        const requestId = ++jumpRequestRef.current
        if (!conversationId) return
        followLatestRef.current = false
        if (quoteHighlightTimer.current) clearTimeout(quoteHighlightTimer.current)
        setQuoteHighlight(null)
        let message = selected?.messages.find((candidate) => candidate.id === messageId)
        if (!message) {
            const read = updates.beginRead()
            const params = new URLSearchParams({ conversationId, messageId })
            const response = await fetch(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/messages?${params}`).catch(() => null)
            const result = response ? await response.json().catch(() => null) as { message?: NativeMessage; error?: string } | null : null
            if (selectedRef.current !== conversationId || jumpRequestRef.current !== requestId) return
            if (!result?.message || !response?.ok) { setError(result?.error ?? "The original message is unavailable."); return }
            message = result.message
            // Include fetched older messages in the mounted history before scrolling.
            const incoming = message
            updateConversationMessages(conversationId, [incoming], false, read)
            history.reveal(messageId, incoming)
        } else history.reveal(messageId)
        const highlight = quote ? resolveMessageQuote(message.body, quote) : null
        if (quote && !highlight) setError("The quoted text has changed. The original message is shown below.")
        if (highlight) setQuoteHighlight({ messageId, quote: highlight })
        // React commits fetched history and marks before the pane is measured.
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            if (selectedRef.current !== conversationId || jumpRequestRef.current !== requestId) return
            const pane = messagePaneRef.current
            const target = pane?.querySelector<HTMLElement>(`[data-message-interaction="${CSS.escape(messageId)}"]`)
            if (!pane || !target) return
            setAtLatest(false)
            setShowJumpToLatest(true)
            const paneBounds = pane.getBoundingClientRect()
            const targetBounds = (target.querySelector<HTMLElement>("[data-chat-quote-highlight]") ?? target).getBoundingClientRect()
            pane.scrollTo({ top: pane.scrollTop + targetBounds.top - paneBounds.top - (pane.clientHeight - targetBounds.height) / 2, behavior: "instant" })
            if (!quote) target.animate([{ filter: "brightness(1.5)" }, { filter: "brightness(1)" }], { duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900 })
            if (highlight) quoteHighlightTimer.current = setTimeout(() => setQuoteHighlight(null), 3000)
        }))
    }

    async function deleteMessage(message: NativeMessage) {
        if (!selected?.canWrite || message.clientRequestId === message.id || message.conversationId !== selected.id || !selected.messages.some((candidate) => candidate.id === message.id)) return
        closeWorkspaceComposer(composerRef.current)
        if (!window.confirm(message.senderUserId === bootstrap.currentUser.id ? "Delete this message? This cannot be undone." : "Remove this message for everyone? This cannot be undone.")) return
        const conversationId = selected.id
        setActionMessageId(null)
        setReplyingTo((current) => current?.id === message.id ? null : current)
        setEditingMessage((current) => current?.id === message.id ? null : current)
        try {
            await updates.mutateMessage(message.id, null, async () => {
                const params = new URLSearchParams({ conversationId, messageId: message.id })
                const result = await chatMutationRequest<{ deleted: boolean; conversationId: string; messageId: string }>(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/messages?${params}`, { method: "DELETE" })
                if (!result.deleted || result.conversationId !== conversationId || result.messageId !== message.id) throw new ChatMutationError("Could not confirm deletion.", true)
                return null
            })
        } catch (error) { setError(error instanceof Error ? error.message : "Could not delete message.") }
        finally { void refresh().catch(() => undefined) }
    }

    async function clearPrivateChat() {
        if (!selected || selected.kind !== "direct") return
        closeWorkspaceComposer(composerRef.current)
        if (!window.confirm("Clear this private chat from your view? The other participant will keep their history.")) return
        const conversationId = selected.id
        let request: Promise<{ cleared: boolean }> | undefined
        const clear = async () => {
            request ??= chatMutationRequest<{ cleared: boolean }>(`/api/workspaces/${bootstrap.workspaceSlug}/communications/native/clear`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId }) })
            if (!(await request).cleared) throw new ChatMutationError("Could not confirm chat clearance.", true)
            return null
        }
        try { if (selected.messages.length) await Promise.all(selected.messages.map((message) => updates.mutateMessage(message.id, null, clear))); else await clear() }
        catch (error) { setError(error instanceof Error ? error.message : "Could not clear this private chat.") }
        finally { void refresh().catch(() => undefined) }
    }

    const normalizedSearch = search.trim().toLowerCase()
    const visible = conversations.filter((conversation) => (showArchived ? conversation.archived : !conversation.archived) && (!normalizedSearch || `${conversation.title} ${conversation.messages.at(-1)?.body ?? ""}`.toLowerCase().includes(normalizedSearch)))
    const currentTeam = selected?.teamId ? teams.find((team) => team.id === selected.teamId) : null
    const pinnedMessage = selected?.pinnedMessageId ? selected.messages.find((message) => message.id === selected.pinnedMessageId) ?? null : null
    const pinnedPreview = pinnedMessage ? messagePreview(pinnedMessage).split(/\r?\n/, 1)[0] : selected?.pinnedMessageId && selected.kind !== "direct" ? "Pinned message unavailable" : null
    const selectedTypingPeople = selected ? Object.keys(typingByConversation[selected.id] ?? {}).flatMap((userId) => peopleById.get(userId) ?? []) : []
    const selectedTypingLabel = selectedTypingPeople.length > 1
        ? `${selectedTypingPeople.map((person) => person.name).join(", ")} are typing`
        : `${selectedTypingPeople[0]?.name ?? selected?.title ?? "Someone"} is typing`

    return <section data-workspace-record-title={active ? selected?.title : undefined} aria-label="Team communications" className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-black">
        {!schemaReady ? <div className="shrink-0 border-b border-amber-900 bg-amber-950 px-4 py-2 text-center text-xs text-amber-100">Apply the Teams database migration to enable native messaging.</div> : null}
        <ResizableConversationColumns listWidth={conversationListWidth} onListWidthChange={onConversationListWidthChange}>
            <aside className={`${selected ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-r border-neutral-800 bg-neutral-950`}>
                <div className="shrink-0 border-b border-neutral-800 p-3">
                    <div className="flex items-center gap-1"><div role="tablist" className="flex items-center gap-1"><button type="button" role="tab" aria-selected="false" onClick={onOpenClients} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium text-neutral-400 hover:bg-neutral-900 hover:text-white">Clients<UnreadMessageCount count={clientUnreadCount ?? 0} label="unread Client messages" /></button><button type="button" role="tab" aria-selected="true" className="inline-flex h-8 items-center rounded-lg bg-neutral-800 px-3 text-xs font-semibold text-white">Team</button></div><span className="ml-auto"><CommunicationsConnectionStatus state={connection.state} error={connection.error} /></span></div>
                    <label className="relative mt-3 block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600"><SearchIcon /></span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search team conversations" className="h-10 w-full rounded-lg border border-neutral-800 bg-black pl-9 pr-3 text-sm outline-none placeholder:text-neutral-600" /></label>
                    {bootstrap.canManageTeams && teams.some((team) => team.archivedAt) ? <button type="button" onClick={() => { setShowArchived((value) => !value); setSelectedId(null) }} className={`mt-2 text-[11px] ${showArchived ? "text-white" : "text-neutral-500"}`}>{showArchived ? "← Active conversations" : "View archived groups"}</button> : null}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">{visible.length ? visible.map((conversation) => {
                    const latest = conversation.messages.at(-1)
                    const showTypingPreview = conversation.id !== selectedId && Object.keys(typingByConversation[conversation.id] ?? {}).length > 0
                    const ownCursor = readCursors.find((cursor) => cursor.conversationId === conversation.id && cursor.userId === bootstrap.currentUser.id)
                    const visiblyReading = conversation.id === selectedId && active && workspaceTabActive && documentVisible && atLatest
                    const unread = nativeConversationUnreadCount(conversation, ownCursor, bootstrap.currentUser.id, visiblyReading)
                    const latestRead = Boolean(latest && readCursors.some((cursor) => cursor.conversationId === conversation.id && cursor.userId !== latest.senderUserId && cursor.lastReadAt >= latest.createdAt))
                    return <button key={conversation.id} type="button" onClick={() => selectConversation(conversation.id)} className={`grid w-full grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b border-neutral-900 px-4 py-3.5 text-left ${selectedId === conversation.id ? "bg-neutral-900" : "hover:bg-black"}`}><TeamAvatar conversation={conversation} currentUserId={bootstrap.currentUser.id} /><span className="min-w-0"><span className="flex items-start justify-between gap-3"><span className="truncate text-sm font-semibold">{conversation.title}</span>{latest ? <time className={unread ? "text-[11px] text-white" : "text-[11px] text-neutral-600"}>{formatRelativeTime(latest.createdAt)}</time> : null}</span><span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-neutral-500">{!showTypingPreview && latest?.senderUserId === bootstrap.currentUser.id ? <NativeDeliveryTicks message={latest} read={latestRead} /> : null}<span className={`truncate ${showTypingPreview ? "font-medium text-neutral-300" : ""}`}>{showTypingPreview ? "typing…" : latest ? `${latest.senderUserId === bootstrap.currentUser.id ? "You: " : ""}${messagePreview(latest)}` : conversation.subtitle}</span>{unread ? <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-black">{unread}</span> : null}</span></span></button>
                }) : <div className="p-6 text-center"><p className="text-sm text-neutral-300">{showArchived ? "No archived teams" : "No team conversations yet"}</p><p className="mt-2 text-xs text-neutral-600">{showArchived ? "Archived team history will appear here." : "Open a profile to start a DM or create a team."}</p></div>}</div>
            </aside>
            <ConversationMedia active={active && workspaceTabActive && documentVisible}><NativeChatViewport className={`${selected ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col overflow-hidden bg-black`}>
                {selected ? <>
                    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-3 sm:px-4">
                        <button type="button" onClick={() => selectConversation(null)} aria-label="Back to team conversations" className="inline-flex h-10 w-10 shrink-0 items-center justify-center text-neutral-400 lg:hidden"><BackIcon /></button>
                        <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (selected.system) return; if (selected.kind === "direct") openWorkspaceMemberProfile(selected.memberIds.find((id) => id !== bootstrap.currentUser.id) ?? bootstrap.currentUser.id); else if (currentTeam) setEditingTeam(currentTeam) }} disabled={selected.system} aria-label={selected.system ? "BE · Private updates" : selected.kind === "direct" ? `Open ${selected.title} profile` : `View ${selected.title} members`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left outline-none hover:text-neutral-200 focus-visible:ring-2 focus-visible:ring-neutral-600">
                            <span className="h-9 w-9 shrink-0 overflow-hidden rounded-full">{selected.kind === "direct" ? <Avatar src={selected.avatarSrc} name={selected.title} className="h-full w-full" /> : <span className="flex h-full w-full items-center justify-center rounded-full bg-neutral-800"><TeamIcon /></span>}</span>
                            <span className="min-w-0"><span className="block truncate text-sm font-semibold">{selected.title}</span><span className="block truncate text-[11px] text-neutral-600">{selected.archived ? "Archived · read-only" : selected.subtitle}</span></span>
                        </button>
                        {selected.kind === "direct" ? <button type="button" onClick={() => void clearPrivateChat()} className="h-8 px-2 text-[11px] font-medium text-neutral-500 hover:text-white">Clear</button> : null}
                        <CommunicationsConnectionStatus state={connection.state} error={connection.error} />
                    </header>
                    {selected.pinnedMessageId && pinnedPreview ? <PinnedMessageBar preview={pinnedPreview} onClick={() => jumpToMessage(selected.pinnedMessageId!)} /> : null}
                    <ChatMotionViewport key={selectedId}>
                    <div className="relative min-h-0 flex-1"><div key={selectedId} data-message-pane tabIndex={0} ref={messagePaneRef} {...messagePaneInteractions} style={{ overflowAnchor: "none" }} className="invisible data-[positioned=true]:visible h-full touch-pan-y overflow-x-hidden overflow-y-auto overscroll-x-none overscroll-y-contain bg-[radial-gradient(circle_at_top,_rgba(38,38,38,0.5),_transparent_38%)] px-3 py-5 sm:px-6"><div className="mx-auto flex min-h-full w-full min-w-0 max-w-3xl flex-col gap-2 lg:max-w-none">
                        {selected.messages.length ? <div aria-hidden="true" className="mt-auto" /> : null}
                            {history.hasEarlier ? <button type="button" disabled={history.loadingEarlier} onClick={() => { followLatestRef.current = false; void history.loadEarlier() }} className="mx-auto shrink-0 px-3 py-2 text-xs text-neutral-500 hover:text-white">{history.loadingEarlier ? "Loading earlier messages…" : "Load earlier messages"}</button> : null}
                            {history.historyError ? <p role="alert" className="px-3 py-2 text-center text-xs text-red-400">{history.historyError}</p> : null}
                        {selected.messages.length ? selected.messages.slice(history.startIndex).map((message, visibleIndex) => {
                            const index = history.startIndex + visibleIndex
                        const own = message.senderUserId === bootstrap.currentUser.id
                        const quoteSelectionMuted = Boolean(selectingQuote && selectingQuote.id !== message.id)
                        const sender = message.senderUserId === "be" ? { name: "BE", avatarSrc: "/brand/betelgeze-logo.svg", former: false } : peopleById.get(message.senderUserId)
                        const reply = message.replyToMessageId ? selected.messages.find((candidate) => candidate.id === message.replyToMessageId) ?? null : null
                        const messageReactions = reactions.filter((reaction) => reaction.messageId === message.id)
                        const ownReaction = messageReactions.find((reaction) => reaction.reactorUserId === bootstrap.currentUser.id)
                        const readers = readCursors.filter((cursor) => cursor.conversationId === selected.id && cursor.userId !== message.senderUserId && cursor.lastReadAt >= message.createdAt).flatMap((cursor) => peopleById.get(cursor.userId) ?? [])
                        const showDay = index === 0 || !sameDay(selected.messages[index - 1].createdAt, message.createdAt)
                        const swipeOffset = swipePosition?.id === message.id ? swipePosition.offset : 0
                        const canModerate = bootstrap.currentUserRole === "owner"
                            ? message.senderWorkspaceRole === "admin" || message.senderWorkspaceRole === "staff"
                            : bootstrap.currentUserRole === "admin" && message.senderWorkspaceRole === "staff"
                        const canDelete = message.clientRequestId !== message.id && (own || canModerate)
                        const canPin = selected.canWrite && message.clientRequestId !== message.id
                        const canEdit = selected.canWrite && nativeMessageCanEdit(message, bootstrap.currentUser.id)
                        const isSticker = message.attachment?.kind === "sticker"
                        const canSaveAttachment = Boolean(message.attachment && !isSticker && !own)
                        const saveAttachmentLabel = `Download ${message.attachment?.fileName ?? "attachment"}`
                        return <Fragment key={messageAnimationKey(message)}>
                            {showDay ? <div className="my-3 flex justify-center"><time className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-[10px] text-neutral-500">{messageDay(message.createdAt)}</time></div> : null}
                            <div data-message-scroll-anchor={messageAnimationKey(message)} data-message-interaction={message.id} inert={quoteSelectionMuted} className={`relative flex items-end transition-[filter,opacity,transform] duration-150 ${own ? "justify-end origin-right" : "justify-start origin-left"} ${selectingQuote ? quoteSelectionMuted ? "pointer-events-none select-none opacity-30 blur-[1px]" : "z-10 scale-[1.03]" : focusedMessageId ? focusedMessageId === message.id ? "pointer-events-none z-10 scale-[1.03]" : "pointer-events-none opacity-30 blur-[1px]" : ""} ${!quoteSelectionMuted && enteringMessageIds.has(message.id) ? own ? "betelgeze-message-enter-right" : "betelgeze-message-enter-left" : ""}`}>
                                <span aria-hidden="true" style={{ opacity: Math.min(1, Math.abs(swipeOffset) / 36) }} className={`pointer-events-none absolute -inset-x-3 inset-y-0 lg:hidden ${swipeOffset < 0 ? "bg-gradient-to-l from-red-600/45 via-red-950/20 to-transparent" : "bg-gradient-to-r from-white/20 via-white/5 to-transparent"}`} />
                                <span aria-hidden="true" style={{ top: "50%", opacity: Math.min(1, Math.max(0, swipeOffset) / 38), transform: `translateY(-50%) scale(${0.72 + Math.min(0.28, Math.max(0, swipeOffset) / 190)})` }} className="pointer-events-none absolute left-0 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-800 text-white lg:hidden"><ReplyIcon className="h-5 w-5" /></span>
                                {canDelete ? <span aria-hidden="true" style={{ top: "50%", opacity: Math.min(1, Math.max(0, -swipeOffset) / 38), transform: `translateY(-50%) scale(${0.72 + Math.min(0.28, Math.max(0, -swipeOffset) / 190)})` }} className="pointer-events-none absolute right-0 flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white lg:hidden"><DeleteIcon className="h-5 w-5" /></span> : null}
                                {actionMessageId === message.id ? <MessageActionPopup key={`${message.id}:${actionView}`} anchor={actionAnchor} onDismiss={() => setActionMessageId(null)}>{actionView === "actions" ? <PrimaryMessageActions onDelete={canDelete && selected.canWrite ? () => void deleteMessage(message) : null} onEdit={canEdit ? () => startEditingMessage(message) : null} onSave={canSaveAttachment ? () => void downloadAttachment(message) : null} saveLabel={saveAttachmentLabel} saveDisabled={downloadingMessageId === message.id} onQuote={selected.canWrite ? () => startQuotingMessage(message) : null} onReply={null} onCopy={() => void copyMessage(message)} onPin={canPin ? () => void togglePinnedMessage(message) : null} onReact={selected.canWrite ? () => setActionView("reactions") : null} pinned={selected.pinnedMessageId === message.id} /> : selected.canWrite ? <MessageReactionActions currentEmoji={ownReaction?.emoji ?? null} recentEmoji={recentReaction} onReact={(emoji) => void sendReaction(message, emoji)} onRecentEmoji={rememberRecentReaction} side={own ? "right" : "left"} /> : null}</MessageActionPopup> : null}
                                {!own && selected.kind === "team" ? sender?.former
                                    ? <span title={`${sender.name} · former member`} className="mb-1 mr-2 inline-flex h-7 w-7 shrink-0 overflow-hidden rounded-full opacity-70"><Avatar src={sender.avatarSrc} name={sender.name} className="h-full w-full object-center" /></span>
                                    : <button data-icon-button type="button" onClick={() => openWorkspaceMemberProfile(message.senderUserId)} aria-label={`Open ${sender?.name ?? "team member"} profile`} className="mb-1 mr-2 inline-flex h-7 w-7 shrink-0 aspect-square items-center justify-center overflow-hidden rounded-full p-0 outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"><Avatar src={sender?.avatarSrc} name={sender?.name ?? "Team member"} className="h-full w-full object-center" /></button> : null}
                                <NativeMessageBubble
                                    selectingText={Boolean(selectingQuote)}
                                    video={message.attachment?.kind === "video"}
                                        image={message.attachment?.kind === "image"}
                                    role="button"
                                    tabIndex={0}
                                    onOpenActions={(anchor) => { setActionAnchor(anchor); if (selectingQuote) return; setActionView("actions"); setActionMessageId(message.id) }}
                                    onTouchStart={(event) => {
                                        const touch = event.touches[0]
                                        swipeStartRef.current = touch ? beginMessageSwipe(message.id, touch) : null
                                        if (touch) setSwipePosition({ id: message.id, offset: 0, active: true })
                                    }}
                                    onTouchMove={(event) => {
                                        const start = swipeStartRef.current, touch = event.touches[0]
                                        if (!start || start.id !== message.id || !touch || start.axis === "vertical") return
                                        const next = moveMessageSwipe(start, touch, selected.canWrite, canDelete && selected.canWrite)
                                        swipeStartRef.current = next
                                        if (next.offset !== start.offset || next.axis !== start.axis) setSwipePosition({ id: message.id, offset: next.offset, active: next.axis === "horizontal" })
                                    }}
                                    onTouchEnd={(event) => {
                                        const action = finishMessageSwipe(swipeStartRef.current, event.changedTouches[0], selected.canWrite, canDelete && selected.canWrite)
                                        swipeStartRef.current = null
                                        setSwipePosition({ id: message.id, offset: 0, active: false })
                                        window.setTimeout(() => setSwipePosition((current) => current?.id === message.id && !current.active ? null : current), 220)
                                        if (action === "reply") startQuotingMessage(message)
                                        else if (action === "delete") void deleteMessage(message)
                                    }}
                                    onTouchCancel={() => {
                                        swipeStartRef.current = null
                                        setSwipePosition({ id: message.id, offset: 0, active: false })
                                        window.setTimeout(() => setSwipePosition((current) => current?.id === message.id && !current.active ? null : current), 220)
                                    }}
                                    style={{ touchAction: selectingQuote?.id === message.id ? "auto" : undefined, transform: `translate3d(${swipeOffset}px,0,0)`, transition: swipePosition?.id === message.id && swipePosition.active ? "none" : "transform 220ms cubic-bezier(.22,1,.36,1)", willChange: swipePosition?.id === message.id ? "transform" : undefined }}
                                    className={`${isSticker ? "relative max-w-52 bg-transparent p-0 pb-1 shadow-none" : `max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[72%] ${own ? "rounded-br-md bg-neutral-100 text-neutral-950" : "rounded-bl-md border border-neutral-800 bg-neutral-900 text-neutral-100"}`} min-w-0 touch-pan-y cursor-pointer outline-none`}
                                >
                                    {selected.kind === "team" ? sender?.former
                                        ? <span className={`${isSticker ? "mb-1 w-fit rounded-full bg-neutral-950/80 px-2 py-0.5" : "mb-0.5"} block text-[10px] font-semibold leading-none text-neutral-500`}>{sender.name} · former member</span>
                                        : <button data-icon-button type="button" onClick={(event) => { event.stopPropagation(); openWorkspaceMemberProfile(message.senderUserId) }} className={`${isSticker ? "mb-1 w-fit rounded-full bg-neutral-950/80 px-2 py-0.5" : "mb-0.5"} block text-[10px] font-semibold leading-none text-neutral-500 hover:underline`}>{own ? "You" : sender?.name ?? "Team member"}</button> : null}
                                    {message.replyToMessageId || message.quote ? <button type="button" disabled={!message.replyToMessageId} aria-label={message.quote ? "Jump to quoted text" : "Jump to replied message"} onPointerDown={(event) => { if (event.button === 0) event.preventDefault() }} onClick={(event) => { event.stopPropagation(); if (message.replyToMessageId) void jumpToMessage(message.replyToMessageId, message.quote) }} className={`block w-full text-left focus-visible:outline focus-visible:outline-2 mb-2 rounded-lg border-l-2 border-neutral-500 px-2.5 py-2 ${own ? "bg-black/10" : "bg-black/35"}`}><p className="truncate text-[10px] font-semibold opacity-70">{reply ? reply.senderUserId === bootstrap.currentUser.id ? "You" : peopleById.get(reply.senderUserId)?.name ?? "Team member" : message.replyToMessageId ? "Original message" : "Message unavailable"}</p><p className="mt-0.5 truncate text-xs opacity-65">{message.quote ? `“${message.quote.text}”` : reply ? messagePreview(reply) : "View original message"}</p></button> : null}
                                    {message.attachment ? <NativeAttachment key={message.attachment.storagePath} attachment={message.attachment} onOpenImage={setPreviewMedia} light={own} /> : null}
                                    {message.body ? <ChatMessageText body={message.body} quoteSelection={selectingQuote?.id === message.id} highlight={quoteHighlight?.messageId === message.id ? resolveMessageQuote(message.body, quoteHighlight.quote) : null} onToggleCheckbox={selected.canWrite && message.id !== message.clientRequestId ? (line, checked, expectedBody) => toggleCheckbox(message, line, checked, expectedBody) : undefined} /> : null}
                                    {isSticker && messageReactions.length ? <div className={`absolute bottom-5 z-10 flex gap-0.5 ${own ? "right-0" : "left-0"}`}>{messageReactions.map((reaction) => <span key={`${reaction.messageId}:${reaction.reactorUserId}`} title={`${peopleById.get(reaction.reactorUserId)?.name ?? "Team member"} reacted`} className="rounded-full border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-sm shadow-sm">{reaction.emoji}</span>)}</div> : null}
                                    <div className={`mt-1.5 flex items-center justify-between gap-3 text-[10px] ${isSticker ? "ml-auto min-w-20 rounded-full bg-neutral-950/80 px-2 py-0.5 text-neutral-400" : own ? "text-neutral-500" : "text-neutral-600"}`}>
                                        {selected.kind === "team" ? <MessageReadAvatars readers={readers} /> : <span />}
                                        <span className="flex shrink-0 items-center gap-1.5">{message.editedAt ? <span>Edited</span> : null}<time>{messageTime(message.createdAt)}</time>{own ? <NativeDeliveryTicks message={message} read={readers.length > 0} /> : null}</span>
                                    </div>
                                </NativeMessageBubble>
                            </div>
                            {!isSticker && messageReactions.length ? <div inert={quoteSelectionMuted} className={`flex gap-1 px-1 transition-opacity duration-150 ${quoteSelectionMuted ? "pointer-events-none select-none opacity-30" : ""} ${own ? "justify-end" : "justify-start"}`}>{messageReactions.map((reaction) => <span key={`${reaction.messageId}:${reaction.reactorUserId}`} title={`${peopleById.get(reaction.reactorUserId)?.name ?? "Team member"} reacted`} className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-sm">{reaction.emoji}</span>)}</div> : null}
                        </Fragment>
                    }) : selectedTypingPeople.length ? null : <div className="flex min-h-64 items-center justify-center text-center"><div><p className="text-sm font-medium text-neutral-300">Start the conversation</p><p className="mt-2 text-xs text-neutral-600">Native Betelgeze messages update instantly.</p></div></div>}
                    {selectedTypingPeople.length ? <NativeTypingDots label={selectedTypingLabel} /> : null}</div></div>{showJumpToLatest ? <JumpToLatestButton onClick={() => { followLatestRef.current = true; setAtLatest(true); messagePaneRef.current?.scrollTo({ top: messagePaneRef.current.scrollHeight, left: 0, behavior: "instant" }) }} /> : null}</div>
                    <ComposerFooter className="relative z-10 shrink-0 touch-manipulation border-t border-neutral-800 bg-neutral-950 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:p-4">
                        {selectingQuote ? <MessageQuoteSelection key={`${selected.id}:${selectingQuote.id}:${selectingQuote.body}`} messageId={selectingQuote.id} body={selectingQuote.body} paneRef={messagePaneRef} onChange={updateSelectedQuote} onCancel={cancelQuoteSelection} /> : null}
                        {editingMessage ? <ComposerMessagePreview label="Editing message" preview={editingMessage.body} /> : null}
                        {replyingTo ? <ComposerMessagePreview label={selected.kind === "team" ? `Replying to ${replyingTo.senderUserId === bootstrap.currentUser.id ? "yourself" : peopleById.get(replyingTo.senderUserId)?.name ?? "team member"}` : "Replying to message"} tooltip={selectingQuote ? "Reply to the whole message, or highlight text in it to quote a passage." : undefined} preview={replyingTo.selectedQuote ? `“${replyingTo.selectedQuote.text}”` : messagePreview(replyingTo)} onCancel={() => { setReplyingTo(null); composerRef.current?.focus({ preventScroll: true }) }} /> : null}
                        {attachment || attachmentState === "uploading" ? <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-xl border border-neutral-800 bg-black px-3 py-2 text-xs"><span className="min-w-0 flex-1 truncate">{attachmentState === "uploading" ? "Uploading attachment…" : attachment?.fileName}</span>{attachment ? <button type="button" onClick={() => setAttachment(null)} className="h-8 w-8 text-neutral-500">×</button> : null}</div> : null}
                        {stickerTrayOpen ? <div className="mx-auto mb-2 max-w-3xl rounded-2xl border border-neutral-800 bg-black p-3 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-neutral-200">Stickers</p><p className="mt-0.5 text-[10px] text-neutral-600">Shared across client and team chats.</p></div><button type="button" onClick={() => setStickerTrayOpen(false)} aria-label="Close sticker tray" className="h-8 w-8 text-neutral-500 hover:text-white">×</button></div><div data-composer-scroll className="mt-3 grid max-h-52 grid-cols-4 gap-2 overflow-y-auto overscroll-y-none sm:grid-cols-7">{stickers.map((sticker) => <button key={sticker.id} type="button" onClick={() => void sendSticker(sticker)} disabled={!selected.canWrite} title={sticker.fileName} className="flex aspect-square items-center justify-center rounded-xl bg-neutral-950 p-1.5 hover:bg-neutral-900 disabled:opacity-40"><Image unoptimized src={sticker.url} alt={sticker.fileName} width={512} height={512} className="h-full w-full object-contain" /></button>)}<button type="button" onClick={() => stickerInputRef.current?.click()} disabled={stickerUploadState === "uploading"} className="flex aspect-square flex-col items-center justify-center rounded-xl border border-dashed border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-white disabled:opacity-40"><span className="text-2xl">+</span><span className="mt-1 text-[9px]">{stickerUploadState === "uploading" ? "Converting…" : "Add sticker"}</span></button></div></div> : null}
                        {error ? <div className="mx-auto mb-2 flex max-w-3xl justify-between rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-300"><span>{error}</span><button type="button" onClick={() => setError(null)}>×</button></div> : null}
                        <input ref={attachmentInputRef} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAttachment(file) }} />
                        <input ref={stickerInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadSticker(file) }} />
                        <ChatOutboxStatus entries={offline.entries} conversationId={selected.id} />
                        <MessageComposer
                            textareaRef={composerRef}
                            draft={draft}
                            placeholder={selected.system ? "Private updates from BE" : selected.canWrite ? `Message ${selected.title}` : "Archived conversation"}
                            disabled={!selected.canWrite}
                            sendDisabled={!selected.canWrite || (editingMessage ? !draft.trim() || draft.trim() === editingMessage.body.trim() || editState === "saving" : (!draft.trim() && !attachment) || attachmentState === "uploading")}
                            onDraftChange={handleDraftChange}
                            onBlur={() => stopNativeTyping(selected.id)}
                            onSend={() => editingMessage ? void saveEditedMessage() : void sendMessage()}
                            submitLabel={editingMessage ? "Save edit" : "Send message"}
                            submitIcon={editingMessage ? <CheckIcon className="h-5 w-5" /> : undefined}
                            leadingActions={editingMessage ? <button data-icon-button type="button" onPointerDown={(event) => event.preventDefault()} onClick={cancelEditingMessage} aria-label="Cancel editing" className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-neutral-500 hover:text-white lg:h-9 lg:w-9"><CancelIcon className="h-5 w-5" /></button> : <>
                                <button data-icon-button type="button" onClick={() => attachmentInputRef.current?.click()} disabled={!selected.canWrite || attachmentState === "uploading"} aria-label="Attach image or file" className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-neutral-500 hover:text-white disabled:text-neutral-800 lg:h-9 lg:w-9"><AttachmentIcon /></button>
                                <button data-icon-button type="button" onClick={() => { setStickerTrayOpen((current) => !current); setError(null) }} disabled={!selected.canWrite} aria-label="Open sticker tray" className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-neutral-500 hover:text-white disabled:text-neutral-800 lg:h-9 lg:w-9"><StickerIcon /></button>
                            </>}
                        />
                    </ComposerFooter>
                    </ChatMotionViewport>
                </> : <div className="flex flex-1 items-center justify-center p-6 text-center"><div><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950"><TeamIcon /></div><h2 className="mt-4 text-sm font-semibold">Select a team conversation</h2><p className="mt-2 text-xs text-neutral-600">Direct messages and team chats update without reloading.</p></div></div>}
            </NativeChatViewport></ConversationMedia>
        </ResizableConversationColumns>
        {editingTeam !== undefined ? <TeamEditor bootstrap={{ ...bootstrap, teams }} team={editingTeam} onClose={() => setEditingTeam(undefined)} onSaved={async () => { await refresh(selectedRef.current) }} /> : null}
        <MessageMediaLightbox media={previewMedia} onClose={() => setPreviewMedia(null)} />
    </section>
}
