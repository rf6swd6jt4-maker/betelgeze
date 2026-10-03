import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import ts from "typescript"
import * as formatting from "../lib/chat-formatting.ts"

function load(path: string, dependencies: Record<string, unknown>) {
    const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText
    const localRequire = createRequire(resolve(path))
    const compiled = new Module(resolve(path)) as Module & { _compile: (source: string, filename: string) => void }
    compiled.require = ((name: string) => name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiled.require
    compiled._compile(source, path)
    return compiled.exports
}
const quotes = load("lib/communications/message-quotes.ts", { "@/lib/chat-formatting": formatting }) as typeof import("../lib/communications/message-quotes")
const id = "11111111-1111-4111-8111-111111111111"
const reference = formatting.chatRecordReferenceSource({ type: "work_item", id })

test("quotes and previews retain generic text and reject forged title snapshots", () => {
    const body = `Please **review ${reference}** today\n- And ${reference} tomorrow`
    const text = "Please review Reference today\nAnd Reference tomorrow"
    assert.equal(quotes.chatQuoteText(body), text)
    assert.equal(formatting.mentionPreview(body), "Please **review Reference** today\n- And Reference tomorrow")
    assert.equal(quotes.messageQuoteMatches(body, { text: "Reference", start: 14, end: 23 }), true)
    assert.equal(quotes.messageQuoteMatches(body, { text: "Sensitive", start: 14, end: 23 }), false)
    const start = text.indexOf("today")
    assert.deepEqual(quotes.resolveMessageQuote(body, { text: "today", start, end: start + 5 }), { text: "today", start, end: start + 5 })
})

test("record tokens never become mention recipients or carry sender-supplied labels", () => {
    const another = "22222222-2222-4222-8222-222222222222"
    const body = `${reference} ${formatting.chatMentionSource({ id: another, name: "Alex" })}`
    assert.deepEqual(formatting.mentionedRecipients(body, [id, another], "sender"), [another])
    assert.equal(reference, `@[ref](record:work_item:${id})`)
    for (const value of [`@[secret](record:work_item:${id})`, `@[ref](record:person:${id})`, "@[ref](record:asset:invalid)"]) {
        assert.deepEqual(formatting.chatRecordReferences(value), [])
        assert.ok(formatting.parseChatInline(value).every(token => token.kind !== "reference"))
    }
})

test("native push uses generic reference text while preserving participant alert rules", async () => {
    const recipient = "22222222-2222-4222-8222-222222222222"
    const deliveries: Array<{ recipients: string[]; value: Record<string, unknown> }> = []
    const push = load("lib/push/chat-notifications.ts", {
        "server-only": {},
        "@/lib/chat-formatting": formatting,
        "@/lib/communications/performance-server": { beginChatServerMeasurement: () => ({ mark() {}, finish: () => ({}) }) },
        "@/lib/supabase/admin": { supabaseAdmin: { rpc: async () => ({ data: { senderName: "Sender", conversationKind: "team", teamName: "Team", recipients: [recipient, "sender"], messageCreatedAt: "2026-10-03T00:00:00Z" }, error: null }) } },
        "@/lib/push/delivery": { deliverChatPush: async (recipients: string[], value: Record<string, unknown>) => { deliveries.push({ recipients, value }) } },
    })
    await push.notifyNativeChatMessage({ workspaceId: "workspace", workspaceSlug: "synthetic", conversationId: "conversation", messageId: "message", senderUserId: "sender", previewBody: `Review ${reference}` })
    assert.equal(deliveries.length, 1)
    assert.deepEqual(deliveries[0].recipients, [recipient])
    assert.equal(deliveries[0].value.body, "Review Reference")
    assert.deepEqual(deliveries[0].value.mentionUserIds, [])
    assert.ok(!JSON.stringify(deliveries[0].value).includes(id))
})
