import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import ts from "typescript"
import * as formatting from "../lib/chat-formatting.ts"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

function load(path: string, dependencies: Record<string, unknown>) {
    const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText
    const localRequire = createRequire(resolve(path))
    const compiled = new Module(resolve(path)) as Module & { _compile: (source: string, filename: string) => void }
    compiled.require = ((name: string) => name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiled.require
    compiled._compile(source, path)
    return compiled.exports
}
const quotes = load("lib/communications/message-quotes.ts", { "@/lib/chat-formatting": formatting }) as typeof import("../lib/communications/message-quotes")
const { ChatMessageText } = load("components/communications/ChatMessageText.tsx", { "@/lib/chat-formatting": formatting, "@/lib/communications/message-quotes": quotes })

test("quote offsets refer to visible formatted text, nested lists and Unicode", () => {
    const body = "##Plan##\n- **First __item__**\n  [x] Done 😀\n\nhttps://example.com/a__b"
    const visible = "Plan\nFirst item\nDone 😀\n\nhttps://example.com/a__b"
    assert.equal(quotes.chatQuoteText(body), visible)
    const start = visible.indexOf("item")
    const end = visible.indexOf("\n\n")
    const quote = { text: visible.slice(start, end), start, end }
    assert.equal(quotes.messageQuoteMatches(body, quote), true)
    assert.deepEqual(quotes.messageQuoteFromValue(quote), quote)
    assert.equal(quotes.messageQuoteMatches(body.replace("item", "changed"), quote), false)
    assert.equal(quotes.chatQuoteText(body.replace("[x]", "[ ]")), visible)
})

test("quote validation rejects empty, forged and invalid ranges", () => {
    for (const value of [null, [], {}, { text: " ", start: 0, end: 1 }, { text: "word", start: -1, end: 3 }, { text: "word", start: 0, end: 3 }, { text: "word", start: 0.5, end: 4.5 }, { text: "word", start: 7999, end: 8003 }]) assert.equal(quotes.messageQuoteFromValue(value), null)
    assert.equal(quotes.messageQuoteMatches("original", { text: "forged", start: 0, end: 6 }), false)
})

test("navigation preserves repeated-word positions and safely handles edits", () => {
    const quote = { text: "same", start: 5, end: 9 }
    assert.deepEqual(quotes.resolveMessageQuote("same same", quote), quote)
    assert.deepEqual(quotes.resolveMessageQuote("prefix same", { text: "same", start: 0, end: 4 }), { text: "same", start: 7, end: 11 })
    assert.equal(quotes.resolveMessageQuote("prefix same same", { text: "same", start: 0, end: 4 }), null)
    assert.equal(quotes.resolveMessageQuote("removed", quote), null)
})

test("rendered highlights mark only the requested passage across nested formatting and lists", () => {
    const body = "same **same**\n- __next__ part\n  [ ] last"
    const text = quotes.chatQuoteText(body)
    const quote = { text: text.slice(5, 14), start: 5, end: 14 }
    const html = renderToStaticMarkup(React.createElement(ChatMessageText, { body, highlight: quote }))
    const marked = Array.from(html.matchAll(/<mark[^>]*>(.*?)<\/mark>/g), (match) => match[1])
    assert.deepEqual(marked, ["same", "next"])
    assert.match(html, /<strong><span><span data-chat-text-start="5"><mark/)
    assert.match(html, /data-chat-text-start="20"/)
    const unsafe = renderToStaticMarkup(React.createElement(ChatMessageText, { body: "<script>bad</script>" }))
    assert.ok(!unsafe.includes("<script>"))
})

const conversationId = "00000000-0000-4000-8000-000000000001"
const messageId = "00000000-0000-4000-8000-000000000002"
const clientRequestId = "00000000-0000-4000-8000-000000000003"
function fixture(options: { access?: boolean; original?: boolean; originalBody?: string; originalConversation?: string; existing?: boolean } = {}) {
    const writes: Record<string, unknown>[] = []
    const route = load("app/api/workspaces/[workspaceSlug]/communications/native/messages/route.ts", {
        "@/lib/teams/server": {
            nativeAttachmentFromInput: () => null,
            assertNativeConversationAccess: async () => options.access === false ? null : conversationId,
            loadNativeMessageForCurrentUser: async ({ messageId: id }: { messageId: string }) => id === messageId ? options.original === false ? null : { id, conversationId: options.originalConversation ?? conversationId, body: options.originalBody ?? "one **two** three" } : { id, conversationId, quote: writes.at(-1)?.quote ?? { text: "two", start: 4, end: 7 } },
        },
        "@/lib/supabase/admin": { supabaseAdmin: { from() {
            const filters: Record<string, unknown> = {}
            const query = {
                select() { return query }, eq(key: string, value: unknown) { filters[key] = value; return query },
                async maybeSingle() { return { data: filters.client_request_id ? options.existing ? { id: "saved" } : null : options.original === false ? null : { id: messageId }, error: null } },
                insert(value: Record<string, unknown>) { writes.push(value); return query }, async single() { return { data: { id: "saved" }, error: null } },
            }
            return query
        } } },
        "@/lib/workspace-access": { requireWorkspacePanel: async () => ({ workspace: { id: "workspace", slug: "test" }, user: { id: "user" } }) },
        "next/server": { after: () => undefined },
        "@/lib/push/chat-notifications": {}, "@/lib/onboarding/uploads": {}, "@/lib/supabase/server": {},
        "@/lib/communications/encryption": {}, "@/lib/teams/message-editing": {}, "@/lib/communications/message-quotes": quotes,
    })
    return { writes, send: (patch: Record<string, unknown> = {}) => route.POST(new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, clientRequestId, replyToMessageId: messageId, body: "reply", quote: { text: "two", start: 4, end: 7 }, ...patch }) }), { params: Promise.resolve({ workspaceSlug: "test" }) }) as Promise<Response> }
}

