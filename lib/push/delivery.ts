import "server-only"
import { createHash } from "node:crypto"
import webPush, { WebPushError } from "web-push"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { declarativeChatPushPayload } from "@/lib/push/declarative-notification"
import { chatPushSchemaMissing } from "@/lib/push/recipients"

class PushMigrationMissing extends Error {}

export type ChatPush = {
    workspaceId: string
    conversationKind: "client" | "native"
    conversationId: string
    messageId: string
    messageCreatedAt: string
    title: string
    body: string
    url: string
    mentionUserIds?: string[]
    mentionBody?: string
}
type Delivery = {
    id: string; workspace_id: string; conversation_kind: "native" | "client"; conversation_id: string
    message_id: string; message_created_at: string; user_id: string; subscription_id: string | null
    lease_token: string; receipt_token: string
}

function vapidDetails() {
    const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim()
    const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim()
    const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim() || "mailto:support@betelgeze.com"
    return publicKey && privateKey ? { publicKey, privateKey, subject } : null
}

// Recovery stores message identity only. Plaintext chat content is never copied
// into an outbox. The normal callback supplies its already-authorized preview;
// interrupted callbacks recover with a neutral preview instead of losing push.
async function recoveryPush(job: Delivery): Promise<ChatPush> {
    const workspace = await supabaseAdmin.from("workspaces").select("slug").eq("id", job.workspace_id).single()
    if (workspace.error) throw new Error("workspace_unavailable")
    let title = "New chat message"
    if (job.conversation_kind === "native") {
        const conversation = await supabaseAdmin.from("workspace_native_conversations").select("kind,team_id").eq("workspace_id", job.workspace_id).eq("id", job.conversation_id).single()
        if (conversation.error) throw new Error("conversation_unavailable")
        if (conversation.data.kind === "team") {
            const team = await supabaseAdmin.from("workspace_teams").select("name").eq("workspace_id", job.workspace_id).eq("id", conversation.data.team_id).single()
            if (team.error) throw new Error("team_unavailable")
            title = team.data.name
        } else {
            const message = await supabaseAdmin.from("workspace_native_messages").select("sender_user_id").eq("workspace_id", job.workspace_id).eq("id", job.message_id).single()
            if (message.error) throw new Error("message_unavailable")
            const profile = await supabaseAdmin.from("user_profiles").select("display_name,username").eq("user_id", message.data.sender_user_id).maybeSingle()
            if (profile.error) throw new Error("sender_unavailable")
            title = profile.data?.display_name?.trim() || profile.data?.username || title
        }
    } else {
        const relationship = await supabaseAdmin.from("relationships").select("primary_person_name,business_name").eq("workspace_id", job.workspace_id).eq("id", job.conversation_id).single()
        if (relationship.error) throw new Error("conversation_unavailable")
        title = [relationship.data.primary_person_name, relationship.data.business_name].filter(Boolean).join(" – ") || title
    }
    return {
        workspaceId: job.workspace_id, conversationKind: job.conversation_kind, conversationId: job.conversation_id,
        messageId: job.message_id, messageCreatedAt: job.message_created_at, title: title.slice(0, 80), body: "New message",
        url: `/${encodeURIComponent(workspace.data.slug)}/communications?${job.conversation_kind === "native" ? "mode=team&nativeConversation" : "conversation"}=${encodeURIComponent(job.conversation_id)}`,
    }
}

async function finish(job: Delivery, outcome: "accepted" | "retry" | "revoked", reason: string | null = null) {
    const result = await supabaseAdmin.rpc("finish_chat_push_delivery", { p_id: job.id, p_lease: job.lease_token, p_outcome: outcome, p_error: reason })
    if (result.error) throw new Error("push_outcome_not_persisted")
}

