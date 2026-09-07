import assert from "node:assert/strict"
import test from "node:test"
import { chatListEdit, chatListLine, parseChatInline } from "../lib/chat-formatting.ts"

test("chat formatting supports the requested delimiters and nesting", () => {
    assert.deepEqual(parseChatInline("**bold __italic__** ~~gone~~"), [
        { kind: "bold", children: [{ kind: "text", text: "bold " }, { kind: "italic", children: [{ kind: "text", text: "italic" }] }] },
        { kind: "text", text: " " }, { kind: "strike", children: [{ kind: "text", text: "gone" }] },
    ])
    assert.deepEqual(parseChatInline("**unfinished <script>"), [{ kind: "text", text: "**unfinished <script>" }])
    assert.deepEqual(parseChatInline("https://example.com/a__b"), [{ kind: "link", text: "https://example.com/a__b" }])
})

test("Enter continues numbered and nested bullet lists; second Enter exits", () => {
    for (const [value, expected] of [["9. nine", "9. nine\n10. "], ["  - item", "  - item\n  - "]]) {
        const edit = chatListEdit(value, value.length, value.length, "Enter")!
        assert.equal(edit.value, expected)
        assert.equal(edit.start, expected.length)
        const exit = chatListEdit(edit.value, edit.start, edit.end, "Enter")!
        assert.equal(exit.value, value + "\n")
    }
    assert.equal(chatListEdit("hello", 5, 5, "Enter"), null)
})

test("list editing respects cursor, selection, indentation, and following text", () => {
    assert.equal(chatListEdit("- hello world", 7, 7, "Enter")?.value, "- hello\n-  world")
    assert.equal(chatListEdit("- hello world", 7, 13, "Enter")?.value, "- hello\n- ")
    assert.deepEqual(chatListEdit("- item", 6, 6, "Tab"), { value: "  - item", start: 8, end: 8 })
    assert.deepEqual(chatListEdit("  - item", 8, 8, "Tab", true), { value: "- item", start: 6, end: 6 })
    assert.equal(chatListEdit("- \nafter", 2, 2, "Enter")?.value, "\nafter")
    assert.equal(chatListLine("1.2 decimal"), null)
})
