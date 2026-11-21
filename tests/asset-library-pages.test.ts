import test from "node:test"
import assert from "node:assert/strict"
import { firstWorkspaceAssetPage, workspaceAssetPage, WORKSPACE_ASSET_PAGE_SIZE } from "../lib/assets/library-pages.ts"
import { attachmentCursorFilter, decodeAttachmentCursor, encodeAttachmentCursor } from "../lib/attachment-pages.ts"

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

test("Load more reaches every asset once, including ties on the change time", () => {
    // 70 assets, most sharing one microsecond timestamp, handed over in no useful order.
    const all = Array.from({ length: 70 }, (_, i) => ({ id: id(i + 1), updated_at: i % 10 === 0 ? `2026-11-${String(10 + i / 10).padStart(2, "0")}T09:00:00+00:00` : "2026-11-01T10:00:00.123456+00:00" }))
    const shuffled = [...all].sort((a, b) => (a.id.at(-1)! + a.id).localeCompare(b.id.at(-1)! + b.id))
    const first = firstWorkspaceAssetPage(shuffled)
    assert.equal(first.items.length, WORKSPACE_ASSET_PAGE_SIZE)
    const seen = first.items.map(asset => asset.id)
    let next = first.next
    while (next) {
        const cursor = decodeAttachmentCursor(encodeAttachmentCursor({ asset: next, note: null }))!.asset!
        assert.match(attachmentCursorFilter(cursor, "updated_at", "id"), /^updated_at\.lt\./)
        // What the database returns for that keyset filter: strictly older, newest first, one past the page.
        const older = [...all].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || (a.id < b.id ? 1 : -1))
            .filter(asset => Date.parse(asset.updated_at) < Date.parse(cursor.at) || (asset.updated_at === cursor.at && asset.id < cursor.id))
        const page = workspaceAssetPage(older.slice(0, WORKSPACE_ASSET_PAGE_SIZE + 1))
        seen.push(...page.items.map(asset => asset.id))
        next = page.next
    }
    assert.equal(seen.length, 70)
    assert.equal(new Set(seen).size, 70)
})

test("a library that fits its first page offers no Load more", () => {
    const page = firstWorkspaceAssetPage(Array.from({ length: WORKSPACE_ASSET_PAGE_SIZE }, (_, i) => ({ id: id(i + 1), updated_at: "2026-11-01T10:00:00+00:00" })))
    assert.equal(page.next, null)
    assert.equal(encodeAttachmentCursor({ asset: page.next, note: null }), null)
})
