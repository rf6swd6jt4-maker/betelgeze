import assert from "node:assert/strict"
import test from "node:test"
import { chatMentionSource, chatMentions, readChatMention, mentionQuery, mentionPreview, matchingMentionPeople, mentionedRecipients } from "../lib/chat-formatting.ts"
import { parseChatInline, chatComposerDecorations } from "../lib/chat-formatting.ts"

const alex = { id: "11111111-1111-4111-8111-111111111111", name: "Alex Morgan" }
const other = { id: "22222222-2222-4222-8222-222222222222", name: "Alex Morgan" }

test("mentions retain exact identity and display names, including punctuation and Unicode", () => {
    for (const name of [alex.name, "Zoë [Design] **💫** __A__ ~~B~~", "李 明", "A )](mention:bad)"]) {
        const source = chatMentionSource({ ...alex, name })
        assert.deepEqual(readChatMention(source), { text: `@${name}`, userId: alex.id, source })
        assert.equal(mentionPreview(`Hi ${source}!`), `Hi @${name}!`)
        assert.equal(parseChatInline(source)[0].kind, "mention")
        assert.deepEqual(chatComposerDecorations(source), [])
        const wrapped = parseChatInline(`**Hello ${source}**`)[0]
        assert.equal(wrapped.kind, "bold")
        assert.ok("children" in wrapped && wrapped.children.some((token) => token.kind === "mention" && token.text === `@${name}`))
    }
})

test("picker finds the current caret query without opening for email, selections, or existing mentions", () => {
    assert.deepEqual(mentionQuery("Hi @Alex M", 10), { from: 3, to: 10, query: "Alex M" })
    assert.deepEqual(mentionQuery("@", 1), { from: 0, to: 1, query: "" })
    assert.equal(mentionQuery("me@example.com", 14), null)
    assert.equal(mentionQuery("@Alex", 0, 5), null)
    const source = chatMentionSource(alex)
    assert.equal(mentionQuery(source, source.length), null)
    assert.equal(mentionQuery(source, 8), null)
    assert.equal(mentionQuery(source + " hello", source.length + 6), null)
    assert.deepEqual(matchingMentionPeople([alex, { ...other, name: "Mary Jones" }], "morg al"), [alex])
})

test("notification recipients are unique current participants, exclude sender and forged outside IDs", () => {
    const body = [chatMentionSource(alex), chatMentionSource(alex), chatMentionSource(other)].join(" ")
    assert.deepEqual(mentionedRecipients(body, [alex.id], other.id), [alex.id])
    assert.deepEqual(mentionedRecipients(body, [other.id], other.id), [])
    assert.deepEqual(mentionedRecipients("**@Alex Morgan**", [alex.id], other.id), [])
})

test("malformed mentions stay harmless text and surrounding formatting keeps its offsets", () => {
    assert.equal(readChatMention("@[%ZZ](mention:" + alex.id + ")"), null)
    assert.deepEqual(chatMentions("@[Alex](mention:invalid)"), [])
    const source = chatMentionSource(alex)
    const tokens = parseChatInline(`**Hi ${source}** https://example.com/a__b`)
    assert.equal(tokens[0].kind, "bold")
    assert.deepEqual(tokens.at(-1), { kind: "link", text: "https://example.com/a__b" })
    assert.ok(chatComposerDecorations(`${source} **bold**`).some((range) => range.from === source.length + 1 && range.className === "chat-bold"))
})
