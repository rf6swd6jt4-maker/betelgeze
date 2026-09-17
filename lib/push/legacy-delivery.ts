// Rolling deployment only: used exclusively when the new claim RPC is absent.
// Existing notification gates must keep working before the migration is applied.
import "server-only"

import { createHash } from "node:crypto"
import webPush, { WebPushError, type PushSubscription } from "web-push"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { declarativeChatPushPayload } from "@/lib/push/declarative-notification"

const ACTIVE_WINDOW_MS = 60_000
const PUSH_TTL_SECONDS = 24 * 60 * 60

type StoredSubscription = {
    id: string
    user_id: string
    endpoint: string
    p256dh: string
    auth: string
}

type ChatPush = {
    mentionUserIds?: string[]
    mentionBody?: string
    workspaceId: string
    conversationKind: "client" | "native"
    messageId: string
    messageCreatedAt: string
    conversationId: string
    title: string
    body: string
    url: string
}

type ReadCursor = {
    user_id: string
    last_read_at: string
}

function vapidDetails() {
    const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim()
    const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim()
    const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim() || "mailto:support@betelgeze.com"
    return publicKey && privateKey ? { subject, publicKey, privateKey } : null
}

function missingActivityContext(error: { code?: string; message?: string } | null) {
    const message = error?.message?.toLowerCase() ?? ""
    return error?.code === "42703" || error?.code === "42P01" || error?.code === "PGRST204"
        || message.includes("conversation_kind") || message.includes("conversation_id") || message.includes("connection_live") || message.includes("workspace_id")
}

function chatNotificationBody(preview: string, unreadCount: number) {
    return unreadCount > 1 ? `${unreadCount} new messages · ${preview}` : preview
}

async function claimChatPush(subscriptionId: string, push: ChatPush) {
    const { data, error } = await supabaseAdmin.rpc("claim_chat_push_notification", {
        p_subscription_id: subscriptionId,
        p_workspace_id: push.workspaceId,
        p_conversation_kind: push.conversationKind,
        p_conversation_id: push.conversationId,
        p_message_id: push.messageId,
        p_message_created_at: push.messageCreatedAt,
    })
    if (error) {
        console.error("Could not claim chat push notification", error)
        return false
    }
    return data === true
}

async function unreadCounts(recipientUserIds: string[], push: ChatPush) {
    const counts = new Map<string, number>()
    if (recipientUserIds.length === 0) return counts

    const cursorQuery = push.conversationKind === "client"
        ? supabaseAdmin.from("communication_read_cursors").select("user_id, last_read_at").eq("workspace_id", push.workspaceId).eq("relationship_id", push.conversationId).in("user_id", recipientUserIds)
        : supabaseAdmin.from("workspace_native_read_cursors").select("user_id, last_read_at").eq("workspace_id", push.workspaceId).eq("conversation_id", push.conversationId).in("user_id", recipientUserIds)
    const { data: cursorRows, error: cursorError } = await cursorQuery
    if (cursorError) {
        console.warn("Could not resolve chat notification read cursors", cursorError)
        recipientUserIds.forEach((userId) => counts.set(userId, 1))
        return counts
    }

    const cursors = new Map(((cursorRows ?? []) as ReadCursor[]).map((cursor) => [cursor.user_id, cursor.last_read_at]))
    await Promise.all(recipientUserIds.map(async (userId) => {
        const lastReadAt = cursors.get(userId)
        let query = push.conversationKind === "client"
            ? supabaseAdmin.from("client_messages").select("id", { count: "exact", head: true }).eq("workspace_id", push.workspaceId).eq("relationship_id", push.conversationId).eq("direction", "inbound")
            : supabaseAdmin.from("workspace_native_messages").select("id", { count: "exact", head: true }).eq("workspace_id", push.workspaceId).eq("conversation_id", push.conversationId).neq("sender_user_id", userId)
        if (lastReadAt) query = query.gt("created_at", lastReadAt)
        const { count, error } = await query
        if (error) {
            console.warn("Could not count unread chat messages", error)
            counts.set(userId, 1)
            return
        }
        counts.set(userId, count ?? 1)
    }))
    return counts
}

