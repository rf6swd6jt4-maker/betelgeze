import assert from "node:assert/strict"
import test from "node:test"
import { composerMentionSuggestions, personMentionDestinations, referenceContextKey } from "../lib/communications/reference-suggestions.ts"
import type { RecordReferenceResult } from "../lib/chat-formatting.ts"

const people = Array.from({ length: 50 }, (_, index) => ({ id: `person-${index}`, name: `Alex ${index}` }))
const references: RecordReferenceResult[] = [
    { type: "work_item", id: "work-1", label: "Review Alex design", href: "/demo/work-items/work-1" },
    { type: "asset", id: "asset-1", label: "Alex design", href: "/demo/assets/asset-1" },
    { type: "relationship", id: "relationship-1", label: "Alex company", href: "/demo/relationships/relationship-1" },
]

test("the picker keeps a short scrollable set and exposes already fetched records beyond the first four rows", () => {
    const result = composerMentionSuggestions(people, references, "Alex")
    assert.equal(result.length, 8)
    assert.deepEqual(result.map(item => item.type), ["person", "work_item", "person", "asset", "person", "relationship", "person", "person"])
    assert.equal(composerMentionSuggestions(people, [], "").length, 8)
})

test("an exact record name precedes partial people and record matches", () => {
    const result = composerMentionSuggestions([{ id: "person", name: "Alex design lead" }], references, "Alex design")
    assert.equal(result[0].type, "asset")
    assert.equal(result[0].label, "Alex design")
    assert.equal(result[1].type, "person")
})

test("identical record IDs retain distinct types while duplicate results occupy only one slot", () => {
    const sameId = references.map(reference => ({ ...reference, id: "same-id" }))
    const result = composerMentionSuggestions([], [...sameId, sameId[0]], "")
    assert.deepEqual(result.map(item => item.type), ["work_item", "asset", "relationship"])
})

test("an immediate local picker uses all search words and preserves its roster order", () => {
    assert.deepEqual(composerMentionSuggestions(people, [], "aLeX 42").map(item => item.label), ["Alex 42"])
    assert.deepEqual(composerMentionSuggestions(people, [], "absent"), [])
})

test("request and editor context includes the account, workspace and exact conversation", () => {
    const context = { userId: "user", workspaceId: "workspace", workspaceSlug: "demo", conversationId: "conversation" }
    const initial = referenceContextKey(context)
    for (const field of Object.keys(context)) assert.notEqual(referenceContextKey({ ...context, [field]: "other" }), initial)
    assert.equal(referenceContextKey(), "")
})

test("person references reuse authorised direct chats and never offer staff a new or self chat", () => {
    const input = {
        workspaceSlug: "demo", currentUserId: "self", canStartDirect: false,
        people: [{ id: "self" }, { id: "existing" }, { id: "new" }, { id: "departed", former: true }],
        conversations: [
            { id: "direct-existing", kind: "direct", memberIds: ["self", "existing"], archived: false },
            { id: "archived", kind: "direct", memberIds: ["self", "new"], archived: true },
            { id: "other-pair", kind: "direct", memberIds: ["new", "existing"], archived: false },
            { id: "direct-departed", kind: "direct", memberIds: ["self", "departed"], archived: false },
        ],
    }
    assert.deepEqual([...personMentionDestinations(input)], [["existing", "/demo/communications?mode=team&nativeConversation=direct-existing"]])
    assert.deepEqual([...personMentionDestinations({ ...input, canStartDirect: true })], [
        ["existing", "/demo/communications?mode=team&nativeConversation=direct-existing"],
        ["new", "/demo/communications?mode=team&dm=new"],
    ])
})
