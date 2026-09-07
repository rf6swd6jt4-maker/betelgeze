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

test("headers and checkbox lists preserve their source and continue unchecked", async () => {
    const { chatCheckboxBody, chatComposerDecorations, sameChatChecklist } = await import("../lib/chat-formatting.ts")
    assert.deepEqual(parseChatInline("##Title **bold**##"), [{ kind: "header", children: [{ kind: "text", text: "Title " }, { kind: "bold", children: [{ kind: "text", text: "bold" }] }] }])
    const original = "##Plan##\n[ ] One\n  [x] Two"
    const checked = chatCheckboxBody(original, 1, true)!
    assert.equal(checked, "##Plan##\n[x] One\n  [x] Two")
    assert.equal(chatCheckboxBody(checked, 1, false), original)
    assert.equal(chatCheckboxBody(original, 0, true), null)
    assert.equal(chatCheckboxBody(original, 99, true), null)
    assert.equal(sameChatChecklist(original, checked), true)
    assert.equal(sameChatChecklist(original, original.replace("One", "Changed")), false)
    assert.equal(sameChatChecklist(original, original.replace("[ ] One\n", "")), false)
    const continued = chatListEdit(original, original.length, original.length, "Enter")!
    assert.equal(continued.value, original + "\n  [ ] ")
    assert.equal(chatListEdit(continued.value, continued.start, continued.end, "Enter")?.value, original + "\n")
    const marks = chatComposerDecorations("##Title## **bold __nested__**")
    assert.ok(marks.some((mark) => mark.className === "chat-header" && mark.from === 0 && mark.to === 9))
    for (const mark of marks.filter((mark) => mark.className === "chat-syntax")) assert.match("##Title## **bold __nested__**".slice(mark.from, mark.to), /^(##|\*\*|__)$/)
})

test("composer list markers replace source prefixes without dimming numbers or item text", async () => {
    const { chatComposerDecorations, chatComposerListMarkers, chatLineStartsWithHeader } = await import("../lib/chat-formatting.ts")
    const body = "[ ] Task\n  - Nested **bold**\n12. Number"
    const markers = chatComposerListMarkers(body)
    assert.deepEqual(markers.map((item) => body.slice(item.from, item.to)), ["[ ] ", "  - ", "12. "])
    assert.deepEqual(markers.map((item) => item.marker), ["[ ]", "-", "12."])
    assert.equal(markers[1].indent, 2)
    const dimmed = chatComposerDecorations(body).filter((mark) => mark.className === "chat-syntax")
    assert.deepEqual(dimmed.map((mark) => body.slice(mark.from, mark.to)), ["**", "**"])
    assert.equal(chatLineStartsWithHeader("##A heading##"), true)
    assert.equal(chatLineStartsWithHeader("Text ##inline##"), false)
    assert.equal(chatLineStartsWithHeader("##Incomplete"), false)
})