export async function deliverLegacyChatPush(recipientUserIds: string[], push: ChatPush) {
    const recipients = [...new Set(recipientUserIds.filter(Boolean))]
    if (recipients.length === 0) return

    const details = vapidDetails()
    if (!details) {
        console.warn("Chat push skipped because VAPID credentials are not configured")
        return
    }

    const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString()
    const [{ data: activeRows, error: activeError }, { data: subscriptionRows, error: subscriptionError }] = await Promise.all([
        supabaseAdmin.from("communications_active_sessions").select("user_id").in("user_id", recipients).eq("workspace_id", push.workspaceId).eq("conversation_kind", push.conversationKind).eq("conversation_id", push.conversationId).eq("connection_live", true).gte("last_seen_at", activeSince),
        supabaseAdmin.from("web_push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", recipients),
    ])
    if (subscriptionError || (activeError && !missingActivityContext(activeError))) {
        console.error("Could not resolve chat push recipients", activeError ?? subscriptionError)
        return
    }
    if (activeError) console.warn("Chat push activity context is not migrated; delivering without active-chat suppression")

    const activeUsers = new Set((activeError ? [] : activeRows ?? []).map((row) => row.user_id))
    const subscriptions = (subscriptionRows ?? []) as StoredSubscription[]
    const inactiveUsers = [...new Set(subscriptions.map((subscription) => subscription.user_id).filter((userId) => !activeUsers.has(userId)))]
    const counts = await unreadCounts(inactiveUsers, push)
    const topic = createHash("sha256").update(push.conversationId).digest("base64url").slice(0, 32)

    await Promise.all(subscriptions.filter((subscription) => !activeUsers.has(subscription.user_id) && (counts.get(subscription.user_id) ?? 1) > 0).map(async (subscription) => {
        const unreadCount = counts.get(subscription.user_id) ?? 1
        if (!await claimChatPush(subscription.id, push)) return
        const body = chatNotificationBody(push.mentionUserIds?.includes(subscription.user_id) ? push.mentionBody ?? push.body : push.body, unreadCount)
        const tag = `chat:${push.conversationId}`
        // `web-push` encrypts this payload separately for the subscription's
        // p256dh/auth keys. The Push service receives ciphertext and only the
        // recipient browser can expose the preview to this app's service worker.
        // The declarative notification is also a user-visible fallback when
        // WebKit cannot run the worker. Top-level fields keep already-installed
        // older workers compatible until their next update check.
        const payload = declarativeChatPushPayload({
            title: push.title,
            body,
            url: push.url,
            tag,
            conversationId: push.conversationId,
            messageId: push.messageId,
            messageCreatedAt: push.messageCreatedAt,
            unreadCount,
        })
        const browserSubscription: PushSubscription = {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }
        try {
            await webPush.sendNotification(browserSubscription, payload, {
                vapidDetails: details,
                TTL: PUSH_TTL_SECONDS,
                urgency: "high",
                topic,
                timeout: 10_000,
            })
            await supabaseAdmin.from("web_push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0, updated_at: new Date().toISOString() }).eq("id", subscription.id)
        } catch (error) {
            if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
                await supabaseAdmin.from("web_push_subscriptions").delete().eq("id", subscription.id)
                return
            }
            console.error("Legacy chat push delivery failed", error instanceof WebPushError ? { statusCode: error.statusCode } : { reason: "provider_unavailable" })
            await Promise.all([
                supabaseAdmin.rpc("increment_web_push_failure", { subscription_id: subscription.id }).then(() => undefined),
                supabaseAdmin.from("chat_push_notification_states").delete().eq("subscription_id", subscription.id).eq("conversation_kind", push.conversationKind).eq("conversation_id", push.conversationId).eq("message_id", push.messageId),
            ])
        }
    }))
}