test("native sends persist a verified quote alongside its reply and reuse request acknowledgements", async () => {
    const state = fixture()
    assert.equal((await state.send()).status, 200)
    assert.deepEqual(state.writes[0].quote, { text: "two", start: 4, end: 7 })
    assert.equal(state.writes[0].reply_to_message_id, messageId)
    const retry = fixture({ existing: true, original: false })
    assert.equal((await retry.send()).status, 200)
    assert.equal(retry.writes.length, 0)
})

test("quote sends reject read-only access, missing originals, wrong conversations and edited text", async () => {
    for (const [options, status] of [[{ access: false }, 403], [{ original: false }, 404], [{ originalConversation: "other" }, 404], [{ originalBody: "changed" }, 409]] as const) {
        const state = fixture(options)
        assert.equal((await state.send()).status, status)
        assert.equal(state.writes.length, 0)
    }
    for (const patch of [{ replyToMessageId: null }, { quote: {} }, { quote: { text: "forged", start: 0, end: 6 } }]) {
        const state = fixture()
        assert.ok((await state.send(patch)).status >= 400)
        assert.equal(state.writes.length, 0)
    }
    const reply = fixture()
    assert.equal((await reply.send({ quote: null })).status, 200)
})

test("quotes remain encrypted and native-only across persistence and shared actions", () => {
    const sql = readFileSync("supabase/migrations/20260908183000_native_message_quotes.sql", "utf8")
    assert.match(sql, /new\.quote := null/)
    assert.match(sql, /new\.quote_ciphertext := extensions\.pgp_sym_encrypt/)
    assert.match(sql, /original\.conversation_id = new\.conversation_id/)
    assert.equal((sql.match(/decrypted\.decrypted_secret as secret/g) ?? []).length, 2)
    assert.equal((sql.match(/public\.current_session_is_aal2\(\)/g) ?? []).length, 2)
    assert.equal((sql.match(/message\.created_at > visibility\.cleared_at/g) ?? []).length, 2)
    assert.doesNotMatch(sql, /alter table public\.client_messages/)
    const clients = readFileSync("components/communications/CommunicationsWorkspace.tsx", "utf8")
    assert.doesNotMatch(clients, /onQuote=|MessageQuoteSelection/)
})

