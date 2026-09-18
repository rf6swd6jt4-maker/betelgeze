import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("asset details use the relationship-style inline autosave fields", async () => {
    const [page, editor, actions] = await Promise.all([
        readFile("app/[workspaceSlug]/assets/[id]/page.tsx", "utf8"),
        readFile("app/[workspaceSlug]/assets/[id]/AssetFieldsEditor.tsx", "utf8"),
        readFile("app/[workspaceSlug]/assets/[id]/actions.ts", "utf8"),
    ])

    assert.match(page, /<AssetFieldsEditor/)
    assert.doesNotMatch(page, /label="Reference"/)
    assert.match(editor, /className="mt-4 border-b border-neutral-800"/)
    assert.match(editor, /<DetailFields className="!mt-0">/)
    assert.match(editor, /aria-label="Asset name"/)
    assert.match(editor, /aria-label="Asset description"/)
    assert.match(editor, /setTimeout\(\(\) => \{ timerRef\.current = null; void flush\(\) \}, 800\)/)
    assert.match(editor, /registerWorkspaceAutosaveFlusher/)
    assert.match(editor, /onBlur=\{\(\) => void flush\(\)\}/)
    assert.doesNotMatch(editor, /Edit asset/)
    assert.match(actions, /requireAssetAccess\(access, assetId\)/)
    assert.match(actions, /workspaceAccessHasCapability/)
    assert.match(actions, /\.eq\("updated_at", input\.expectedUpdatedAt\)/)
})
