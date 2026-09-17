import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { declarativeChatPushPayload } from "../lib/push/declarative-notification.ts"

test("chat push payload is declarative and remains compatible with older workers", () => {
    const payload = JSON.parse(declarativeChatPushPayload({
        title: "Client chat",
        body: "2 new messages · Hello",
        url: "/acme/communications?conversation=one",
        tag: "chat:one",
        conversationId: "one",
        messageId: "message-one",
        messageCreatedAt: "2026-09-16T22:20:51.916Z",
        unreadCount: 2,
    }))
    assert.equal(payload.web_push, 8030)
    assert.equal(payload.notification.title, "Client chat")
    assert.equal(payload.notification.navigate, "https://app.betelgeze.com/acme/communications?conversation=one")
    assert.equal(payload.notification.silent, false)
    assert.equal(payload.notification.renotify, true)
    assert.equal(payload.notification.data.conversationId, "one")
    assert.equal(payload.title, payload.notification.title)
    assert.equal(payload.body, payload.notification.body)
    assert.equal(payload.url, payload.notification.data.url)
    assert.equal(payload.mutable, true)
})

test("chat push subscriptions and Communications sessions use server-only durable storage", async () => {
    const migration = await readFile("supabase/migrations/20260816170000_chat_web_push.sql", "utf8")
    assert.match(migration, /create table if not exists public\.web_push_subscriptions/)
    assert.match(migration, /create table if not exists public\.communications_active_sessions/)
    assert.match(migration, /alter table public\.web_push_subscriptions enable row level security/)
    assert.match(migration, /revoke all on public\.web_push_subscriptions from anon, authenticated/)
    assert.match(migration, /references auth\.users\(id\) on delete cascade/)
})

test("security device toggle registers from the user gesture and recovers after returning from device settings", async () => {
    const [settings, profile, subscriptionRoute, toggle] = await Promise.all([
        readFile("components/account/PushNotificationSettings.tsx", "utf8"),
        readFile("components/account/AccountDevices.tsx", "utf8"),
        readFile("app/api/push/subscriptions/route.ts", "utf8"),
        readFile("components/ui/NotificationSwitch.tsx", "utf8"),
    ])
    assert.match(profile, /<PushNotificationSettings/)
    assert.match(settings, /userVisibleOnly: true/)
    assert.match(settings, /pushManager\.subscribe/)
    assert.match(settings, /window\.addEventListener\("focus", refresh\)/)
    assert.match(settings, /document\.addEventListener\("visibilitychange", refresh\)/)
    assert.doesNotMatch(settings, /if \(permission !== "granted"\)/)
    assert.ok(settings.indexOf('Notification.permission === "denied"') < settings.indexOf('Notification.permission === "granted" && result.subscribed && matches'))
    assert.match(toggle, /h-11 w-14/)
    assert.match(toggle, /relative block h-7 w-12/)
    assert.match(settings, /Add Betelgeze to your Home Screen/)
    assert.match(settings, /Notification previews show the chat name and message/)
    assert.match(toggle, /role="switch"/)
    assert.match(subscriptionRoute, /getCurrentUser\(\)/)
    assert.match(subscriptionRoute, /WEB_PUSH|webPushPublicKey/)
    assert.match(subscriptionRoute, /httpOnly: true/)
})

test("native, WhatsApp, and Twilio message writes schedule chat pushes after their responses", async () => {
    const [nativeRoute, whatsappRoute, twilioRoute, worker] = await Promise.all([
        readFile("app/api/workspaces/[workspaceSlug]/communications/native/messages/route.ts", "utf8"),
        readFile("app/api/client-messages/meta/whatsapp/route.ts", "utf8"),
        readFile("app/api/client-messages/twilio/route.ts", "utf8"),
        readFile("public/sw.js", "utf8"),
    ])
    assert.match(nativeRoute, /after\(\(\) => notifyNativeChatMessage/)
    assert.match(whatsappRoute, /after\(\(\) => notifyClientChatMessage/)
    assert.match(twilioRoute, /after\(\(\) => notifyClientChatMessage/)
    assert.match(nativeRoute, /previewBody: body/)
    assert.match(whatsappRoute, /notify\(content\.body, content\.media\)/)
    assert.match(twilioRoute, /previewBody: body/)
    assert.match(worker, /self\.addEventListener\("push"/)
    assert.match(worker, /payload\.notification/)
    assert.match(worker, /proposedData\.url/)
    assert.match(worker, /conversationId/)
    assert.match(worker, /new URL\(targetPath, self\.location\.origin\)\.href/)
    assert.match(worker, /await existingClient\.navigate\(targetUrl\)/)
    assert.match(worker, /navigatedClient \? navigatedClient\.focus\(\)/)
})

test("chat notifications have a declarative fallback, renotify replacements, and clear only after reads persist", async () => {
    const [delivery, worker, clientWorkspace, teamWorkspace, browserNotifications, initialNotificationGate, replacementNotificationGate] = await Promise.all([
        Promise.all([readFile("lib/push/delivery.ts", "utf8"), readFile("lib/push/chat-notifications.ts", "utf8"), readFile("supabase/migrations/20260917090000_chat_push_delivery_recovery.sql", "utf8")]).then(parts => parts.join("\n")),
        readFile("public/sw.js", "utf8"),
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/TeamCommunicationsWorkspace.tsx", "utf8"),
        readFile("lib/push/browser-notifications.ts", "utf8"),
        readFile("supabase/migrations/20260817190000_ios_chat_notification_gate.sql", "utf8"),
        readFile("supabase/migrations/20260916220000_chat_push_notification_replacements.sql", "utf8"),
    ])
    assert.match(delivery, /push\.mentionUserIds\?\.includes\(job\.user_id\)/)
    assert.match(delivery, /communication_read_cursors/)
    assert.match(delivery, /workspace_native_read_cursors/)
    assert.match(delivery, /new messages/)
    assert.match(delivery, /messageCreatedAt/)
    assert.match(delivery, /claim_chat_push_deliveries/)
    assert.match(delivery, /clear_read_chat_push_notifications/)
    assert.match(delivery, /declarativeChatPushPayload/)
    assert.doesNotMatch(worker, /getNotifications/)
    assert.match(worker, /event\.waitUntil\(self\.registration\.showNotification\(title, options\)\.then/)
    assert.match(worker, /unreadCount/)
    assert.match(clientWorkspace, /useConversationRead/)
    assert.match(teamWorkspace, /useConversationRead/)
    assert.match(browserNotifications, /getNotifications\(\)/)
    assert.match(browserNotifications, /data\.conversationId !== conversationId/)
    assert.match(browserNotifications, /recordVersionKey\(messageCreatedAt\)/)
    assert.match(initialNotificationGate, /primary key \(subscription_id, conversation_kind, conversation_id\)/)
    assert.match(initialNotificationGate, /clear_read_chat_push_notifications/)
    assert.match(replacementNotificationGate, /on conflict \(subscription_id, conversation_kind, conversation_id\) do update/)
    assert.match(replacementNotificationGate, /excluded\.message_created_at > current_state\.message_created_at/)
    assert.match(replacementNotificationGate, /read_through >= p_message_created_at/)
    assert.match(replacementNotificationGate, /return affected_count = 1/)
    assert.doesNotMatch(replacementNotificationGate, /on conflict \(subscription_id, conversation_kind, conversation_id\) do nothing/)
})
