import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { PGlite, repositoryRoot } from "./pglite-fixture.mjs"

const db = new PGlite()
const id = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`
const workspaceId = id(1)
const userId = id(2)
const subscriptionId = id(3)
const clientConversationId = id(4)
const nativeConversationId = id(5)
const firstMessageId = id(10)
const secondMessageId = id(11)
const thirdMessageId = id(12)
const firstAt = "2026-09-16T10:00:00.000Z"
const secondAt = "2026-09-16T10:01:00.000Z"
const thirdAt = "2026-09-16T10:02:00.000Z"

async function claim(kind, conversationId, messageId, createdAt) {
    const result = await db.query(
        "select public.claim_chat_push_notification($1, $2, $3, $4, $5, $6) as claimed",
        [subscriptionId, workspaceId, kind, conversationId, messageId, createdAt],
    )
    return result.rows[0].claimed
}

try {
    await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create schema auth;
        create table auth.users (id uuid primary key);
        create table public.workspaces (id uuid primary key);
        create table public.web_push_subscriptions (
            id uuid primary key,
            user_id uuid not null references auth.users(id) on delete cascade
        );
        create table public.communication_read_cursors (
            workspace_id uuid not null,
            relationship_id uuid not null,
            user_id uuid not null,
            last_read_at timestamptz not null,
            primary key (workspace_id, relationship_id, user_id)
        );
        create table public.workspace_native_read_cursors (
            workspace_id uuid not null,
            conversation_id uuid not null,
            user_id uuid not null,
            last_read_at timestamptz not null,
            primary key (workspace_id, conversation_id, user_id)
        );
    `)
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260817190000_ios_chat_notification_gate.sql`, "utf8"))
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260916220000_chat_push_notification_replacements.sql`, "utf8"))
    await db.query("insert into auth.users (id) values ($1)", [userId])
    await db.query("insert into public.workspaces (id) values ($1)", [workspaceId])
    await db.query("insert into public.web_push_subscriptions (id, user_id) values ($1, $2)", [subscriptionId, userId])

    assert.equal(await claim("client", clientConversationId, firstMessageId, firstAt), true)
    assert.equal(await claim("client", clientConversationId, firstMessageId, firstAt), false)
    assert.equal(await claim("client", clientConversationId, secondMessageId, secondAt), true)
    assert.equal(await claim("client", clientConversationId, firstMessageId, firstAt), false)
    let state = (await db.query("select message_id, message_created_at from public.chat_push_notification_states where subscription_id = $1 and conversation_id = $2", [subscriptionId, clientConversationId])).rows[0]
    assert.equal(state.message_id, secondMessageId)
    assert.equal(new Date(state.message_created_at).toISOString(), secondAt)

    await db.query("insert into public.communication_read_cursors values ($1, $2, $3, $4)", [workspaceId, clientConversationId, userId, secondAt])
    assert.equal(await claim("client", clientConversationId, secondMessageId, secondAt), false)
    assert.equal(await claim("client", clientConversationId, thirdMessageId, thirdAt), true)
    await db.query("select public.clear_read_chat_push_notifications($1, $2, $3, $4)", [userId, "client", clientConversationId, thirdAt])
    state = (await db.query("select message_id from public.chat_push_notification_states where subscription_id = $1 and conversation_id = $2", [subscriptionId, clientConversationId])).rows[0]
    assert.equal(state, undefined)

    assert.equal(await claim("native", nativeConversationId, firstMessageId, firstAt), true)
    assert.equal(await claim("native", nativeConversationId, secondMessageId, secondAt), true)
    assert.equal(await claim("native", nativeConversationId, firstMessageId, firstAt), false)

    console.log("PASS: newer unread chat messages replace the gate; duplicates, older messages and read messages stay blocked")
} finally {
    await db.close()
}
