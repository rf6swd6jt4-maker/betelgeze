import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("notes are canonical workspace records with bounded relationship and asset links", async () => {
    const [migration, actions, notes] = await Promise.all([
        readFile("supabase/migrations/20260918130000_workspace_notes.sql", "utf8"),
        readFile("app/[workspaceSlug]/relationships/actions.ts", "utf8"),
        readFile("lib/notes.ts", "utf8"),
    ])
    assert.match(migration, /create table if not exists public\.notes/)
    assert.match(migration, /create table if not exists public\.note_relationships/)
    assert.match(migration, /create table if not exists public\.note_assets/)
    assert.match(migration, /enforce_note_link_workspace/)
    assert.match(migration, /workspace_admins_can_manage_notes/)
    assert.match(actions, /export async function createNoteFromModal/)
    assert.match(notes, /\.limit\(120\)/)
})

test("note creation is available in both shell quick-action placements and stays out of AI context", async () => {
    const [shell, modal, topBar, list, detail] = await Promise.all([
        readFile("components/workspace/WorkspaceTopBarClient.tsx", "utf8"),
        readFile("components/workspace/WorkspaceCreateModal.tsx", "utf8"),
        readFile("components/workspace/WorkspaceTopBar.tsx", "utf8"),
        readFile("app/[workspaceSlug]/notes/page.tsx", "utf8"),
        readFile("app/[workspaceSlug]/notes/[id]/page.tsx", "utf8"),
    ])
    assert.equal((shell.match(/openCreate\("note"\)/g) ?? []).length, 2)
    assert.match(shell, /aria-label="Add note" title="Add note"/)
    assert.match(shell, /<span>Add note<\/span>/)
    assert.match(topBar, /createNoteFromModal/)
    assert.match(modal, /name="relationship_ids"/)
    assert.match(modal, /name="asset_ids"/)
    assert.match(list, /<LibraryTabs workspaceSlug=\{workspace\.slug\} active="notes"/)
    assert.match(detail, /listNoteRelationships/)
    assert.match(detail, /listNoteAssets/)
    assert.doesNotMatch([shell, modal, topBar, list, detail].join("\n"), /relationship_context_assets|generation_context/)
})

test("note routes participate in Library navigation, record tabs, restore, search, and shared banner chrome", async () => {
    const [panels, tabs, launch, search, chrome] = await Promise.all([
        readFile("lib/workspace-panels.ts", "utf8"),
        readFile("lib/workspace-tabs.ts", "utf8"),
        readFile("lib/workspace-launch.ts", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/search/route.ts", "utf8"),
        readFile("lib/workspace-panel-chrome.ts", "utf8"),
    ])
    assert.match(panels, /activeRoutes: \["work-items", "sops", "assets", "notes"\]/)
    assert.match(tabs, /suffix === "notes"/)
    assert.match(tabs, /"assets", "notes"/)
    assert.match(launch, /"assets", "notes"/)
    assert.match(search, /from\("notes"\)/)
    assert.match(search, /noteHref\(workspace\.slug, note\.id\)/)
    assert.match(chrome, /"notes"/)
})

test("note fields autosave and all record attachments use the shared gallery", async () => {
    const [page, fields, actions, attachments, workItem, relationship, standards] = await Promise.all([
        readFile("app/[workspaceSlug]/notes/[id]/page.tsx", "utf8"),
        readFile("app/[workspaceSlug]/notes/[id]/NoteFieldsEditor.tsx", "utf8"),
        readFile("app/[workspaceSlug]/notes/[id]/actions.ts", "utf8"),
        readFile("components/detail/RecordAttachments.tsx", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/page.tsx", "utf8"),
        readFile("components/workspace/NativeRelationshipsPanel.tsx", "utf8"),
        readFile("docs/ui-standards.md", "utf8"),
    ])
    assert.match(page, /<NoteFieldsEditor/)
    assert.match(fields, /useWorkItemTextDraft/)
    assert.match(fields, /AutoGrowTextarea/)
    assert.match(actions, /saveNoteFields/)
    assert.match(page, /<RecordAttachments/)
    assert.match(workItem, /<RecordAttachments/)
    assert.match(relationship, /<RecordAttachments/)
    assert.match(attachments, /<DocumentCatalogue/)
    assert.match(standards, /### Autosave in field blocks/)
})