test("live quoting preserves the selected passage while composing and resets only in the source", () => {
    const listeners = new Map<string, (event?: unknown) => void>()
    const sourceNode = {}, composerNode = {}
    const selection = { anchorNode: composerNode as object | null, focusNode: composerNode as object | null, removeAllRanges() { this.anchorNode = null; this.focusNode = null } }
    const doc = { getSelection: () => selection, addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) }
    const root = { ownerDocument: doc, contains: (node: unknown) => node === sourceNode }
    let cleanup: (() => void) | undefined
    let chosen: { text: string; start: number; end: number } | null = { text: "two", start: 4, end: 7 }
    const previousCSS = Object.getOwnPropertyDescriptor(globalThis, "CSS")
    Object.defineProperty(globalThis, "CSS", { configurable: true, value: { escape: (text: string) => text } })
    try {
        const { MessageQuoteSelection } = load("components/communications/MessageQuoteSelection.tsx", {
            react: { useEffect: (effect: () => () => void) => { cleanup = effect() } },
            "@/lib/communications/message-quotes": { selectedMessageQuote: () => chosen },
        })
        const updates: unknown[] = []
        let cancelled = false
        assert.equal(MessageQuoteSelection({ messageId, body: "one two three", paneRef: { current: { querySelector: () => root } }, onChange: (id: string, quote: unknown) => updates.push({ id, quote }), onCancel: () => { cancelled = true } }), null)
        assert.equal(selection.anchorNode, composerNode, "starting a reply must not disturb the composer caret")
        selection.anchorNode = sourceNode; selection.focusNode = sourceNode
        listeners.get("selectionchange")!()
        assert.deepEqual(updates, [{ id: messageId, quote: chosen }])
        selection.anchorNode = composerNode; selection.focusNode = composerNode
        chosen = null
        listeners.get("selectionchange")!()
        assert.equal(updates.length, 1, "typing must preserve the chosen passage")
        selection.anchorNode = sourceNode; selection.focusNode = sourceNode
        listeners.get("selectionchange")!()
        assert.deepEqual(updates[1], { id: messageId, quote: null }, "clearing the source selection restores a whole-message reply")
        listeners.get("keydown")!({ key: "Escape", preventDefault() {} })
        assert.equal(cancelled, true)
        selection.anchorNode = composerNode; selection.focusNode = composerNode
        cleanup!()
        assert.equal(selection.anchorNode, composerNode, "sending or cancelling must preserve the draft caret")
        assert.equal(listeners.size, 0)
    } finally {
        if (previousCSS) Object.defineProperty(globalThis, "CSS", previousCSS)
        else Reflect.deleteProperty(globalThis, "CSS")
    }
})

test("native actions merge quote and reply into the reply-arrow button while client reply remains", () => {
    const icons = load("components/communications/MessageInteractionIcons.tsx", {})
    const { PrimaryMessageActions } = load("components/communications/MessageActionMenu.tsx", {
        "@/components/communications/MessageInteractionIcons": icons,
        "@/components/ui/AnchoredPopup": { AnchoredPopup: () => null },
    })
    const props = { onDelete: null, onEdit: null, onSave: null, onReply: () => {}, onCopy: () => {}, onPin: null, onReact: null, pinned: false }
    const native = renderToStaticMarkup(React.createElement(PrimaryMessageActions, { ...props, onQuote: () => {} }))
    assert.match(native, /aria-label="Quote"/)
    assert.doesNotMatch(native, /aria-label="Reply"/)
    assert.match(native, /title="Reply to the whole message, or highlight text to quote a passage"/)
    assert.match(native, /<svg/)
    const client = renderToStaticMarkup(React.createElement(PrimaryMessageActions, props))
    assert.match(client, /aria-label="Reply"/)
    assert.doesNotMatch(client, /aria-label="Quote"/)
})
