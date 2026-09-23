import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const canonicalListPages = [
    "components/workspace/NativeRelationshipsPanel.tsx",
    "app/[workspaceSlug]/onboarding/page.tsx",
    "app/[workspaceSlug]/work/page.tsx",
    "app/[workspaceSlug]/work-items/page.tsx",
    "app/[workspaceSlug]/admin/maintenance/page.tsx",
    "app/[workspaceSlug]/admin/activity/page.tsx",
]

test("retired Lead Gen poll archive uses the shared read-only list anatomy", async () => {
    const source = await readFile("components/leadgen/LeadgenPollHistory.tsx", "utf8")
    for (const primitive of ["PanelTabHeader", "List", "ListItem", "ListPrimaryRow", "ListSecondaryRow", "ListTitle"]) {
        assert.match(source, new RegExp(`<${primitive}`))
    }
    assert.doesNotMatch(source, /<MobileListActionSurface|<ListActionMenu/, "the archive has no mutation actions")
})

test("saved company archive uses the shared read-only list anatomy", async () => {
    const source = await readFile("app/[workspaceSlug]/leadgen/page.tsx", "utf8")
    for (const primitive of ["PanelTabHeader", "List", "ListItem", "ListPrimaryRow", "ListSecondaryRow", "ListTitle"]) {
        assert.match(source, new RegExp(`<${primitive}`))
    }
    assert.doesNotMatch(source, /<MobileListActionSurface|<ListActionMenu/)
})

test("canonical platform lists use the shared header and two-row list primitives", async () => {
    const pages = await Promise.all(canonicalListPages.map(async (path) => ({ path, source: await readFile(path, "utf8") })))

    for (const page of pages) {
        assert.match(page.source, /<PanelTabHeader/, `${page.path} must use PanelTabHeader`)
        assert.match(page.source, /<List ariaLabel=/, `${page.path} must use List`)
        assert.match(page.source, /<ListItem/, `${page.path} must use ListItem`)
        assert.match(page.source, /<ListPrimaryRow>/, `${page.path} must use ListPrimaryRow`)
        assert.match(page.source, /<ListSecondaryRow>/, `${page.path} must use ListSecondaryRow`)
        assert.match(page.source, /<MobileListActionSurface/, `${page.path} must use the mobile whole-item action surface`)
    }
})

test("Communications uses its dedicated responsive conversation workspace instead of canonical List", async () => {
    const [page, panel, workspace, teamWorkspace, resizableColumns] = await Promise.all([
        readFile("app/[workspaceSlug]/communications/page.tsx", "utf8"),
        readFile("components/communications/CommunicationsPanel.tsx", "utf8"),
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/TeamCommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/ResizableConversationColumns.tsx", "utf8"),
    ])

    assert.doesNotMatch(page, /WorkspaceBanner|PanelTabHeader|PanelTabs/)
    assert.match(page, /<CommunicationsPanel/)
    assert.match(panel, /<CommunicationsWorkspace/)
    assert.match(panel, /<TeamCommunicationsWorkspace/)
    assert.doesNotMatch(page, /<List ariaLabel=/)
    assert.match(page, /fixed inset-0 overflow-hidden bg-black/)
    assert.match(panel, /data-communications-panel/)
    assert.doesNotMatch(panel, /communicationsViewportLocked|visualViewport|scrollTo/)
    assert.match(panel, /\$\{navigation \? "absolute" : "fixed"\} inset-0 isolate overflow-hidden overscroll-none bg-black/)
    assert.match(workspace, /h-full min-h-0 w-full/)
    assert.match(workspace, /overflow-y-auto/)
    assert.match(workspace, /lg:hidden/)
    assert.match(workspace, /Back to client chats/)
    assert.doesNotMatch(workspace, /activeArea|Calendar/)
    assert.match(workspace, /onOpenTeam/)
    assert.match(workspace, /selectConversation\(conversation\.id\)/)
    assert.doesNotMatch(workspace, /href=\{href\}/)
    assert.doesNotMatch(workspace, /@\/lib\/relationships/, "the client workspace must not import the server-only relationships module")
    assert.match(teamWorkspace, /h-full min-h-0 w-full/)
    assert.match(teamWorkspace, /<ResizableConversationColumns listWidth=\{conversationListWidth\}/)
    assert.match(resizableColumns, /lg:grid-cols/)
    assert.match(teamWorkspace, /lg:hidden/)
    assert.match(teamWorkspace, /selectConversation\(conversation\.id\)/)
})

test("the Admin work queue uses the same canonical row anatomy", async () => {
    const source = await readFile("components/admin/AdminWorkQueue.tsx", "utf8")
    for (const primitive of ["List", "ListItem", "ListPrimaryRow", "ListSecondaryRow", "ListTitle", "ListTrailing", "MobileListActionSurface"]) {
        assert.match(source, new RegExp(`<${primitive}`), `AdminWorkQueue must use ${primitive}`)
    }
    assert.match(source, /<Assignee/)
    assert.doesNotMatch(source, /rounded-full border bg-neutral-900/)
    assert.doesNotMatch(source, /border-b border-neutral-900 px-3 py-3/)
})

test("the Assets sibling keeps the shared Library shell without becoming a canonical list", async () => {
    const source = await readFile("app/[workspaceSlug]/assets/page.tsx", "utf8")
    assert.match(source, /<PanelTabHeader/)
    assert.match(source, /<LibraryTabs/)
    assert.match(source, /<QuickStats/)
    assert.doesNotMatch(source, /<List ariaLabel=/)
})

test("Library tabs place SOPs immediately after Work Items", async () => {
    const source = await readFile("components/library/LibraryTabs.tsx", "utf8")
    assert.match(source, /items = limited \? \[workItems, sops\] : \[\s*workItems,\s*sops,\s*\{ key: "assets"/)
})

test("Library lands on Work Items and SOP creation uses shared popups and add cards", async () => {
    const [panels, nativeLibrary, catalogue, upload, detailFields, assetGallery] = await Promise.all([
        readFile("lib/workspace-panels.ts", "utf8"),
        readFile("lib/workspace-native-library.ts", "utf8"),
        readFile("components/sops/SopCatalogue.tsx", "utf8"),
        readFile("components/sops/SopAssetUpload.tsx", "utf8"),
        readFile("components/work-items/WorkItemTextField.tsx", "utf8"),
        readFile("components/ui/AssetGallery.tsx", "utf8"),
    ])
    assert.match(panels, /key: "library", label: "Library", route: "work-items"/)
    assert.match(nativeLibrary, /async function loadWorkItemList[\s\S]*?requireWorkspaceAccess\(workspaceSlug\)/)
    assert.match(catalogue, /<CenteredDialog title="Add SOP"/)
    assert.match(upload, /<AddAssetGalleryCard label="Add asset"/)
    assert.match(upload, /<CenteredDialog title="Add asset"/)
    assert.match(assetGallery, /export function AddAssetGalleryCard/)
    assert.match(assetGallery, /before:pb-\[75%\]/, "the gallery add card must retain a useful 4:3 minimum when its row has no asset")
    assert.match(detailFields, /multiline stackOnMobile=\{!compact\}/, "the compact Name editor must top-align with its save-status block")
    assert.match(detailFields, /compact \? "min-h-6" : "min-h-12"/)
})