export async function processChatPushDeliveries(input: { messageId?: string; userId?: string; limit?: number; push?: ChatPush } = {}) {
    const result = await supabaseAdmin.rpc("claim_chat_push_deliveries", { p_message: input.messageId ?? null, p_user: input.userId ?? null, p_limit: input.limit ?? 50 })
    if (chatPushSchemaMissing(result.error)) throw new PushMigrationMissing("push_migration_missing")
    if (result.error) throw new Error("push_jobs_unavailable")
    const jobs = (result.data ?? []) as Delivery[]
    const previews = new Map<string, Promise<ChatPush>>()
    const details = vapidDetails()
    let accepted = 0
    let deferred = 0
    let failed = 0
    // Bound provider concurrency. A failing device does not stop other devices.
    for (let offset = 0; offset < jobs.length; offset += 8) await Promise.all(jobs.slice(offset, offset + 8).map(async (job) => {
        try {
            const prepared = await supabaseAdmin.rpc("prepare_chat_push_delivery", { p_id: job.id, p_lease: job.lease_token })
            if (prepared.error) throw new Error("push_eligibility_unavailable")
            if (prepared.data?.state !== "send") { if (prepared.data?.state === "deferred") deferred++; return }
            if (!details) throw new Error("push_not_configured")
            const subscription = await supabaseAdmin.from("web_push_subscriptions").select("endpoint,p256dh,auth").eq("id", job.subscription_id!).eq("user_id", job.user_id).maybeSingle()
            if (subscription.error) throw new Error("push_subscription_unavailable")
            if (!subscription.data) { await finish(job, "revoked", "subscription_removed"); return }
            if (!previews.has(job.message_id)) previews.set(job.message_id, input.push?.messageId === job.message_id ? Promise.resolve(input.push) : recoveryPush(job))
            const push = await previews.get(job.message_id)!
            // Authorization is checked again after metadata reads, immediately
            // before handing an encrypted payload to the external provider.
            const check = await supabaseAdmin.rpc("prepare_chat_push_delivery", { p_id: job.id, p_lease: job.lease_token })
            if (check.error) throw new Error("push_eligibility_unavailable")
            if (check.data?.state !== "send") { if (check.data?.state === "deferred") deferred++; return }
            const unreadCount = check.data.unreadCount as number
            const preview = push.mentionUserIds?.includes(job.user_id) ? push.mentionBody ?? push.body : push.body
            const payload = declarativeChatPushPayload({
                ...push, tag: `chat:${push.conversationId}`, unreadCount,
                body: unreadCount > 1 ? `${unreadCount >= 100 ? "100+" : unreadCount} new messages · ${preview}` : preview,
                deliveryId: job.id, receiptToken: job.receipt_token,
            })
            await webPush.sendNotification({ endpoint: subscription.data.endpoint, keys: { p256dh: subscription.data.p256dh, auth: subscription.data.auth } }, payload, {
                vapidDetails: details, TTL: 24 * 60 * 60, urgency: "high", timeout: 10_000,
                topic: createHash("sha256").update(`${job.conversation_kind}:${job.conversation_id}`).digest("base64url").slice(0, 32),
            })
            await finish(job, "accepted")
            accepted++
            await supabaseAdmin.from("web_push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0, updated_at: new Date().toISOString() }).eq("id", job.subscription_id!).eq("user_id", job.user_id)
        } catch (error) {
            failed++
            const status = error instanceof WebPushError ? error.statusCode : null
            // Never log WebPushError itself: it contains capability endpoints.
            const reason = status ? `provider_http_${status}` : error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "push_attempt_failed"
            if (status === 404 || status === 410) {
                await finish(job, "revoked", reason)
                if (job.subscription_id) await supabaseAdmin.from("web_push_subscriptions").delete().eq("id", job.subscription_id).eq("user_id", job.user_id)
            } else {
                await finish(job, "retry", reason)
                if (job.subscription_id) await supabaseAdmin.rpc("increment_web_push_failure", { subscription_id: job.subscription_id })
            }
            console.warn("Chat push attempt requires recovery", { reason })
        }
    }))
    return { processed: jobs.length, accepted, deferred, failed }
}

export async function deliverChatPush(recipientUserIds: string[], push: ChatPush) {
    // Recipients are captured atomically with the message and revalidated by SQL.
    try { return await processChatPushDeliveries({ messageId: push.messageId, push }) }
    catch (error) {
        if (!(error instanceof PushMigrationMissing)) throw error
        const { deliverLegacyChatPush } = await import("@/lib/push/legacy-delivery")
        await deliverLegacyChatPush(recipientUserIds, push)
    }
}
