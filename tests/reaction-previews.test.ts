import assert from "node:assert/strict"
import test from "node:test"
import { conversationInbox, indexChatReactions, reactionPreviewText } from "../lib/communications/reaction-previews.ts"

test("the newest activity owns the preview and list order without needing the reacted-to message body", () => {
    const conversations = ["a", "b"].map(id => ({ id, messages: [], latestMessageAt: "2026-11-02T10:11:12.000005Z" }))
    const reaction = { id: "r1", relationshipId: "b", messageId: "old", emoji: "🎯", updatedAt: "2026-11-02T11:11:12.000006+01:00" }
    const replacement = { ...reaction, id: "r2", emoji: "👍" }
    const earlier = { ...reaction, messageId: "other", updatedAt: "2026-11-02T10:11:12Z" }
    const index = indexChatReactions([replacement, earlier, reaction], r => r.relationshipId)
    assert.equal(index.byMessage.get("old")?.length, 2)
    const rows = conversationInbox(conversations, index.latestByConversation)
    assert.deepEqual(rows.map(row => row.conversation.id), ["b", "a"])
    assert.equal(rows[0].reaction, replacement)
    assert.equal(rows[0].activityAt, replacement.updatedAt)
    conversations[1].latestMessageAt = "2026-11-02T10:11:12.000007Z"
    assert.equal(conversationInbox(conversations, index.latestByConversation)[1].reaction, null)
    assert.equal(reactionPreviewText("You", "🎯", "Photo"), "You reacted 🎯 to “Photo”")
    assert.equal(reactionPreviewText("Sam", "👍"), "Sam reacted 👍 to a message")
})
